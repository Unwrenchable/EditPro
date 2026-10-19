import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateBenchmarks,
  exportThroughput,
  percentile,
  summarizeFrameTimes,
  type BenchmarkThresholds,
} from '../src/bench/thresholds.ts';

const thresholdsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../e2e/benchmarks/thresholds.json',
);

function loadThresholds(): BenchmarkThresholds {
  return JSON.parse(readFileSync(thresholdsPath, 'utf8')) as BenchmarkThresholds;
}

describe('benchmark thresholds', () => {
  it('ranks the 95th percentile from an ordered sample', () => {
    const samples = [10, 12, 11, 40, 13, 14, 15, 16, 17, 18];
    const summary = summarizeFrameTimes(samples);
    expect(summary.count).toBe(10);
    expect(summary.meanMs).toBeCloseTo(16.6, 5);
    expect(summary.p95Ms).toBe(40);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(summarizeFrameTimes([])).toMatchObject({ count: 0 });
  });

  it('turns encoded duration and wall time into frames per second', () => {
    expect(exportThroughput(2, 2, 30)).toMatchObject({ frames: 60, throughputFps: 30 });
    expect(exportThroughput(0, 2, 30).throughputFps).toBe(0);
    expect(exportThroughput(Number.NaN, -1, 0).frames).toBe(0);
  });

  it('fails a slow preview or a slow export and accepts a healthy run', () => {
    const thresholds = loadThresholds();
    expect(thresholds.frameTimeP95Ms).toBeGreaterThan(33);
    expect(thresholds.exportThroughputFps).toBeGreaterThan(0);
    const healthy = evaluateBenchmarks(
      {
        frameTime: summarizeFrameTimes(Array.from({ length: 20 }, () => 16)),
        export: exportThroughput(2, 2, 30),
      },
      thresholds,
    );
    expect(healthy.ok).toBe(true);

    const slowPreview = evaluateBenchmarks(
      {
        frameTime: summarizeFrameTimes(Array.from({ length: 20 }, () => thresholds.frameTimeP95Ms + 5)),
        export: exportThroughput(1, 2, 30),
      },
      thresholds,
    );
    expect(slowPreview.ok).toBe(false);
    expect(slowPreview.failures.some((line) => line.includes('frame time'))).toBe(true);

    const slowExport = evaluateBenchmarks(
      {
        frameTime: summarizeFrameTimes(Array.from({ length: 20 }, () => 20)),
        export: exportThroughput(100, 2, 30),
      },
      thresholds,
    );
    expect(slowExport.ok).toBe(false);
    expect(slowExport.failures.some((line) => line.includes('export throughput'))).toBe(true);

    const short = evaluateBenchmarks(
      {
        frameTime: summarizeFrameTimes([16, 16]),
        export: exportThroughput(1, 2, 30),
      },
      thresholds,
    );
    expect(short.failures[0]).toMatch(/too small/);
  });
});
