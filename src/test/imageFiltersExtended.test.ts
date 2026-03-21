import { describe, it, expect } from 'vitest';
import { buildCSSFilter, DEFAULT_ADJUSTMENTS } from '../utils/imageFilters';
import type { PhotoAdjustments } from '../types';

describe('buildCSSFilter — extended adjustments', () => {
  it('whites increases brightness when positive', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, whites: 100 };
    const css = buildCSSFilter(adj, 'none');
    // whites adds 100/200 = 0.5 to brightness → 1.5
    expect(css).toContain('brightness(1.500)');
  });

  it('blacks decreases brightness when positive', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, blacks: 100 };
    const css = buildCSSFilter(adj, 'none');
    // blacks subtracts 100/200 = 0.5 → brightness = 0.5
    expect(css).toContain('brightness(0.500)');
  });

  it('vibrance adds to saturation', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, vibrance: 150 };
    const css = buildCSSFilter(adj, 'none');
    // saturation = 1 + 150/150 = 2.0
    expect(css).toContain('saturate(2.000)');
  });

  it('hue applies hue-rotate', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, hue: 90 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).toContain('hue-rotate(90.0deg)');
  });

  it('noise reduction adds blur above threshold of 20', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, noiseReduction: 50 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).toContain('blur(');
  });

  it('noise reduction below threshold does not add blur', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, noiseReduction: 20 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).not.toContain('blur(');
  });

  it('clarity increases contrast', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, clarity: 100 };
    const css = buildCSSFilter(adj, 'none');
    // contrast = 1 + 100/200 = 1.5
    expect(css).toContain('contrast(1.500)');
  });

  it('fade increases brightness and decreases contrast', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, fade: 100 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).toContain('brightness(1.200)');
    expect(css).toContain('contrast(0.700)');
  });

  it('dehaze adds to brightness', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, dehaze: 100 };
    const css = buildCSSFilter(adj, 'none');
    // brightness = 1 + 100/200 = 1.5
    expect(css).toContain('brightness(1.500)');
  });

  it('DEFAULT_ADJUSTMENTS has all new fields at 0', () => {
    const keys: (keyof PhotoAdjustments)[] = [
      'whites', 'blacks', 'vibrance', 'hue',
      'noiseReduction', 'clarity', 'texture', 'dehaze',
      'vignette', 'grain', 'fade',
    ];
    for (const k of keys) {
      expect(DEFAULT_ADJUSTMENTS[k]).toBe(0);
    }
  });
});
