/**
 * @vitest-environment node
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { keptRanges, renderCutArgs } from './cuts/plan.js';
import { runFfmpeg } from './ffmpegJob.js';
import { parseMediaDuration, parseSilenceLog, silenceCuts, silenceFilterArgs } from './silence/plan.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static') as string;

describe('silence plan', () => {
  it('pairs silence ranges, pads the edges, and keeps the complement', () => {
    const log = [
      'Duration: 00:00:06.00',
      'silence_start: 1.0',
      'silence_end: 2.5',
      'silence_start: 4',
    ].join('\n');
    expect(parseMediaDuration(log)).toBe(6);
    const raw = parseSilenceLog(log, 6);
    expect(raw).toEqual([{ start: 1, end: 2.5 }, { start: 4, end: 6 }]);
    expect(silenceCuts(raw, 0.08)[0]).toEqual({ start: 1.08, end: 2.42 });
    expect(silenceFilterArgs('/in.mp4', -99, 9).join(' ')).toContain('silencedetect=noise=-60dB:d=5.00');
    const kept = keptRanges(10, [{ start: 2, end: 4 }, { start: 8, end: 9 }]);
    expect(kept).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 8 },
      { start: 9, end: 10 },
    ]);
    expect(renderCutArgs('/in.mp4', kept, '/out.mp4', false).join(' ')).toContain('between(t\\,0.000\\,2.000)');
  });

  it('finds a generated silent gap with the bundled ffmpeg', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-silence-'));
    try {
      const wav = path.join(dir, 'gap.wav');
      await exec(ffmpeg, [
        '-y', '-hide_banner',
        '-f', 'lavfi', '-t', '1', '-i', 'sine=frequency=440:sample_rate=16000',
        '-f', 'lavfi', '-t', '1.2', '-i', 'anullsrc=r=16000:cl=mono',
        '-f', 'lavfi', '-t', '1', '-i', 'sine=frequency=440:sample_rate=16000',
        '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1',
        wav,
      ], { windowsHide: true });
      const silence = await runFfmpeg(ffmpeg, silenceFilterArgs(wav, -30, 0.4));
      expect(silence.code).toBe(0);
      const duration = parseMediaDuration(silence.text) ?? 0;
      const gaps = parseSilenceLog(silence.text, duration);
      expect(gaps.some((gap) => gap.start >= 0.8 && gap.end <= 2.4 && gap.end - gap.start >= 0.8)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
