/**
 * Local whisper.cpp: download the CLI and a ggml model on demand, then transcribe.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WHISPER_MODELS, whisperBinary, whisperModel, type DownloadAsset } from '../catalog.js';
import { downloadVerified, fileReady, fileSized, pathInside } from '../download.js';
import { extractWavArgs, runFfmpeg, runProcess } from '../ffmpegJob.js';
import { burnInArgs, formatSrt, parseWhisperJson, whisperCliArgs, type CaptionCue } from './format.js';

export interface SpeechPaths {
  userData: string;
  platform: string;
  arch: string;
}

function rootOf(userData: string): string {
  return path.join(userData, 'ai', 'whisper');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function findOnPath(command: string, platform: string): Promise<string | null> {
  const locator = platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(locator, [command], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const found = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
      resolve(found ?? null);
    });
  });
}

function extractArchive(archive: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xf', archive, '-C', destination], { windowsHide: true }, (error) => {
      if (error) reject(new Error('Could not unpack whisper.cpp'));
      else resolve();
    });
  });
}

export async function modelFile(userData: string, asset: DownloadAsset): Promise<string> {
  return pathInside(rootOf(userData), 'models', `${asset.id}.bin`);
}

export async function whisperCliPath(paths: SpeechPaths): Promise<string | null> {
  const binary = whisperBinary(paths.platform, paths.arch);
  if (binary?.entry) {
    const installed = pathInside(rootOf(paths.userData), 'bin', ...binary.entry.split('/'));
    if (await exists(installed)) return installed;
  }
  return findOnPath(paths.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli', paths.platform);
}

export async function ensureWhisperCli(
  paths: SpeechPaths,
  hooks?: {
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number | null) => void;
  },
): Promise<string> {
  const existing = await whisperCliPath(paths);
  if (existing) return existing;
  const binary = whisperBinary(paths.platform, paths.arch);
  if (!binary?.entry) {
    throw new Error(
      'No whisper.cpp build is published for this computer. Install whisper-cli and try again. On macOS: brew install whisper.cpp. The speech model still downloads into EditPro and works offline after that.',
    );
  }
  const folder = rootOf(paths.userData);
  const archive = pathInside(folder, 'pkg', path.basename(binary.url));
  await downloadVerified({
    url: binary.url,
    destination: archive,
    sha256: binary.sha256,
    expectedBytes: binary.bytes,
    signal: hooks?.signal,
    onProgress: hooks?.onProgress,
  });
  const binDir = pathInside(folder, 'bin');
  await fs.mkdir(binDir, { recursive: true });
  await extractArchive(archive, binDir);
  const installed = pathInside(folder, 'bin', ...binary.entry.split('/'));
  if (!(await exists(installed))) throw new Error('The whisper.cpp package did not contain whisper-cli');
  if (paths.platform !== 'win32') await fs.chmod(installed, 0o755);
  return installed;
}

export async function ensureWhisperModel(
  userData: string,
  modelId: string,
  hooks?: {
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number | null) => void;
  },
): Promise<string> {
  const asset = whisperModel(modelId);
  const destination = await modelFile(userData, asset);
  await downloadVerified({
    url: asset.url,
    destination,
    sha256: asset.sha256,
    expectedBytes: asset.bytes,
    signal: hooks?.signal,
    onProgress: hooks?.onProgress,
  });
  return destination;
}

export async function speechStatus(paths: SpeechPaths): Promise<{
  cli: boolean;
  models: { id: string; label: string; bytes: number; ready: boolean }[];
}> {
  const models = [];
  for (const model of WHISPER_MODELS) {
    models.push({
      id: model.id,
      label: model.label,
      bytes: model.bytes,
      ready: await fileSized(await modelFile(paths.userData, model), model.bytes),
    });
  }
  return { cli: (await whisperCliPath(paths)) != null, models };
}

export async function burnCaptions(options: {
  ffmpegPath: string;
  sourcePath: string;
  outputPath: string;
  cues: readonly CaptionCue[];
  signal?: AbortSignal;
  onProgress?: (percent: number, message: string) => void;
}): Promise<void> {
  if (options.cues.length === 0) throw new Error('There are no captions to burn in');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-captions-'));
  try {
    const srt = path.join(temp, 'captions.srt');
    await fs.writeFile(srt, formatSrt(options.cues), 'utf8');
    options.onProgress?.(20, 'Burning captions');
    const burned = await runFfmpeg(options.ffmpegPath, burnInArgs(options.sourcePath, srt, options.outputPath), {
      signal: options.signal,
    });
    if (burned.cancelled) throw new Error('Cancelled');
    if (burned.code === 0) {
      options.onProgress?.(100, 'Captions burned in');
      return;
    }
    const args = burnInArgs(options.sourcePath, srt, options.outputPath);
    const copyAt = args.lastIndexOf('copy');
    if (copyAt > 0) args.splice(copyAt - 1, 2, '-c:a', 'aac', '-b:a', '192k');
    const retry = await runFfmpeg(options.ffmpegPath, args, { signal: options.signal });
    if (retry.cancelled) throw new Error('Cancelled');
    if (retry.code !== 0) throw new Error('Could not burn the captions into this video');
    options.onProgress?.(100, 'Captions burned in');
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function modelIsReady(userData: string, modelId: string): Promise<boolean> {
  const asset = whisperModel(modelId);
  return fileReady(await modelFile(userData, asset), asset.sha256, asset.bytes);
}

function libraryEnv(cliPath: string, platform: string): NodeJS.ProcessEnv {
  const dir = path.dirname(cliPath);
  const env = { ...process.env };
  if (platform === 'linux') {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH ? `${dir}:${env.LD_LIBRARY_PATH}` : dir;
  } else if (platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH ? `${dir}:${env.DYLD_LIBRARY_PATH}` : dir;
  }
  return env;
}

export async function transcribeSource(options: {
  ffmpegPath: string;
  paths: SpeechPaths;
  sourcePath: string;
  modelId: string;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, message: string) => void;
}): Promise<CaptionCue[]> {
  options.onProgress?.(2, 'Preparing speech engine');
  const cli = await ensureWhisperCli(options.paths, {
    signal: options.signal,
    onProgress: (loaded, total) => {
      const percent = total ? Math.round((loaded / total) * 30) : 10;
      options.onProgress?.(percent, 'Downloading whisper.cpp');
    },
  });
  options.onProgress?.(32, 'Checking the speech model');
  const modelPath = await ensureWhisperModel(options.paths.userData, options.modelId, {
    signal: options.signal,
    onProgress: (loaded, total) => {
      const percent = total ? 32 + Math.round((loaded / total) * 40) : 50;
      options.onProgress?.(percent, 'Downloading the speech model');
    },
  });
  if (options.signal?.aborted) throw new Error('Cancelled');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-whisper-'));
  try {
    const wav = path.join(temp, 'speech.wav');
    options.onProgress?.(74, 'Reading audio');
    const extracted = await runFfmpeg(options.ffmpegPath, extractWavArgs(options.sourcePath, wav), {
      signal: options.signal,
    });
    if (extracted.cancelled) throw new Error('Cancelled');
    if (extracted.code !== 0) throw new Error('Could not read audio from this video');
    const outputBase = path.join(temp, 'transcript');
    options.onProgress?.(82, 'Transcribing');
    const result = await runProcess(cli, whisperCliArgs({
      modelPath,
      wavPath: wav,
      outputBase,
      language: options.language ?? 'en',
      threads: Math.max(1, Math.min(8, os.cpus().length)),
    }), {
      signal: options.signal,
      env: libraryEnv(cli, options.paths.platform),
    });
    if (result.cancelled) throw new Error('Cancelled');
    if (result.code !== 0) throw new Error('Whisper could not transcribe this clip');
    const json = await fs.readFile(`${outputBase}.json`, 'utf8');
    options.onProgress?.(100, 'Captions ready');
    return parseWhisperJson(JSON.parse(json) as unknown);
  } finally {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}
