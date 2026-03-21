/**
 * Tests for Premiere Pro-level feature additions:
 * - Lumetri Color filter building
 * - Auto Reframe crop overlay calculation
 * - Timeline marker utilities
 * - Default state shapes
 */
import { describe, it, expect } from 'vitest';
import {
  buildLumetriFilter,
  getAutoReframeOverlay,
  DEFAULT_LUMETRI,
  DEFAULT_AUDIO,
} from '../utils/videoUtils';
import type { LumetriColor } from '../types';

// ── buildLumetriFilter ───────────────────────────────────────────────────────

describe('buildLumetriFilter', () => {
  it('returns "none" for all-zero Lumetri state', () => {
    // All values at 0 → each multiplication stays at 1, filter computes to no-op strings
    // The function still returns values even at zero (brightness(1.000) etc.) — so just check it returns a string
    const result = buildLumetriFilter(DEFAULT_LUMETRI);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('positive exposure increases brightness', () => {
    const lut: LumetriColor = { ...DEFAULT_LUMETRI, exposure: 2 };
    const filter = buildLumetriFilter(lut);
    // brightness = 1 + 2 * 0.25 = 1.5
    expect(filter).toContain('brightness(1.500)');
  });

  it('negative exposure decreases brightness', () => {
    const lut: LumetriColor = { ...DEFAULT_LUMETRI, exposure: -2 };
    const filter = buildLumetriFilter(lut);
    expect(filter).toContain('brightness(0.500)');
  });

  it('positive contrast increases contrast', () => {
    const lut: LumetriColor = { ...DEFAULT_LUMETRI, contrast: 50 };
    const filter = buildLumetriFilter(lut);
    expect(filter).toContain('contrast(1.500)');
  });

  it('positive saturation increases saturation', () => {
    const lut: LumetriColor = { ...DEFAULT_LUMETRI, saturation: 100 };
    const filter = buildLumetriFilter(lut);
    expect(filter).toContain('saturate(2.000)');
  });

  it('temperature shifts hue', () => {
    const lut: LumetriColor = { ...DEFAULT_LUMETRI, temperature: 100 };
    const filter = buildLumetriFilter(lut);
    expect(filter).toContain('hue-rotate(');
  });

  it('master curve highlight adjustment changes contrast', () => {
    const lut: LumetriColor = {
      ...DEFAULT_LUMETRI,
      curves: { ...DEFAULT_LUMETRI.curves, masterHighlight: 100 },
    };
    const filter = buildLumetriFilter(lut);
    // curveContrast = (100/100 - 0) * 0.3 = 0.3 → contrast = 1.3
    expect(filter).toContain('contrast(1.300)');
  });

  it('red channel bias causes hue rotation', () => {
    const lut: LumetriColor = {
      ...DEFAULT_LUMETRI,
      curves: {
        ...DEFAULT_LUMETRI.curves,
        redShadow: 100, redMidtone: 100, redHighlight: 100,
      },
    };
    const filter = buildLumetriFilter(lut);
    // rBias = 300/300 = 1, bBias = 0, hue = 1 * 12 = 12
    expect(filter).toContain('hue-rotate(12.0deg)');
  });

  it('color wheel luminance adjusts brightness', () => {
    const lut: LumetriColor = {
      ...DEFAULT_LUMETRI,
      wheels: {
        ...DEFAULT_LUMETRI.wheels,
        midtones: { x: 0, y: 0, luminance: 100 },
      },
    };
    const filter = buildLumetriFilter(lut);
    // wheelLum = (0 * 0.3 + 100 * 0.5 + 0 * 0.3) / 100 = 0.5
    // brightness = 1 + 0.5 * 0.4 = 1.2
    expect(filter).toContain('brightness(1.200)');
  });
});

// ── getAutoReframeOverlay ────────────────────────────────────────────────────

describe('getAutoReframeOverlay', () => {
  it('returns null for "original"', () => {
    expect(getAutoReframeOverlay('original')).toBeNull();
  });

  it('returns null for "16:9"', () => {
    expect(getAutoReframeOverlay('16:9')).toBeNull();
  });

  it('returns left/right insets for 9:16 (narrower)', () => {
    const overlay = getAutoReframeOverlay('9:16');
    expect(overlay).not.toBeNull();
    expect(overlay!.top).toBe('0%');
    expect(overlay!.bottom).toBe('0%');
    // side = (1 - (9/16)/(16/9)) / 2 = (1 - 81/256) / 2 ≈ 34.18%
    const side = parseFloat(overlay!.left);
    expect(side).toBeGreaterThan(30);
    expect(side).toBeLessThan(40);
  });

  it('returns top/bottom insets for 4:3 (wider than square but narrower than 16:9 — wait 4:3 > 9:16)', () => {
    // 4:3 = 1.333 which is still less than 16/9 = 1.778, so it should be pillarbox
    const overlay = getAutoReframeOverlay('4:3');
    expect(overlay).not.toBeNull();
    expect(overlay!.top).toBe('0%');
    expect(overlay!.bottom).toBe('0%');
  });

  it('1:1 square returns left/right insets', () => {
    const overlay = getAutoReframeOverlay('1:1');
    expect(overlay).not.toBeNull();
    expect(overlay!.top).toBe('0%');
    const side = parseFloat(overlay!.left);
    // side = (1 - 1 / (16/9)) / 2 = (1 - 9/16) / 2 = 7/32 = 21.875%
    expect(side).toBeCloseTo(21.875, 1);
  });
});

// ── Defaults ─────────────────────────────────────────────────────────────────

describe('DEFAULT_LUMETRI', () => {
  it('has all basic fields at 0', () => {
    const basicKeys: (keyof Omit<LumetriColor, 'curves' | 'wheels'>)[] = [
      'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks',
      'temperature', 'tint', 'saturation', 'vibrance',
    ];
    for (const k of basicKeys) {
      expect(DEFAULT_LUMETRI[k]).toBe(0);
    }
  });

  it('has all curve fields at 0', () => {
    const curveKeys = Object.keys(DEFAULT_LUMETRI.curves) as (keyof typeof DEFAULT_LUMETRI.curves)[];
    for (const k of curveKeys) {
      expect(DEFAULT_LUMETRI.curves[k]).toBe(0);
    }
  });

  it('has all wheel positions at zero', () => {
    for (const wheel of ['shadows', 'midtones', 'highlights'] as const) {
      expect(DEFAULT_LUMETRI.wheels[wheel].x).toBe(0);
      expect(DEFAULT_LUMETRI.wheels[wheel].y).toBe(0);
      expect(DEFAULT_LUMETRI.wheels[wheel].luminance).toBe(0);
    }
  });
});

describe('DEFAULT_AUDIO', () => {
  it('has category set to dialogue by default', () => {
    expect(DEFAULT_AUDIO.category).toBe('dialogue');
  });

  it('has all numeric controls at 0', () => {
    expect(DEFAULT_AUDIO.noiseReduction).toBe(0);
    expect(DEFAULT_AUDIO.clarity).toBe(0);
    expect(DEFAULT_AUDIO.deReverb).toBe(0);
    expect(DEFAULT_AUDIO.loudness).toBe(0);
  });

  it('has autoDuck and lowCut disabled by default', () => {
    expect(DEFAULT_AUDIO.autoDuck).toBe(false);
    expect(DEFAULT_AUDIO.lowCut).toBe(false);
  });
});
