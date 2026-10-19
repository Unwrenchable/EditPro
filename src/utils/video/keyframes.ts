import type { ClipKeyframe, EaseCurve, KeyframeProperty } from '../../types';
import {
  applyEaseAmount,
  clamp01,
  type BezierHandles,
} from '../../../electron/export/easing';

export type { BezierHandles };

/** Values used when a channel has no keyframes. */
export const TRANSFORM_DEFAULTS = {
  positionX: 0,
  positionY: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
} as const;

export interface ClipTransform {
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  opacity: number;
}

/** Every transform and effect channel the monitor and the encoder both honor. */
export interface AnimatableChannel {
  id: string;
  property: KeyframeProperty;
  effectParam?: string;
  label: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
}

export const ANIMATABLE_CHANNELS: readonly AnimatableChannel[] = [
  { id: 'positionX', property: 'positionX', label: 'Position X', min: -2, max: 2, step: 0.01, fallback: 0 },
  { id: 'positionY', property: 'positionY', label: 'Position Y', min: -2, max: 2, step: 0.01, fallback: 0 },
  { id: 'scale', property: 'scale', label: 'Scale', min: 0.01, max: 4, step: 0.01, fallback: 1 },
  { id: 'rotation', property: 'rotation', label: 'Rotation', min: -360, max: 360, step: 1, fallback: 0 },
  { id: 'opacity', property: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, fallback: 1 },
  { id: 'effect:blur', property: 'effect', effectParam: 'blur', label: 'Blur', min: 0, max: 40, step: 0.1, fallback: 0 },
  { id: 'effect:brightness', property: 'effect', effectParam: 'brightness', label: 'Brightness', min: -1, max: 1, step: 0.01, fallback: 0 },
  { id: 'effect:contrast', property: 'effect', effectParam: 'contrast', label: 'Contrast', min: 0, max: 3, step: 0.01, fallback: 1 },
  { id: 'effect:saturation', property: 'effect', effectParam: 'saturation', label: 'Saturation', min: 0, max: 3, step: 0.01, fallback: 1 },
  { id: 'effect:hue', property: 'effect', effectParam: 'hue', label: 'Hue', min: -180, max: 180, step: 1, fallback: 0 },
  { id: 'effect:exposure', property: 'effect', effectParam: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, fallback: 0 },
  { id: 'effect:sharpen', property: 'effect', effectParam: 'sharpen', label: 'Sharpen', min: 0, max: 5, step: 0.05, fallback: 0 },
  { id: 'effect:volume', property: 'effect', effectParam: 'volume', label: 'Volume', min: 0, max: 2, step: 0.01, fallback: 1 },
];

export type KeyframePatch = Partial<Pick<ClipKeyframe, 'time' | 'value' | 'easing' | 'bezier'>>;

export function findChannel(property: KeyframeProperty, effectParam?: string): AnimatableChannel | undefined {
  if (property === 'effect') {
    return ANIMATABLE_CHANNELS.find((channel) => channel.property === 'effect' && channel.effectParam === effectParam);
  }
  return ANIMATABLE_CHANNELS.find((channel) => channel.property === property);
}

export function channelId(property: KeyframeProperty, effectParam?: string): string {
  return findChannel(property, effectParam)?.id ?? (property === 'effect' ? `effect:${effectParam ?? ''}` : property);
}

export function defaultKeyframeValue(property: KeyframeProperty, effectParam?: string): number {
  const channel = findChannel(property, effectParam);
  if (channel) return channel.fallback;
  if (property === 'scale' || property === 'opacity') return 1;
  return 0;
}

export { clamp01 };

/** Curve from the previous key (t = 0) to this key (t = 1). `hold` waits at the previous value. */
export function applyEase(t: number, easing: EaseCurve, bezier?: BezierHandles): number {
  return applyEaseAmount(t, easing, bezier);
}

export function sameChannel(a: Pick<ClipKeyframe, 'property' | 'effectParam'>, b: Pick<ClipKeyframe, 'property' | 'effectParam'>): boolean {
  if (a.property !== b.property) return false;
  if (a.property !== 'effect') return true;
  return a.effectParam === b.effectParam;
}

export function channelKeyframes(
  keyframes: readonly ClipKeyframe[] | undefined,
  property: KeyframeProperty,
  effectParam?: string,
): ClipKeyframe[] {
  if (!keyframes || keyframes.length === 0) return [];
  return keyframes
    .filter((keyframe) => sameChannel(keyframe, { property, effectParam }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Value of one channel at `time`.
 * Before the first key and after the last key the nearest value is held.
 */
export function sampleKeyframes(keyframes: readonly ClipKeyframe[], time: number, fallback: number): number {
  if (keyframes.length === 0) return fallback;
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const first = sorted[0];
  if (time <= first.time) return first.value;
  const last = sorted[sorted.length - 1];
  if (time >= last.time) return last.value;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index];
    const right = sorted[index + 1];
    if (time < left.time || time > right.time) continue;
    const span = right.time - left.time;
    const amount = span <= 1e-6 ? 1 : (time - left.time) / span;
    return left.value + (right.value - left.value) * applyEase(amount, right.easing, right.bezier);
  }
  return last.value;
}

export function sampleTransform(keyframes: readonly ClipKeyframe[] | undefined, time: number): ClipTransform {
  const source = keyframes ?? [];
  return {
    positionX: sampleKeyframes(channelKeyframes(source, 'positionX'), time, TRANSFORM_DEFAULTS.positionX),
    positionY: sampleKeyframes(channelKeyframes(source, 'positionY'), time, TRANSFORM_DEFAULTS.positionY),
    scale: sampleKeyframes(channelKeyframes(source, 'scale'), time, TRANSFORM_DEFAULTS.scale),
    rotation: sampleKeyframes(channelKeyframes(source, 'rotation'), time, TRANSFORM_DEFAULTS.rotation),
    opacity: sampleKeyframes(channelKeyframes(source, 'opacity'), time, TRANSFORM_DEFAULTS.opacity),
  };
}

/** Null when this effect parameter is not animated. */
export function sampleEffect(
  keyframes: readonly ClipKeyframe[] | undefined,
  effectParam: string,
  time: number,
): number | null {
  const channel = channelKeyframes(keyframes, 'effect', effectParam);
  if (channel.length === 0) return null;
  return sampleKeyframes(channel, time, channel[0].value);
}

/** CSS filter fragment for every keyframed effect the preview can paint. */
export function keyframedCss(keyframes: readonly ClipKeyframe[] | undefined, time: number): string {
  const parts: string[] = [];
  const add = (param: string, format: (value: number) => string | null) => {
    const value = sampleEffect(keyframes, param, time);
    if (value === null) return;
    const css = format(value);
    if (css) parts.push(css);
  };
  add('brightness', (value) => `brightness(${(1 + value).toFixed(3)})`);
  add('contrast', (value) => `contrast(${value.toFixed(3)})`);
  add('saturation', (value) => `saturate(${value.toFixed(3)})`);
  add('blur', (value) => `blur(${Math.max(0, value).toFixed(2)}px)`);
  add('hue', (value) => `hue-rotate(${value.toFixed(2)}deg)`);
  add('exposure', (value) => `brightness(${Math.max(0, 2 ** value).toFixed(3)})`);
  add('sharpen', (value) => (value > 0.001 ? `contrast(${(1 + value * 0.35).toFixed(3)})` : null));
  return parts.join(' ');
}

export function upsertKeyframe(keyframes: readonly ClipKeyframe[], next: ClipKeyframe): ClipKeyframe[] {
  const index = keyframes.findIndex(
    (keyframe) => sameChannel(keyframe, next) && Math.abs(keyframe.time - next.time) < 0.001,
  );
  if (index >= 0) {
    const copy = keyframes.slice();
    const previous = copy[index];
    copy[index] = {
      ...previous,
      value: next.value,
      easing: next.easing,
      ...(next.bezier ? { bezier: next.bezier } : {}),
    };
    return copy;
  }
  return [...keyframes, next].sort((a, b) => a.time - b.time || a.property.localeCompare(b.property));
}

export function updateKeyframe(
  keyframes: readonly ClipKeyframe[],
  keyframeId: string,
  patch: KeyframePatch,
): ClipKeyframe[] {
  return keyframes
    .map((keyframe) => (keyframe.id === keyframeId ? { ...keyframe, ...patch } : keyframe))
    .sort((a, b) => a.time - b.time || a.property.localeCompare(b.property));
}

export function removeKeyframe(keyframes: readonly ClipKeyframe[], keyframeId: string): ClipKeyframe[] {
  return keyframes.filter((keyframe) => keyframe.id !== keyframeId);
}

/** Keep keyframes inside a clip after a trim. `shift` moves them when the head is removed. */
export function retimedKeyframes(
  keyframes: readonly ClipKeyframe[] | undefined,
  shift: number,
  duration: number,
): ClipKeyframe[] | undefined {
  if (!keyframes) return undefined;
  const next = keyframes
    .map((keyframe) => ({ ...keyframe, time: keyframe.time - shift }))
    .filter((keyframe) => keyframe.time >= -1e-4 && keyframe.time <= duration + 1e-4)
    .map((keyframe) => ({ ...keyframe, time: Math.min(duration, Math.max(0, keyframe.time)) }));
  return next;
}

/** Map a dragged graph point back onto the cubic that arrives at `right`. */
export function bezierHandlesFromDrag(
  left: Pick<ClipKeyframe, 'time' | 'value'>,
  right: Pick<ClipKeyframe, 'time' | 'value'>,
  which: 'left' | 'right',
  time: number,
  value: number,
  current: BezierHandles,
): BezierHandles {
  const span = right.time - left.time;
  const x = span <= 1e-6 ? (which === 'left' ? current.x1 : current.x2) : clamp01((time - left.time) / span);
  const delta = right.value - left.value;
  const rawY = Math.abs(delta) <= 1e-6 ? (which === 'left' ? current.y1 : current.y2) : (value - left.value) / delta;
  const y = Math.min(1.5, Math.max(-0.5, rawY));
  return which === 'left' ? { ...current, x1: x, y1: y } : { ...current, x2: x, y2: y };
}
