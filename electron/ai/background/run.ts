/**
 * Local MODNet matte. The ONNX file is downloaded into user data; onnxruntime
 * wasm is the runtime and is loaded only when a job starts.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MATTE_MODEL } from '../catalog.js';
import { downloadVerified, fileReady, pathInside } from '../download.js';
import { runFfmpeg } from '../ffmpegJob.js';
import { parseMediaProbe } from '../../playback/proxyPlan.js';
import {
  backgroundEncode,
  compositeArgs,
  extractFramesArgs,
  matteSize,
  matteToGray,
  rgbToNchw,
} from './plan.js';

export function matteModelPath(userData: string): string {
  return pathInside(path.join(userData, 'ai', 'matte'), `${MATTE_MODEL.id}.onnx`);
}

export async function matteIsReady(userData: string): Promise<boolean> {
  return fileReady(matteModelPath(userData), MATTE_MODEL.sha256, MATTE_MODEL.bytes);
}

export async function ensureMatteModel(
  userData: string,
  hooks?: {
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number | null) => void;
  },
): Promise<string> {
  const destination = matteModelPath(userData);
  await downloadVerified({
    url: MATTE_MODEL.url,
    destination,
    sha256: MATTE_MODEL.sha256,
    expectedBytes: MATTE_MODEL.bytes,
    signal: hooks?.signal,
    onProgress: hooks?.onProgress,
  });
  return destination;
}

interface OrtTensor {
  data: Float32Array;
  dims: readonly number[];
}

interface OrtModule {
  env: { wasm: { numThreads: number; wasmPaths?: string } };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(source: string, options: { executionProviders: string[] }): Promise<{
      run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensor>>;
    }>;
  };
}

function wasmDirectory(): string {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('onnxruntime-web/dist/ort.node.min.mjs');
  const directory = path.dirname(entry);
  const unpacked = directory.includes(`${path.sep}app.asar${path.sep}`)
    ? directory.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : directory;
  return unpacked.endsWith(path.sep) ? unpacked : `${unpacked}${path.sep}`;
}

async function loadSession(modelPath: string): Promise<{
  run(rgb: Uint8Array, width: number, height: number): Promise<Uint8Array>;
}> {
  const ort = await import('onnxruntime-web') as unknown as OrtModule;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = wasmDirectory();
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
  return {
    async run(rgb, width, height) {
      const tensor = new ort.Tensor('float32', rgbToNchw(rgb, width, height), [1, 3, height, width]);
      const output = await session.run({ input: tensor });
      const matte = output.output;
      if (!matte) throw new Error('The matting model returned no mask');
      return matteToGray(matte.data, width * height);
    },
  };
}

async function readExact(handle: fs.FileHandle, buffer: Buffer): Promise<boolean> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.read(buffer, offset, buffer.length - offset, null);
    if (result.bytesRead === 0) return false;
    offset += result.bytesRead;
  }
  return offset === buffer.length;
}

export async function removeBackground(options: {
  ffmpegPath: string;
  userData: string;
  sourcePath: string;
  outputPath: string;
  mode: 'transparent' | 'color';
  color: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, message: string) => void;
}): Promise<void> {
  options.onProgress?.(1, 'Checking the matting model');
  const modelPath = await ensureMatteModel(options.userData, {
    signal: options.signal,
    onProgress: (loaded, total) => {
      const percent = total ? Math.round((loaded / total) * 15) : 8;
      options.onProgress?.(percent, 'Downloading the matting model');
    },
  });
  const probed = await runFfmpeg(options.ffmpegPath, ['-hide_banner', '-i', options.sourcePath, '-f', 'null', '-'], {
    signal: options.signal,
  });
  if (options.signal?.aborted) throw new Error('Cancelled');
  const media = parseMediaProbe(probed.text);
  if (!media) throw new Error('Could not read this video');
  const size = matteSize(media.width, media.height);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-matte-'));
  try {
    const frames = path.join(temp, 'frames.raw');
    const mask = path.join(temp, 'mask.raw');
    options.onProgress?.(18, 'Reading frames');
    const extracted = await runFfmpeg(
      options.ffmpegPath,
      extractFramesArgs(options.sourcePath, size.width, size.height, frames),
      { signal: options.signal },
    );
    if (extracted.cancelled) throw new Error('Cancelled');
    if (extracted.code !== 0) throw new Error('Could not read frames from this video');
    const session = await loadSession(modelPath);
    const frameBytes = size.width * size.height * 3;
    const input = await fs.open(frames, 'r');
    const output = await fs.open(mask, 'w');
    const buffer = Buffer.alloc(frameBytes);
    const info = await fs.stat(frames);
    const total = Math.max(1, Math.floor(info.size / frameBytes));
    let index = 0;
    try {
      for (;;) {
        if (options.signal?.aborted) throw new Error('Cancelled');
        const got = await readExact(input, buffer);
        if (!got) break;
        const gray = await session.run(buffer, size.width, size.height);
        await output.write(gray);
        index += 1;
        if (index % 3 === 0 || index === total) {
          const percent = 20 + Math.round((index / total) * 70);
          options.onProgress?.(percent, `Matting frame ${index} of ${total}`);
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    } finally {
      await input.close();
      await output.close();
    }
    if (index === 0) throw new Error('This video has no frames to matte');
    const encode = backgroundEncode({
      frameWidth: media.width,
      frameHeight: media.height,
      maskWidth: size.width,
      maskHeight: size.height,
      fps: media.fps,
      mode: options.mode,
      color: options.color,
    });
    options.onProgress?.(92, 'Writing the matted video');
    const encoded = await runFfmpeg(options.ffmpegPath, compositeArgs({
      input: options.sourcePath,
      maskPath: mask,
      maskWidth: size.width,
      maskHeight: size.height,
      fps: media.fps,
      filter: encode.filter,
      videoArgs: encode.videoArgs,
      audioArgs: encode.audioArgs,
      output: options.outputPath,
      dropAudio: false,
    }), { signal: options.signal });
    if (encoded.cancelled) throw new Error('Cancelled');
    if (encoded.code !== 0) {
      const retry = await runFfmpeg(options.ffmpegPath, compositeArgs({
        input: options.sourcePath,
        maskPath: mask,
        maskWidth: size.width,
        maskHeight: size.height,
        fps: media.fps,
        filter: encode.filter,
        videoArgs: encode.videoArgs,
        audioArgs: encode.audioArgs,
        output: options.outputPath,
        dropAudio: true,
      }), { signal: options.signal });
      if (retry.cancelled) throw new Error('Cancelled');
      if (retry.code !== 0) throw new Error('Could not write the matted video');
    }
    options.onProgress?.(100, 'Background removal ready');
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}
