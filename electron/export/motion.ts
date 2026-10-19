/**
 * Keyframed motion → ffmpeg filters.
 * Expressions are escaped for filtergraphs. `eval=frame` is intentionally
 * avoided: the bundled ffmpeg aborts on scale=eval=frame.
 */

import {
  applyEaseAmount,
  bezierEaseExpression,
  DEFAULT_BEZIER,
  type BezierHandles,
  type EaseCurve,
} from './easing.js';

export type ExportEase = EaseCurve;
export type { BezierHandles };

export type ExportKeyframeProperty = 'positionX' | 'positionY' | 'scale' | 'rotation' | 'opacity' | 'effect';

export interface ExportKeyframe {
  time: number;
  property: ExportKeyframeProperty;
  value: number;
  easing: ExportEase;
  /** Required when property is `effect`. */
  effectParam?: string;
  /** Unit-square cubic used when `easing` is `bezier`. */
  bezier?: BezierHandles;
}

const TRANSFORM: Record<Exclude<ExportKeyframeProperty, 'effect'>, number> = {
  positionX: 0,
  positionY: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

const MAPPED_EFFECTS = new Set([
  'blur',
  'brightness',
  'contrast',
  'saturation',
  'volume',
  'hue',
  'exposure',
  'sharpen',
]);

function num(value: number): string {
  return value.toFixed(3);
}

function escapeCommas(expression: string): string {
  return expression.replace(/,/g, '\\,');
}

function easeExpression(keyframe: ExportKeyframe, amount: string): string {
  switch (keyframe.easing) {
    case 'hold':
      return '0';
    case 'linear':
      return amount;
    case 'easeIn':
      return `(${amount})*(${amount})`;
    case 'easeOut':
      return `(1-(1-(${amount}))*(1-(${amount})))`;
    case 'easeInOut':
      return `if(lt(${amount},0.5),2*(${amount})*(${amount}),1-(((-2*(${amount})+2)*(-2*(${amount})+2))/2))`;
    case 'bezier':
      return bezierEaseExpression(keyframe.bezier ?? DEFAULT_BEZIER, amount);
    default:
      return amount;
  }
}

export function keyframeExpression(
  keyframes: readonly ExportKeyframe[],
  fallback: number,
  timeVar: string,
): string {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return num(fallback);
  const firstValue = num(sorted[0].value);
  if (sorted.length === 1 || sorted.every((keyframe) => num(keyframe.value) === firstValue)) {
    return firstValue;
  }
  let expression = num(sorted[sorted.length - 1].value);
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    const span = right.time - left.time;
    const amount = span <= 1e-6 ? '1' : `((${timeVar}-${num(left.time)})/${num(span)})`;
    const eased = easeExpression(right, amount);
    const lerp = `(${num(left.value)}+(${num(right.value)}-${num(left.value)})*(${eased}))`;
    expression = `if(lt(${timeVar},${num(right.time)}),${lerp},${expression})`;
  }
  expression = `if(lt(${timeVar},${num(sorted[0].time)}),${num(sorted[0].value)},${expression})`;
  return expression;
}

function channel(
  keyframes: readonly ExportKeyframe[],
  property: ExportKeyframeProperty,
  effectParam?: string,
): ExportKeyframe[] {
  return keyframes.filter((keyframe) => {
    if (keyframe.property !== property) return false;
    if (property !== 'effect') return true;
    return keyframe.effectParam === effectParam;
  });
}

function varying(expression: string, fallback: number): boolean {
  return expression !== num(fallback);
}

export interface MotionGraph {
  videoFilters: string[];
  /** Extra audio filters, such as a keyframed volume. */
  audioFilters: string[];
  warnings: string[];
}

export function motionGraph(options: {
  keyframes: readonly ExportKeyframe[] | undefined;
  width: number;
  height: number;
  fps: number;
  duration: number;
}): MotionGraph {
  const keyframes = options.keyframes ?? [];
  const videoFilters: string[] = [];
  const audioFilters: string[] = [];
  const warnings: string[] = [];
  if (keyframes.length === 0) return { videoFilters, audioFilters, warnings };

  const scale = keyframeExpression(channel(keyframes, 'scale'), TRANSFORM.scale, 'time');
  const positionX = keyframeExpression(channel(keyframes, 'positionX'), TRANSFORM.positionX, 'time');
  const positionY = keyframeExpression(channel(keyframes, 'positionY'), TRANSFORM.positionY, 'time');
  if (varying(scale, 1) || varying(positionX, 0) || varying(positionY, 0)) {
    const x = varying(positionX, 0)
      ? `(iw-iw/zoom)/2+(${positionX})*iw`
      : '(iw-iw/zoom)/2';
    const y = varying(positionY, 0)
      ? `(ih-ih/zoom)/2+(${positionY})*ih`
      : '(ih-ih/zoom)/2';
    videoFilters.push(
      `zoompan=z='${escapeCommas(scale)}':d=1:x='${escapeCommas(x)}':y='${escapeCommas(y)}':s=${options.width}x${options.height}:fps=${options.fps}`,
    );
  }

  const rotation = keyframeExpression(channel(keyframes, 'rotation'), TRANSFORM.rotation, 't');
  if (varying(rotation, 0)) {
    videoFilters.push(`rotate=a='${escapeCommas(rotation)}*PI/180':ow=iw:oh=ih:c=black`);
  }

  const opacity = keyframeExpression(channel(keyframes, 'opacity'), TRANSFORM.opacity, 'T');
  if (varying(opacity, 1)) {
    const amount = escapeCommas(opacity);
    videoFilters.push(
      [
        `geq=lum='clip(lum(X\\,Y)*(${amount})\\,0\\,255)'`,
        `cb='clip((cb(X\\,Y)-128)*(${amount})+128\\,0\\,255)'`,
        `cr='clip((cr(X\\,Y)-128)*(${amount})+128\\,0\\,255)'`,
      ].join(':'),
    );
  }

  const effectNames = [...new Set(
    keyframes
      .filter((keyframe) => keyframe.property === 'effect' && keyframe.effectParam)
      .map((keyframe) => keyframe.effectParam as string),
  )];
  for (const name of effectNames) {
    const keys = channel(keyframes, 'effect', name);
    if (!MAPPED_EFFECTS.has(name)) {
      warnings.push(`Effect parameter "${name}" has no ffmpeg mapping and was left out of the export.`);
      continue;
    }
    if (name === 'volume') {
      audioFilters.push(`volume='${escapeCommas(keyframeExpression(keys, 1, 't'))}'`);
      continue;
    }
    if (name === 'saturation') {
      videoFilters.push(`hue=s='${escapeCommas(keyframeExpression(keys, 1, 't'))}'`);
      continue;
    }
    if (name === 'brightness') {
      videoFilters.push(`hue=b='${escapeCommas(keyframeExpression(keys, 0, 't'))}'`);
      continue;
    }
    if (name === 'contrast') {
      const amount = escapeCommas(keyframeExpression(keys, 1, 'T'));
      videoFilters.push(
        `geq=lum='clip((lum(X\\,Y)-128)*(${amount})+128\\,0\\,255)':cb='cb(X\\,Y)':cr='cr(X\\,Y)'`,
      );
      continue;
    }
    if (name === 'hue') {
      videoFilters.push(`hue=h='${escapeCommas(keyframeExpression(keys, 0, 't'))}'`);
      continue;
    }
    if (name === 'exposure' || name === 'sharpen') {
      pushWindowed(videoFilters, keys, options.duration, (value, start, end, flat) => {
        if (Math.abs(value) < 0.02) return null;
        const enable = flat ? '' : `:enable='between(t\\,${num(start)}\\,${num(end)})'`;
        if (name === 'exposure') return `exposure=exposure=${value.toFixed(3)}${enable}`;
        return `unsharp=5:5:${Math.max(0, value).toFixed(3)}${enable}`;
      });
      continue;
    }
    const duration = Math.max(options.duration, 0.05);
    const steps = Math.min(8, Math.max(2, Math.ceil(duration / 0.5)));
    const constant = keyframeExpression(keys, 0, 't');
    for (let step = 0; step < steps; step += 1) {
      const start = (duration * step) / steps;
      const end = (duration * (step + 1)) / steps;
      const sigma = Math.max(
        0,
        constant === num(keys[0].value) ? keys[0].value : sampleLinear(keys, (start + end) / 2),
      );
      if (sigma < 0.05) continue;
      videoFilters.push(
        `gblur=sigma=${sigma.toFixed(2)}:enable='between(t\\,${num(start)}\\,${num(end)})'`,
      );
    }
  }

  return { videoFilters, audioFilters, warnings };
}

function sampleLinear(keyframes: readonly ExportKeyframe[], time: number): number {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return 0;
  if (time <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return last.value;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (time < left.time || time > right.time) continue;
    const span = right.time - left.time;
    const amount = span <= 1e-6 ? 1 : (time - left.time) / span;
    return left.value + (right.value - left.value) * applyEaseAmount(amount, right.easing, right.bezier);
  }
  return last.value;
}

function pushWindowed(
  videoFilters: string[],
  keys: readonly ExportKeyframe[],
  duration: number,
  emit: (value: number, start: number, end: number, flat: boolean) => string | null,
): void {
  if (keys.length === 0) return;
  const span = Math.max(duration, 0.05);
  const expression = keyframeExpression(keys, keys[0].value, 't');
  const flat = expression === num(keys[0].value);
  const steps = flat ? 1 : Math.min(8, Math.max(2, Math.ceil(span / 0.5)));
  for (let step = 0; step < steps; step += 1) {
    const start = flat ? 0 : (span * step) / steps;
    const end = flat ? span : (span * (step + 1)) / steps;
    const value = flat ? keys[0].value : sampleLinear(keys, (start + end) / 2);
    const filter = emit(value, start, end, flat);
    if (filter) videoFilters.push(filter);
  }
}

/** Shift absolute sequence times onto a segment that starts at `offset`, then account for playback rate. */
export function prepareKeyframes(
  keyframes: readonly ExportKeyframe[] | undefined,
  offset: number,
  rate: number,
): ExportKeyframe[] | undefined {
  if (!keyframes || keyframes.length === 0) return undefined;
  const safeRate = rate > 0 ? rate : 1;
  return keyframes.map((keyframe) => ({ ...keyframe, time: (keyframe.time - offset) / safeRate }));
}
