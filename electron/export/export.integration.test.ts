/**
 * @vitest-environment node
 * Encodes a tiny synthetic clip with the real bundled ffmpeg when it is installed.
 * Skips in environments that have not downloaded the platform binary yet.
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from '../../src/utils/videoUtils.js';
import { buildExportPlan, type ExportJob } from './plan.js';

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

describe('ffmpeg export integration', () => {
  const binary = ffmpegBinary();

  it.skipIf(!binary)('renders trim, grade, fade, and audio into an H.264 file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-export-'));
    const source = path.join(dir, 'source.mp4');
    const output = path.join(dir, 'out.mp4');
    const made = await run(binary!, [
      '-hide_banner', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=24:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      source,
    ]);
    expect(made.code, made.stderr).toBe(0);

    const job: ExportJob = {
      jobId: 'aaaaaaaa-bbbb-4ccc-addd-eeeeeeeeeeee',
      sourcePath: source,
      outputPath: output,
      trimStart: 0.2,
      trimEnd: 1.6,
      playbackRate: 1,
      volume: 0.8,
      muted: false,
      videoTrackMuted: false,
      audioTrackMuted: false,
      lumetri: { ...DEFAULT_LUMETRI, exposure: 0.4, contrast: 10, saturation: 15 },
      audio: { ...DEFAULT_AUDIO, lowCut: true, loudness: -2 },
      autoReframe: 'original',
      transition: 'fade',
      clips: [],
      options: { resolution: '480p', frameRate: 24, format: 'mp4', quality: 70 },
    };
    const plan = buildExportPlan(job);
    const encoded = await run(binary!, plan.args);
    expect(encoded.code, encoded.stderr).toBe(0);
    const stat = await fs.stat(output);
    expect(stat.size).toBeGreaterThan(1000);

    const probe = await run(binary!, ['-hide_banner', '-i', output]);
    expect(probe.stderr).toMatch(/h264/i);
    expect(probe.stderr).toMatch(/Audio:/);
  });
});
