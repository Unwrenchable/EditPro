import { describe, it, expect } from 'vitest';
import { formatTime, buildVideoFilter, clamp } from '../utils/videoUtils';

describe('formatTime', () => {
  it('formats zero seconds', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds only (< 1 minute)', () => {
    expect(formatTime(45)).toBe('0:45');
  });

  it('formats one minute', () => {
    expect(formatTime(60)).toBe('1:00');
  });

  it('formats minutes and seconds', () => {
    expect(formatTime(125)).toBe('2:05');
  });

  it('formats hours', () => {
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('handles NaN gracefully', () => {
    expect(formatTime(NaN)).toBe('0:00');
  });

  it('handles Infinity gracefully', () => {
    expect(formatTime(Infinity)).toBe('0:00');
  });
});

describe('buildVideoFilter', () => {
  it('returns default values when all adjustments are 0', () => {
    const f = buildVideoFilter(0, 0, 0);
    expect(f).toContain('brightness(1.000)');
    expect(f).toContain('contrast(1.000)');
    expect(f).toContain('saturate(1.000)');
  });

  it('increases brightness with positive value', () => {
    const f = buildVideoFilter(50, 0, 0);
    expect(f).toContain('brightness(1.500)');
  });

  it('clamps brightness to minimum 0', () => {
    const f = buildVideoFilter(-100, 0, 0);
    expect(f).toContain('brightness(0.000)');
  });

  it('adjusts contrast correctly', () => {
    const f = buildVideoFilter(0, -50, 0);
    expect(f).toContain('contrast(0.500)');
  });

  it('adjusts saturation correctly', () => {
    const f = buildVideoFilter(0, 0, 100);
    expect(f).toContain('saturate(2.000)');
  });
});

describe('clamp', () => {
  it('returns the value when in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('returns min when value is below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('returns max when value is above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });
});
