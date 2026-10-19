import { describe, expect, it } from 'vitest';
import { clampZoom, pinchScale, pointerDistance, prefersCoarseLayout, seekRatio } from './gestures';

describe('timeline gestures', () => {
  it('maps a pointer to a 0–1 position on the seek track', () => {
    expect(seekRatio(50, 0, 100)).toBe(0.5);
    expect(seekRatio(-10, 0, 100)).toBe(0);
    expect(seekRatio(140, 0, 100)).toBe(1);
    expect(seekRatio(10, 0, 0)).toBe(0);
  });

  it('scales zoom from a pinch and stays inside 0.5–8', () => {
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pinchScale(100, 200, 1)).toBe(2);
    expect(pinchScale(10, 1000, 1)).toBe(8);
    expect(pinchScale(0, 40, 3)).toBe(3);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('treats a coarse pointer or a narrow window as the touch layout', () => {
    const matches = (query: string) => query === '(pointer: coarse)';
    expect(prefersCoarseLayout(matches)).toBe(true);
    expect(prefersCoarseLayout((query) => query === '(max-width: 800px)')).toBe(true);
    expect(prefersCoarseLayout(() => false)).toBe(false);
  });
});
