import type { ClipKeyframe, EaseCurve, KeyframeProperty } from '../../types';

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

export function defaultKeyframeValue(property: KeyframeProperty): number {
  if (property === 'scale' || property === 'opacity') return 1;
  return 0;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Curve from the previous key (t = 0) to this key (t = 1). `hold` waits at the previous value. */
export function applyEase(t: number, easing: EaseCurve): number {
  const x = clamp01(t);
  switch (easing) {
    case 'hold':
      return 0;
    case 'linear':
      return x;
    case 'easeIn':
      return x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) * (-2 * x + 2)) / 2;
    default:
      return x;
  }
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
    return left.value + (right.value - left.value) * applyEase(amount, right.easing);
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

export function upsertKeyframe(keyframes: readonly ClipKeyframe[], next: ClipKeyframe): ClipKeyframe[] {
  const index = keyframes.findIndex(
    (keyframe) => sameChannel(keyframe, next) && Math.abs(keyframe.time - next.time) < 0.001,
  );
  if (index >= 0) {
    const copy = keyframes.slice();
    copy[index] = { ...copy[index], value: next.value, easing: next.easing };
    return copy;
  }
  return [...keyframes, next].sort((a, b) => a.time - b.time || a.property.localeCompare(b.property));
}

export function updateKeyframe(
  keyframes: readonly ClipKeyframe[],
  keyframeId: string,
  patch: Partial<Pick<ClipKeyframe, 'time' | 'value' | 'easing'>>,
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
