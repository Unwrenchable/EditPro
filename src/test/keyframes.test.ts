import { describe, expect, it } from 'vitest';
import type { ClipKeyframe } from '../types';
import { applyEase, sampleEffect, sampleKeyframes, sampleTransform, upsertKeyframe } from '../utils/video/keyframes';

function key(partial: Partial<ClipKeyframe> & Pick<ClipKeyframe, 'time' | 'value'>): ClipKeyframe {
  return {
    id: `k${partial.time}`,
    property: 'opacity',
    easing: 'linear',
    ...partial,
  };
}

describe('keyframe curves', () => {
  it('holds, eases, and clamps the curve parameter', () => {
    expect(applyEase(0.5, 'linear')).toBe(0.5);
    expect(applyEase(0.5, 'easeIn')).toBe(0.25);
    expect(applyEase(0.5, 'easeOut')).toBe(0.75);
    expect(applyEase(0, 'easeInOut')).toBe(0);
    expect(applyEase(1, 'easeInOut')).toBe(1);
    expect(applyEase(0.5, 'easeInOut')).toBe(0.5);
    expect(applyEase(0.5, 'hold')).toBe(0);
    expect(applyEase(-2, 'linear')).toBe(0);
    expect(applyEase(2, 'linear')).toBe(1);
  });

  it('samples a channel from the previous key into the next key', () => {
    const keys = [
      key({ time: 0, value: 0, easing: 'linear' }),
      key({ time: 2, value: 100, easing: 'easeIn' }),
    ];
    expect(sampleKeyframes(keys, -1, 5)).toBe(0);
    expect(sampleKeyframes(keys, 0, 5)).toBe(0);
    expect(sampleKeyframes(keys, 1, 5)).toBe(25);
    expect(sampleKeyframes(keys, 2, 5)).toBe(100);
    expect(sampleKeyframes(keys, 8, 5)).toBe(100);
    expect(sampleKeyframes([], 1, 5)).toBe(5);
  });

  it('keeps effect parameters independent of transform channels', () => {
    const keys = [
      key({ id: 'o', time: 0, value: 1, property: 'opacity' }),
      key({ id: 'b0', time: 0, value: 0, property: 'effect', effectParam: 'blur', easing: 'linear' }),
      key({ id: 'b1', time: 2, value: 10, property: 'effect', effectParam: 'blur', easing: 'linear' }),
      key({ id: 's0', time: 0, value: 0, property: 'effect', effectParam: 'saturation', easing: 'linear' }),
      key({ id: 's1', time: 2, value: 2, property: 'effect', effectParam: 'saturation', easing: 'hold' }),
    ];
    expect(sampleTransform(keys, 1).opacity).toBe(1);
    expect(sampleTransform(keys, 1).scale).toBe(1);
    expect(sampleEffect(keys, 'blur', 1)).toBe(5);
    expect(sampleEffect(keys, 'saturation', 1)).toBe(0);
    expect(sampleEffect(keys, 'glow', 1)).toBeNull();
  });

  it('replaces a keyframe on the same channel and time', () => {
    const original = key({ id: 'a', time: 1, value: 0.2, property: 'scale', easing: 'linear' });
    const next = upsertKeyframe([original], { ...original, id: 'b', value: 2, easing: 'easeOut' });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: 'a', value: 2, easing: 'easeOut' });
  });
});
