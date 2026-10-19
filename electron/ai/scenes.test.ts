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
import { runFfmpeg } from './ffmpegJob.js';
import { parseSceneLog, sceneFilterArgs } from './scenes/plan.js';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static') as string;

describe('scene score plan', () => {
  it('keeps the stronger hit when two land close together', () => {
    const hits = parseSceneLog([
      'pts_time:1.000',
      'lavfi.scene_score=0.40',
      'pts_time:1.100',
      'lavfi.scene_score=0.90',
      'pts_time:3.200',
      'lavfi.scene_score=0.50',
    ].join('\n'));
    expect(hits).toEqual([
      { time: 1.1, score: 0.9 },
      { time: 3.2, score: 0.5 },
    ]);
    expect(sceneFilterArgs('/in.mp4', 0.3).join(' ')).toContain('gt(scene\\,0.300)');
  });

  it('scores a hard cut with the bundled ffmpeg', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'editpro-scene-'));
    try {
      const video = path.join(dir, 'cut.mp4');
      await exec(ffmpeg, [
        '-y', '-hide_banner',
        '-f', 'lavfi', '-t', '1', '-i', 'color=c=black:s=160x120:r=25',
        '-f', 'lavfi', '-t', '1', '-i', 'color=c=white:s=160x120:r=25',
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        video,
      ], { windowsHide: true });
      const scenes = await runFfmpeg(ffmpeg, sceneFilterArgs(video, 0.2));
      expect(scenes.code).toBe(0);
      const hits = parseSceneLog(scenes.text);
      expect(hits.some((hit) => hit.time > 0.7 && hit.time < 1.4 && hit.score >= 0.2)).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
