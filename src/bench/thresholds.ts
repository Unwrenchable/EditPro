/**
 * Regression gates for the Electron UI benchmark.
 * Frame time is the gap between presented preview frames.
 * Export throughput is encoded frames divided by wall-clock seconds.
 */

export interface FrameTimeSummary {
  count: number;
  meanMs: number;
  p95Ms: number;
}

export interface ExportThroughput {
  elapsedSec: number;
  outputDurationSec: number;
  frameRate: number;
  frames: number;
  throughputFps: number;
}

export interface BenchmarkThresholds {
  /** Fail when the 95th percentile presented-frame gap is slower than this. */
  frameTimeP95Ms: number;
  /** Fail when the encoder produces fewer frames per wall-clock second than this. */
  exportThroughputFps: number;
  /** Ignore a playback sample that did not collect at least this many intervals. */
  minFrameSamples: number;
}

export interface BenchmarkReport {
  frameTime: FrameTimeSummary;
  export: ExportThroughput;
}

export interface ThresholdVerdict {
  ok: boolean;
  failures: string[];
}

/** Inclusive nearest-rank percentile. `sorted` must already be ascending. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0 || !Number.isFinite(p)) return Number.NaN;
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((clamped / 100) * sorted.length) - 1));
  return sorted[rank];
}

export function summarizeFrameTimes(samplesMs: readonly number[]): FrameTimeSummary {
  const finite = samplesMs.filter((sample) => Number.isFinite(sample) && sample >= 0);
  if (finite.length === 0) return { count: 0, meanMs: Number.NaN, p95Ms: Number.NaN };
  const sorted = [...finite].sort((left, right) => left - right);
  const meanMs = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;
  return { count: sorted.length, meanMs, p95Ms: percentile(sorted, 95) };
}

export function exportThroughput(
  elapsedSec: number,
  outputDurationSec: number,
  frameRate: number,
): ExportThroughput {
  const safeElapsed = Number.isFinite(elapsedSec) && elapsedSec > 0 ? elapsedSec : 0;
  const safeDuration = Number.isFinite(outputDurationSec) && outputDurationSec > 0 ? outputDurationSec : 0;
  const safeRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 0;
  const frames = safeDuration * safeRate;
  const throughputFps = safeElapsed > 0 ? frames / safeElapsed : 0;
  return {
    elapsedSec: safeElapsed,
    outputDurationSec: safeDuration,
    frameRate: safeRate,
    frames,
    throughputFps,
  };
}

export function evaluateBenchmarks(
  report: BenchmarkReport,
  thresholds: BenchmarkThresholds,
): ThresholdVerdict {
  const failures: string[] = [];
  if (!Number.isFinite(report.frameTime.p95Ms) || report.frameTime.count < thresholds.minFrameSamples) {
    failures.push(
      `frame time sample is too small (${report.frameTime.count} intervals, need ${thresholds.minFrameSamples})`,
    );
  } else if (report.frameTime.p95Ms > thresholds.frameTimeP95Ms) {
    failures.push(
      `frame time p95 ${report.frameTime.p95Ms.toFixed(2)} ms exceeds ${thresholds.frameTimeP95Ms} ms`,
    );
  }
  if (!Number.isFinite(report.export.throughputFps) || report.export.throughputFps < thresholds.exportThroughputFps) {
    failures.push(
      `export throughput ${report.export.throughputFps.toFixed(2)} fps is below ${thresholds.exportThroughputFps} fps`,
    );
  }
  return { ok: failures.length === 0, failures };
}
