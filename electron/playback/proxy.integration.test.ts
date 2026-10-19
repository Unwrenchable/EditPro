/**
 * @vitest-environment node
 * Builds a short proxy with the bundled ffmpeg when that binary is installed.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMediaProbe, proxyDimensions } from './proxyPlan.js';
import { probeWithFfmpeg, runProxyEncode } from './proxyRunner.js';

const require = createRequire(import.meta.url);

function ffmpegBinary(): string | null {
  try {
    const resolved = require('ffmpeg-static') as string | null;
    return resolved && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

function run(binary: string, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

describe('proxy ffmpeg integration', () => {
  const binary = ffmpegBinary();

  it.skipIf(!binary)('writes a smaller all-intra H.264 proxy and leaves the original in place', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-proxy-'));
    const source = path.join(dir, 'source.mp4');
    const partial = path.join(dir, 'proxy.part.mp4');
    const output = path.join(dir, 'proxy.mp4');
    const made = await run(binary!, [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1280x720:rate=24:duration=0.5',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.5',
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      source,
    ]);
    expect(made.code, made.stderr).toBe(0);

    const stderr = await probeWithFfmpeg(binary!, source);
    const probe = parseMediaProbe(stderr);
    expect(probe?.width).toBe(1280);
    expect(probe?.height).toBe(720);
    const size = proxyDimensions(probe!.width, probe!.height, 'half');
    expect(size).toEqual({ width: 960, height: 540 });

    const encoded = await runProxyEncode({
      jobId: 'proxy-integration',
      ffmpegPath: binary!,
      inputPath: source,
      partialPath: partial,
      finalPath: output,
      width: size.width,
      height: size.height,
      fps: probe!.fps,
      durationSec: probe!.durationSec,
      onProgress: () => {},
    });
    expect(encoded.status, encoded.message).toBe('done');
    const stat = await fs.stat(output);
    expect(stat.size).toBeGreaterThan(500);
    await expect(fs.stat(source)).resolves.toBeTruthy();

    const proxyProbe = parseMediaProbe(await probeWithFfmpeg(binary!, output));
    expect(proxyProbe?.width).toBe(960);
    expect(proxyProbe?.height).toBe(540);
    expect(proxyProbe?.videoCodec).toBe('h264');
    expect(proxyProbe?.hasAudio).toBe(true);
  });
});