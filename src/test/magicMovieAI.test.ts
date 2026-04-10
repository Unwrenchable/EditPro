import { describe, it, expect } from 'vitest';
import { detectStyle, generatePlan, GENERATION_STEPS, MAGIC_STYLE_META } from '../utils/magicMovieAI';
import type { MagicMovieStyle } from '../types';

describe('detectStyle', () => {
  it('detects cinematic from keywords', () => {
    expect(detectStyle('I want an epic cinematic movie')).toBe('cinematic');
  });

  it('detects travel from keywords', () => {
    expect(detectStyle('adventure travel video through Europe')).toBe('travel');
  });

  it('detects action from keywords', () => {
    expect(detectStyle('fast action sports highlight reel')).toBe('action');
  });

  it('detects documentary from keywords', () => {
    expect(detectStyle('a real documentary style interview')).toBe('documentary');
  });

  it('detects wedding from keywords', () => {
    expect(detectStyle('romantic wedding ceremony video')).toBe('wedding');
  });

  it('detects social from keywords', () => {
    expect(detectStyle('viral tiktok reels content')).toBe('social');
  });

  it('detects dramatic from keywords', () => {
    expect(detectStyle('dark moody dramatic thriller')).toBe('dramatic');
  });

  it('detects vintage from keywords', () => {
    expect(detectStyle('retro vintage nostalgic memories')).toBe('vintage');
  });

  it('falls back to cinematic on empty prompt', () => {
    expect(detectStyle('')).toBe('cinematic');
  });

  it('is case-insensitive', () => {
    expect(detectStyle('CINEMATIC MOVIE FILM')).toBe('cinematic');
  });

  it('picks the style with the most keyword hits', () => {
    // "travel adventure explore" has 3 travel hits vs 0 for others
    expect(detectStyle('travel adventure explore')).toBe('travel');
  });
});

describe('generatePlan', () => {
  it('returns a plan with the correct style when forced', () => {
    const plan = generatePlan('some prompt', 'vintage');
    expect(plan.style).toBe('vintage');
  });

  it('auto-detects style from prompt when not forced', () => {
    const plan = generatePlan('epic cinematic Hollywood movie');
    expect(plan.style).toBe('cinematic');
  });

  it('includes scenes that span 0 to 1', () => {
    const styles: MagicMovieStyle[] = Object.keys(MAGIC_STYLE_META) as MagicMovieStyle[];
    for (const style of styles) {
      const plan = generatePlan('', style);
      expect(plan.scenes.length).toBeGreaterThan(0);
      expect(plan.scenes[0].startPct).toBe(0);
      expect(plan.scenes[plan.scenes.length - 1].endPct).toBe(1);
    }
  });

  it('scene startPct and endPct are ordered and non-overlapping', () => {
    const plan = generatePlan('travel adventure', 'travel');
    for (let i = 0; i < plan.scenes.length; i++) {
      const s = plan.scenes[i];
      expect(s.startPct).toBeLessThan(s.endPct);
      if (i > 0) {
        expect(s.startPct).toBe(plan.scenes[i - 1].endPct);
      }
    }
  });

  it('generates a title from a non-empty prompt', () => {
    const plan = generatePlan('epic travel through Europe');
    expect(plan.title.toLowerCase()).toContain('epic travel through europe');
  });

  it('generates a fallback title for empty prompt', () => {
    const plan = generatePlan('', 'cinematic');
    expect(plan.title.length).toBeGreaterThan(0);
  });

  it('truncates very long prompts in title', () => {
    const longPrompt = 'a'.repeat(200);
    const plan = generatePlan(longPrompt);
    expect(plan.title.length).toBeLessThanOrEqual(50);
  });

  it('returns valid lumetri (not all zeros for most styles)', () => {
    const plan = generatePlan('', 'action');
    // Action style should have positive contrast
    expect(plan.lumetri.contrast).toBeGreaterThan(0);
  });

  it('social style defaults to 9:16 aspect ratio', () => {
    const plan = generatePlan('tiktok viral content', 'social');
    expect(plan.autoReframe).toBe('9:16');
  });

  it('all styles produce a plan with playbackRate >= 0.5', () => {
    const styles: MagicMovieStyle[] = Object.keys(MAGIC_STYLE_META) as MagicMovieStyle[];
    for (const style of styles) {
      const plan = generatePlan('', style);
      expect(plan.playbackRate).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe('GENERATION_STEPS', () => {
  it('has at least 5 steps', () => {
    expect(GENERATION_STEPS.length).toBeGreaterThanOrEqual(5);
  });

  it('each step is a non-empty string', () => {
    for (const step of GENERATION_STEPS) {
      expect(typeof step).toBe('string');
      expect(step.length).toBeGreaterThan(0);
    }
  });
});

describe('MAGIC_STYLE_META', () => {
  it('has an entry for all 8 styles', () => {
    const styles: MagicMovieStyle[] = [
      'cinematic', 'travel', 'action', 'documentary',
      'wedding', 'social', 'dramatic', 'vintage',
    ];
    for (const style of styles) {
      expect(MAGIC_STYLE_META[style]).toBeDefined();
      expect(MAGIC_STYLE_META[style].label.length).toBeGreaterThan(0);
      expect(MAGIC_STYLE_META[style].keywords.length).toBeGreaterThan(0);
    }
  });
});
