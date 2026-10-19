/**
 * ffmpeg silencedetect log and the ranges a ripple delete should remove.
 */
export interface TimeRange {
  start: number;
  end: number;
}

export { parseMediaDuration } from '../probe.js';

const START = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
const END = /silence_end:\s*(-?\d+(?:\.\d+)?)/g;

export function parseSilenceLog(log: string, duration: number): TimeRange[] {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const match of log.matchAll(START)) starts.push(Number(match[1]));
  for (const match of log.matchAll(END)) ends.push(Number(match[1]));
  const ranges: TimeRange[] = [];
  const count = Math.max(starts.length, ends.length);
  for (let index = 0; index < count; index += 1) {
    const start = starts[index] ?? 0;
    const end = ends[index] ?? duration;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const from = Math.max(0, Math.min(start, end));
    const to = Math.min(duration > 0 ? duration : end, Math.max(start, end));
    if (to - from >= 0.05) ranges.push({ start: from, end: to });
  }
  return ranges;
}

/** Pull the silence in from both edges so a cut does not clip the next word. */
export function silenceCuts(silences: readonly TimeRange[], padding: number): TimeRange[] {
  const pad = Math.max(0, padding);
  const cuts: TimeRange[] = [];
  for (const silence of silences) {
    const start = silence.start + pad;
    const end = silence.end - pad;
    if (end - start >= 0.05) cuts.push({ start, end });
  }
  return cuts;
}

export function silenceFilterArgs(input: string, noiseDb: number, minDuration: number): string[] {
  const noise = Math.max(-60, Math.min(-15, noiseDb));
  const hold = Math.max(0.1, Math.min(5, minDuration));
  return [
    '-hide_banner',
    '-i',
    input,
    '-af',
    `silencedetect=noise=${noise}dB:d=${hold.toFixed(2)}`,
    '-f',
    'null',
    '-',
  ];
}
