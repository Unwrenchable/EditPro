import { describe, expect, it } from 'vitest';
import type { ClipKeyframe } from '../types';
import { sampleBezier } from '../../electron/export/easing';
import { motionGraph } from '../../electron/export/motion';
import { normalizeVideoEdits } from '../utils/editSnapshots';
import {
  ANIMATABLE_CHANNELS,
  applyEase,
  bezierHandlesFromDrag,
  keyframedCss,
  sampleEffect,
  sampleKeyframes,
  sampleTransform,
  upsertKeyframe,
} from '../utils/video/keyframes';

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

  it('follows a cubic bezier and round-trips the handles', () => {
    const handles = { x1: 0.2, y1: 0.85, x2: 0.3, y2: 1 };
    expect(sampleBezier(0, handles)).toBe(0);
    expect(sampleBezier(1, handles)).toBe(1);
    expect(sampleBezier(0.5, { x1: 0, y1: 0, x2: 1, y2: 1 })).toBeCloseTo(0.5, 2);
    expect(applyEase(0.5, 'bezier', handles)).toBeGreaterThan(0.5);
    expect(applyEase(0.5, 'easeIn')).toBe(0.25);

    const keys = [
      key({ time: 0, value: 0, easing: 'linear' }),
      key({ time: 2, value: 10, easing: 'bezier', bezier: handles }),
    ];
    const mid = sampleKeyframes(keys, 1, 0);
    expect(mid).toBeCloseTo(10 * sampleBezier(0.5, handles), 5);

    const dragged = bezierHandlesFromDrag(keys[0], keys[1], 'left', 0.4, 8, handles);
    expect(dragged.x1).toBeCloseTo(0.2, 5);
    expect(dragged.y1).toBeCloseTo(0.8, 5);

    const normalized = normalizeVideoEdits({
      programKeyframes: [{ id: 'b', time: 0.5, property: 'opacity', value: 0.4, easing: 'bezier', bezier: handles }],
    });
    expect(normalized.programKeyframes[0]?.bezier).toEqual(handles);
    expect(normalized.programKeyframes[0]?.easing).toBe('bezier');
  });

  it('paints and exports every animatable channel', () => {
    const keys = [
      key({ id: 'h0', time: 0, value: 0, property: 'effect', effectParam: 'hue', easing: 'linear' }),
      key({ id: 'h1', time: 1, value: 90, property: 'effect', effectParam: 'hue', easing: 'bezier', bezier: { x1: 0.2, y1: 0, x2: 0.8, y2: 1 } }),
      key({ id: 'e0', time: 0, value: 0, property: 'effect', effectParam: 'exposure', easing: 'linear' }),
      key({ id: 'e1', time: 1, value: 1, property: 'effect', effectParam: 'exposure', easing: 'linear' }),
    ];
    expect(keyframedCss(keys, 0.5)).toContain('hue-rotate(');
    expect(keyframedCss(keys, 0.5)).toContain('brightness(');

    for (const channel of ANIMATABLE_CHANNELS) {
      if (channel.property !== 'effect' || !channel.effectParam) continue;
      const delta = channel.max > channel.fallback ? Math.min(0.5, channel.max - channel.fallback) : Math.max(-0.5, channel.min - channel.fallback);
      const graph = motionGraph({
        keyframes: [
          { time: 0, property: 'effect', effectParam: channel.effectParam, value: channel.fallback, easing: 'linear' },
          { time: 1, property: 'effect', effectParam: channel.effectParam, value: channel.fallback + delta, easing: 'bezier', bezier: { x1: 0.3, y1: 0.1, x2: 0.7, y2: 0.9 } },
        ],
        width: 320,
        height: 180,
        fps: 30,
        duration: 1,
      });
      expect(graph.warnings, channel.effectParam).toEqual([]);
      expect(graph.videoFilters.length + graph.audioFilters.length, channel.effectParam).toBeGreaterThan(0);
    }
  });

  it('replaces a keyframe on the same channel and time', () => {
    const original = key({ id: 'a', time: 1, value: 0.2, property: 'scale', easing: 'linear' });
    const next = upsertKeyframe([original], { ...original, id: 'b', value: 2, easing: 'easeOut' });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: 'a', value: 2, easing: 'easeOut' });
  });
});
