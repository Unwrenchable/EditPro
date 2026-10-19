/**
 * SMPTE timecode for integer and NTSC rates.
 * 29.97 is 30000/1001 and 23.976 is 24000/1001. Drop-frame skips two frame
 * numbers each minute (four at 59.94) except every tenth minute.
 */

export interface RationalRate {
  /** Editor-facing rate, such as 29.97 or 24. */
  label: number;
  /** Frames numbered in one timecode second. */
  nominal: number;
  /** One frame lasts `num / den` seconds. */
  num: number;
  den: number;
}

export const FRAME_RATES: readonly number[] = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

const KNOWN_RATES: readonly RationalRate[] = [
  { label: 23.976, nominal: 24, num: 1001, den: 24000 },
  { label: 24, nominal: 24, num: 1, den: 24 },
  { label: 25, nominal: 25, num: 1, den: 25 },
  { label: 29.97, nominal: 30, num: 1001, den: 30000 },
  { label: 30, nominal: 30, num: 1, den: 30 },
  { label: 50, nominal: 50, num: 1, den: 50 },
  { label: 59.94, nominal: 60, num: 1001, den: 60000 },
  { label: 60, nominal: 60, num: 1, den: 60 },
];

export function resolveRate(frameRate: number): RationalRate {
  let best: RationalRate = KNOWN_RATES[1];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const rate of KNOWN_RATES) {
    const delta = Math.abs(rate.label - frameRate);
    if (delta < bestDelta) {
      best = rate;
      bestDelta = delta;
    }
  }
  if (bestDelta < 0.05) return best;
  const nominal = Math.max(1, Math.round(frameRate) || 24);
  return { label: nominal, nominal, num: 1, den: nominal };
}

/** Drop-frame numbering applies to 29.97 and 59.94. */
export function supportsDropFrame(frameRate: number): boolean {
  const rate = resolveRate(frameRate);
  return rate.num === 1001 && (rate.nominal === 30 || rate.nominal === 60);
}

export function framesToSeconds(frames: number, frameRate: number): number {
  const rate = resolveRate(frameRate);
  return (frames * rate.num) / rate.den;
}

export function secondsToFrames(seconds: number, frameRate: number): number {
  const rate = resolveRate(frameRate);
  if (!Number.isFinite(seconds)) return 0;
  return Math.round((seconds * rate.den) / rate.num);
}

export function quantizeTime(seconds: number, frameRate: number): number {
  return framesToSeconds(secondsToFrames(Math.max(0, seconds), frameRate), frameRate);
}

function pad(value: number, width = 2): string {
  return String(Math.max(0, Math.floor(value))).padStart(width, '0');
}

/**
 * Frame count to `HH:MM:SS:FF` or drop-frame `HH:MM:SS;FF`.
 * `frames` is a real frame index, not a timecode that already skipped numbers.
 */
export function formatTimecode(frames: number, frameRate: number, dropFrame: boolean): string {
  const nominal = resolveRate(frameRate).nominal;
  const drop = dropFrame && (nominal === 30 || nominal === 60);
  let frameCount = Math.max(0, Math.round(frames));
  if (drop) {
    const dropFrames = nominal === 30 ? 2 : 4;
    const framesPerMinute = nominal * 60 - dropFrames;
    const framesPerTen = nominal * 60 * 10 - dropFrames * 9;
    const tens = Math.floor(frameCount / framesPerTen);
    const remainder = frameCount % framesPerTen;
    frameCount += dropFrames * 9 * tens;
    if (remainder >= dropFrames) {
      frameCount += dropFrames * Math.floor((remainder - dropFrames) / framesPerMinute);
    }
  }
  const ff = frameCount % nominal;
  const totalSeconds = Math.floor(frameCount / nominal);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${drop ? ';' : ':'}${pad(ff)}`;
}

const TIMECODE_PATTERN = /^(\d{2,}):(\d{2}):(\d{2})[:;](\d{2})$/;

export function timecodeToFrames(value: string, frameRate: number, dropFrame: boolean): number {
  const match = TIMECODE_PATTERN.exec(value.trim());
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[4]);
  const nominal = resolveRate(frameRate).nominal;
  const base = ((hours * 3600 + minutes * 60 + seconds) * nominal) + frames;
  const dropped = (dropFrame || value.includes(';')) && (nominal === 30 || nominal === 60);
  if (!dropped) return Math.max(0, base);
  const dropFrames = nominal === 30 ? 2 : 4;
  const totalMinutes = hours * 60 + minutes;
  return Math.max(0, base - dropFrames * (totalMinutes - Math.floor(totalMinutes / 10)));
}

export function secondsToTimecode(seconds: number, frameRate: number, dropFrame: boolean): string {
  return formatTimecode(secondsToFrames(seconds, frameRate), frameRate, dropFrame);
}

export function timecodeToSeconds(value: string, frameRate: number, dropFrame: boolean): number {
  return framesToSeconds(timecodeToFrames(value, frameRate, dropFrame), frameRate);
}
