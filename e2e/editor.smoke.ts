import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  evaluateBenchmarks,
  exportThroughput,
  summarizeFrameTimes,
  type BenchmarkThresholds,
} from '../src/bench/thresholds';
import { launchEditPro, projectRoot, writeMediaFixture } from './launch';

function loadThresholds(): BenchmarkThresholds {
  const file = path.join(projectRoot(), 'e2e', 'benchmarks', 'thresholds.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as BenchmarkThresholds;
}

test('import, insert, play, and export the built app', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'editpro-smoke-'));
  const fixture = await writeMediaFixture(work);
  const outputPath = path.join(work, 'export.mp4');
  const launched = await launchEditPro();
  const { app, page } = launched;

  try {
    await app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = (() => Promise.resolve({ canceled: false, filePath: destination })) as typeof dialog.showSaveDialog;
    }, outputPath);

    await expect(page.getByRole('dialog', { name: 'Welcome to EditPro' })).toBeVisible();
    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(page.getByRole('dialog', { name: 'Welcome to EditPro' })).toBeHidden();

    await page.getByRole('button', { name: /Video/ }).click();
    const opener = page.locator('input[aria-label="Open video file"]').first();
    await opener.setInputFiles(fixture.file);
    await expect(page.getByLabel('Video preview')).toBeVisible();
    await page.waitForFunction(() => {
      const video = document.querySelector('video[aria-label="Video preview"]') as HTMLVideoElement | null;
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0.5) return false;
      return video.currentSrc.startsWith('media:') || video.readyState >= 2;
    });

    const insert = page.getByRole('button', { name: 'Insert clip on timeline' });
    await expect(insert).toBeEnabled();
    await insert.click();
    await expect(page.getByRole('button', { name: /Clip bars\.mp4/ }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Mute', exact: true }).click();
    await page.getByRole('button', { name: /Play/ }).click();
    await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();
    const playback = await page.evaluate(async () => {
      const video = document.querySelector('video[aria-label="Video preview"]') as HTMLVideoElement | null;
      if (!video) return { samples: [] as number[], maxTime: 0 };
      const intervals: number[] = [];
      let maxTime = video.currentTime;
      await new Promise<void>((resolve) => {
        let settled = false;
        let last = performance.now();
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const timer = window.setTimeout(finish, 2500);
        const record = (now: number) => {
          maxTime = Math.max(maxTime, video.currentTime);
          const delta = now - last;
          last = now;
          if (delta > 0 && delta < 1000) intervals.push(delta);
          if (intervals.length >= 40) {
            window.clearTimeout(timer);
            finish();
          }
        };
        const callback = video.requestVideoFrameCallback?.bind(video);
        if (callback) {
          const step = () => {
            record(performance.now());
            if (!settled) callback(step);
          };
          callback(step);
          return;
        }
        const interval = window.setInterval(() => record(performance.now()), 16);
        window.setTimeout(() => window.clearInterval(interval), 2500);
      });
      return { samples: intervals.slice(1), maxTime };
    });
    const samples = playback.samples;
    expect(playback.maxTime).toBeGreaterThan(0.2);
    const pause = page.getByRole('button', { name: /Pause/ });
    if (await pause.count()) await pause.click();

    await page.getByRole('button', { name: 'Export file' }).click();
    await expect(page.getByRole('dialog', { name: 'Video export' })).toBeVisible();
    await page.locator('#export-platform').selectOption('custom');
    await page.locator('#export-resolution').selectOption('480p');
    await page.locator('#export-fps').selectOption('30');
    await page.locator('#export-encoder').selectOption('software');
    const started = performance.now();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect.poll(async () => {
      const alert = page.getByRole('alert');
      if (await alert.count()) return `error:${await alert.first().innerText()}`;
      const status = page.getByRole('status');
      if (await status.count() && (await status.first().innerText()).includes('Exported')) return 'done';
      return 'pending';
    }, { timeout: 120_000, intervals: [200, 500, 1000] }).toBe('done');
    const elapsedSec = (performance.now() - started) / 1000;
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);

    const thresholds = loadThresholds();
    const report = {
      frameTime: summarizeFrameTimes(samples),
      export: exportThroughput(elapsedSec, fixture.durationSec, fixture.frameRate),
    };
    const verdict = evaluateBenchmarks(report, thresholds);
    const resultsDir = path.join(projectRoot(), 'e2e', 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(
      path.join(resultsDir, 'benchmark.json'),
      `${JSON.stringify({ report, verdict, thresholds, maxTime: playback.maxTime }, null, 2)}\n`,
    );
    expect(verdict.ok, verdict.failures.join('\n')).toBe(true);
  } finally {
    await app.close();
  }
});
