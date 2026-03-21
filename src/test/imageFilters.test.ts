import { describe, it, expect } from 'vitest';
import {
  buildCSSFilter,
  buildTransform,
  formatFileSize,
  PHOTO_FILTERS,
  DEFAULT_ADJUSTMENTS,
} from '../utils/imageFilters';
import type { PhotoAdjustments } from '../types';

describe('buildCSSFilter', () => {
  it('returns default brightness=1, contrast=1, saturate=1 when all adjustments are 0', () => {
    const css = buildCSSFilter(DEFAULT_ADJUSTMENTS, 'none');
    expect(css).toContain('brightness(1.000)');
    expect(css).toContain('contrast(1.000)');
    expect(css).toContain('saturate(1.000)');
  });

  it('increases brightness when brightness adjustment is positive', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, brightness: 50 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).toContain('brightness(1.500)');
  });

  it('decreases brightness when brightness adjustment is negative', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, brightness: -50 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).toContain('brightness(0.500)');
  });

  it('adds grayscale filter for grayscale preset', () => {
    const css = buildCSSFilter(DEFAULT_ADJUSTMENTS, 'grayscale');
    expect(css).toContain('grayscale(100%)');
  });

  it('does not add hue-rotate when temperature is 0', () => {
    const css = buildCSSFilter(DEFAULT_ADJUSTMENTS, 'none');
    expect(css).not.toContain('hue-rotate');
  });

  it('adds hue-rotate when temperature is non-zero', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, temperature: 100 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).toContain('hue-rotate');
  });

  it('clamps brightness to minimum 0', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, brightness: -100, exposure: -100 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).toContain('brightness(0.000)');
  });

  it('adds sharpness contrast when sharpness > 0', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, sharpness: 50 };
    const css = buildCSSFilter(adj, 'none');
    // Should have two contrast calls (base + sharpness)
    const contrasts = (css.match(/contrast\(/g) || []).length;
    expect(contrasts).toBeGreaterThanOrEqual(2);
  });

  it('exposure adds to brightness', () => {
    const adj: PhotoAdjustments = { ...DEFAULT_ADJUSTMENTS, brightness: 0, exposure: 50 };
    const css = buildCSSFilter(adj, 'none');
    expect(css).toContain('brightness(1.500)');
  });
});

describe('buildTransform', () => {
  it('returns "none" when no rotation or flip', () => {
    expect(buildTransform(0, false, false)).toBe('none');
  });

  it('includes rotate for non-zero rotation', () => {
    expect(buildTransform(90, false, false)).toContain('rotate(90deg)');
  });

  it('includes scale for horizontal flip', () => {
    expect(buildTransform(0, true, false)).toContain('scale(-1, 1)');
  });

  it('includes scale for vertical flip', () => {
    expect(buildTransform(0, false, true)).toContain('scale(1, -1)');
  });

  it('combines rotation and flip', () => {
    const t = buildTransform(180, true, false);
    expect(t).toContain('rotate(180deg)');
    expect(t).toContain('scale(-1, 1)');
  });
});

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
  });

  it('formats fractional megabytes', () => {
    expect(formatFileSize(1572864)).toBe('1.5 MB');
  });
});

describe('PHOTO_FILTERS', () => {
  it('includes "none" as the first filter', () => {
    expect(PHOTO_FILTERS[0].name).toBe('none');
  });

  it('has at least 5 filters', () => {
    expect(PHOTO_FILTERS.length).toBeGreaterThanOrEqual(5);
  });

  it('each filter has name, label, and css fields', () => {
    for (const f of PHOTO_FILTERS) {
      expect(typeof f.name).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(typeof f.css).toBe('string');
    }
  });
});
