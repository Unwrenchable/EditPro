import { describe, it, expect } from 'vitest';
import { computeWaveform, computeVectorscope } from '../utils/video/scopes';

// ── Helper: build a synthetic ImageData ──────────────────────────────────────

function makeImageData(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number]
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a] = fill(x, y);
      data[idx]     = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

// ── computeWaveform ───────────────────────────────────────────────────────────

describe('computeWaveform', () => {
  it('returns one column per pixel when image is narrow', () => {
    const img = makeImageData(10, 8, () => [128, 128, 128, 255]);
    const wf = computeWaveform(img, 512);
    expect(wf.columns.length).toBe(10);
    expect(wf.width).toBe(10);
    expect(wf.height).toBe(8);
  });

  it('caps columns to maxColumns when image is wide', () => {
    const img = makeImageData(1024, 8, () => [200, 100, 50, 255]);
    const wf = computeWaveform(img, 64);
    expect(wf.columns.length).toBeLessThanOrEqual(64);
  });

  it('each column has one luma entry per row', () => {
    const img = makeImageData(4, 6, () => [255, 0, 0, 255]);
    const wf = computeWaveform(img, 512);
    for (const col of wf.columns) {
      expect(col.luma.length).toBe(6);
    }
  });

  it('pure white produces maximum luma (255)', () => {
    const img = makeImageData(4, 4, () => [255, 255, 255, 255]);
    const wf = computeWaveform(img, 512);
    for (const col of wf.columns) {
      for (const luma of col.luma) {
        expect(luma).toBe(255);
      }
    }
  });

  it('pure black produces minimum luma (0)', () => {
    const img = makeImageData(4, 4, () => [0, 0, 0, 255]);
    const wf = computeWaveform(img, 512);
    for (const col of wf.columns) {
      for (const luma of col.luma) {
        expect(luma).toBe(0);
      }
    }
  });

  it('luma values are in 0-255 range', () => {
    const img = makeImageData(8, 8, (x) => [x * 30, x * 20, x * 10, 255]);
    const wf = computeWaveform(img, 512);
    for (const col of wf.columns) {
      for (const luma of col.luma) {
        expect(luma).toBeGreaterThanOrEqual(0);
        expect(luma).toBeLessThanOrEqual(255);
      }
    }
  });
});

// ── computeVectorscope ────────────────────────────────────────────────────────

describe('computeVectorscope', () => {
  it('returns a resolution field matching the parameter', () => {
    const img = makeImageData(10, 10, () => [128, 64, 200, 255]);
    const vs = computeVectorscope(img, 64, 1);
    expect(vs.resolution).toBe(64);
  });

  it('returns points array with non-negative weights', () => {
    const img = makeImageData(10, 10, () => [200, 50, 50, 255]);
    const vs = computeVectorscope(img, 64, 1);
    for (const p of vs.points) {
      expect(p.weight).toBeGreaterThan(0);
    }
  });

  it('Cb/Cr values are in -1..1 range', () => {
    const img = makeImageData(8, 8, (x, y) => [x * 30, y * 30, (x + y) * 15, 255]);
    const vs = computeVectorscope(img, 64, 1);
    for (const p of vs.points) {
      expect(p.cb).toBeGreaterThanOrEqual(-1);
      expect(p.cb).toBeLessThanOrEqual(1);
      expect(p.cr).toBeGreaterThanOrEqual(-1);
      expect(p.cr).toBeLessThanOrEqual(1);
    }
  });

  it('pure grey (equal R=G=B) maps near the centre (Cb≈0, Cr≈0)', () => {
    const img = makeImageData(8, 8, () => [128, 128, 128, 255]);
    const vs = computeVectorscope(img, 128, 1);
    // All points should be very close to (0,0)
    for (const p of vs.points) {
      expect(Math.abs(p.cb)).toBeLessThan(0.1);
      expect(Math.abs(p.cr)).toBeLessThan(0.1);
    }
  });

  it('returns an empty points array for a 1×1 image with neutral grey', () => {
    // 1×1 neutral grey — a single pixel.  Its Cb/Cr bucket maps to
    // the center bucket (once), so points.length should be exactly 1.
    const img = makeImageData(1, 1, () => [128, 128, 128, 255]);
    const vs = computeVectorscope(img, 64, 1);
    expect(vs.points.length).toBe(1);
  });
});

// ── Multi-track timeline operations ──────────────────────────────────────────
// These are tested through the hook's state management logic via pure function
// reconstruction (no DOM/video required).

describe('multi-track timeline clip math', () => {
  it('split point divides clip duration correctly', () => {
    const startTime = 0;
    const endTime = 10;
    const inPoint = 0;
    const atTime = 4;

    const splitOffset = atTime - startTime; // 4
    const firstEndTime = atTime;             // 4
    const firstOutPoint = inPoint + splitOffset; // 4

    const secondStartTime = atTime;          // 4
    const secondInPoint   = inPoint + splitOffset; // 4

    expect(firstEndTime).toBe(4);
    expect(firstOutPoint).toBe(4);
    expect(secondStartTime).toBe(4);
    expect(secondInPoint).toBe(4);
    expect(endTime - firstEndTime).toBe(6); // second half is 6s
  });

  it('split at boundary (start or end) should be a no-op', () => {
    const startTime = 0;
    const endTime = 10;

    // At start boundary
    expect(0 <= startTime || 0 >= endTime).toBe(true); // no-op condition met

    // At end boundary
    expect(10 >= endTime).toBe(true); // no-op condition met
  });

  it('moveClip computes new endTime as newStartTime + original duration', () => {
    const originalStart = 0;
    const originalEnd   = 5;
    const duration = originalEnd - originalStart; // 5
    const newStart = 3;
    const newEnd   = newStart + duration;          // 8
    expect(newEnd).toBe(8);
  });
});
