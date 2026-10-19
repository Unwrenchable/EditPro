import { describe, expect, it } from 'vitest';
import { clampZoom, pinchScale, pointerDistance, prefersTouchLayout, seekRatio } from './gestures';

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

  it('uses the touch layout only for a narrow web or Capacitor window', () => {
    const narrow = (query: string) => query === '(max-width: 800px)';
    const coarse = (query: string) => query === '(pointer: coarse)';
    expect(prefersTouchLayout('web', narrow)).toBe(true);
    expect(prefersTouchLayout('capacitor', narrow)).toBe(true);
    expect(prefersTouchLayout('web', coarse)).toBe(false);
    expect(prefersTouchLayout('capacitor', coarse)).toBe(false);
    expect(prefersTouchLayout('electron', narrow)).toBe(false);
    expect(prefersTouchLayout('electron', coarse)).toBe(false);
    expect(prefersTouchLayout('web', () => false)).toBe(false);
  });
});
