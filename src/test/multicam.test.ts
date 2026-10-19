import { describe, expect, it } from 'vitest';
import {
  activeAngle,
  addMulticamAngles,
  applySyncOffsets,
  createMulticamSequence,
  energyEnvelope,
  estimateSyncOffset,
  multicamToClips,
  normalizeMulticamSequence,
  refineCuts,
  refineCutTime,
  subsamplePeak,
  switchAngle,
  syncAngleOffsets,
} from '../utils/video/multicam';

function noise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[index] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

describe('multicam audio sync', () => {
  it('finds a late camera and reports a negative timeline offset', () => {
    const reference = noise(8000, 11);
    const delay = 250;
    const candidate = new Float32Array(reference.length + delay);
    candidate.set(reference, delay);
    const estimate = estimateSyncOffset(
      { samples: reference, sampleRate: 8000 },
      { samples: candidate, sampleRate: 8000 },
      { maxOffsetSec: 2 },
    );
    expect(estimate.offsetSec).toBeCloseTo(-delay / 8000, 4);
    expect(estimate.confidence).toBeGreaterThan(0.9);
  });

  it('finds a camera that started early', () => {
    const reference = noise(8000, 29);
    const lead = 180;
    const estimate = estimateSyncOffset(
      { samples: reference, sampleRate: 8000 },
      { samples: reference.subarray(lead), sampleRate: 8000 },
      { maxOffsetSec: 2 },
    );
    expect(estimate.offsetSec).toBeCloseTo(lead / 8000, 4);
    expect(estimate.confidence).toBeGreaterThan(0.85);
  });

  it('keeps a low score when the takes do not match', () => {
    const estimate = estimateSyncOffset(
      { samples: noise(4000, 1), sampleRate: 8000 },
      { samples: noise(4000, 99), sampleRate: 8000 },
    );
    expect(Math.abs(estimate.confidence)).toBeLessThan(0.45);
  });

  it('downsamples a higher rate before correlating', () => {
    const reference = noise(16000, 4);
    const candidate = new Float32Array(reference.length + 400);
    candidate.set(reference, 400);
    const estimate = estimateSyncOffset(
      { samples: reference, sampleRate: 16000 },
      { samples: candidate, sampleRate: 16000 },
      { maxOffsetSec: 1, analysisRate: 8000 },
    );
    expect(estimate.offsetSec).toBeCloseTo(-400 / 16000, 3);
  });

  it('syncs every angle against the reference and leaves the reference at zero', () => {
    const reference = noise(5000, 8);
    const late = new Float32Array(reference.length + 100);
    late.set(reference, 100);
    const sequence = createMulticamSequence([
      { id: 'a', name: 'A', src: '/a.mov' },
      { id: 'b', name: 'B', src: '/b.mov' },
    ]);
    const offsets = syncAngleOffsets(
      { id: 'a', samples: reference, sampleRate: 8000 },
      [{ id: 'b', samples: late, sampleRate: 8000 }],
      { maxOffsetSec: 1 },
    );
    const synced = applySyncOffsets(sequence, offsets);
    expect(synced.angles[0]?.syncOffset).toBe(0);
    expect(synced.angles[1]?.syncOffset).toBeCloseTo(-100 / 8000, 4);
  });

  it('interpolates a discrete correlation peak between samples', () => {
    expect(subsamplePeak(1, 4, 3)).toBeCloseTo(0.25, 5);
    expect(subsamplePeak(1, 1, 1)).toBe(0);
  });
});

describe('multicam switching and refinement', () => {
  const sequence = createMulticamSequence([
    { id: 'wide', name: 'Wide', src: '/wide.mov' },
    { id: 'close', name: 'Close', src: '/close.mov' },
    { id: 'side', name: 'Side', src: '/side.mov' },
  ], 'group');

  it('records a live cut and keeps cuts that are already ahead of the playhead', () => {
    const first = switchAngle(sequence, 2, 'close', 30);
    const second = switchAngle(first, 5, 'side', 30);
    const back = switchAngle(second, 3.5, 'wide', 30);
    expect(back.cuts.map((cut) => [cut.time, cut.angleId])).toEqual([
      [0, 'wide'],
      [2, 'close'],
      [3.5, 'wide'],
      [5, 'side'],
    ]);
    expect(activeAngle(back, 3.6)?.id).toBe('wide');
    expect(activeAngle(back, 5)?.id).toBe('side');
  });

  it('replaces a cut on the same frame and collapses a repeated angle', () => {
    const cut = switchAngle(sequence, 2, 'close', 30);
    const replaced = switchAngle(cut, 2.01, 'side', 30);
    expect(replaced.cuts.map((item) => item.angleId)).toEqual(['wide', 'side']);
    const same = switchAngle(replaced, 0, 'wide', 30);
    expect(same.cuts).toHaveLength(2);
  });

  it('moves a cut onto the pause between two words and will not cross the next cut', () => {
    const values = new Float32Array(100);
    values.fill(0.6);
    for (let index = 40; index < 48; index += 1) values[index] = 0.02;
    const envelope = { sampleRate: 100, values };
    expect(refineCutTime(0.32, envelope, { windowSec: 0.25, frameRate: 25, mode: 'gap' })).toBeCloseTo(0.4, 2);
    const withCuts = switchAngle(switchAngle(sequence, 0.32, 'close', 25), 0.7, 'side', 25);
    const refined = refineCuts(withCuts, envelope, { windowSec: 0.25, frameRate: 25, mode: 'gap' });
    const moved = refined.cuts[1]?.time ?? 0;
    expect(moved).toBeGreaterThan(0.32);
    expect(moved).toBeLessThan(0.7);
    const onset = refineCutTime(0.3, envelope, { windowSec: 0.3, frameRate: 50, mode: 'onset' });
    expect(onset).toBeGreaterThan(0.35);
  });

  it('writes timeline clips using the sync offset as the source in-point', () => {
    const synced = applySyncOffsets(sequence, [{ id: 'close', offsetSec: -0.5, confidence: 0.9 }]);
    const cut = switchAngle(synced, 2, 'close', 30);
    const clips = multicamToClips(cut, 4, 'v-multicam');
    expect(clips).toHaveLength(2);
    expect(clips[1]).toMatchObject({ src: '/close.mov', startTime: 2, endTime: 4, inPoint: 2.5, outPoint: 4.5 });
  });

  it('round-trips a sequence and drops a broken one', () => {
    const saved = addMulticamAngles(null, [{ id: 'a', name: 'A', src: '/a.mov' }]);
    expect(normalizeMulticamSequence(saved)?.angles[0]?.src).toBe('/a.mov');
    expect(normalizeMulticamSequence({ id: 'x', angles: [] })).toBeNull();
    expect(normalizeMulticamSequence(null)).toBeNull();
  });

  it('builds an envelope that dips where the waveform is quiet', () => {
    const samples = new Float32Array(800);
    for (let index = 200; index < 400; index += 1) samples[index] = Math.sin(index);
    const envelope = energyEnvelope(samples, 800, 100);
    expect(envelope.values[30]).toBeGreaterThan(envelope.values[0] as number);
    expect(envelope.values[70]).toBeLessThan(envelope.values[30] as number);
  });
});
