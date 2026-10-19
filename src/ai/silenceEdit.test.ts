import { describe, expect, it } from 'vitest';
import { createDefaultVideoEdits } from '../utils/editSnapshots';
import { planRemoval } from './editPlan';
import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { useVideoEditor } from '../hooks/useVideoEditor';

describe('silence ripple plan', () => {
  it('seeds a linked master and shifts later markers', () => {
    const snap = createDefaultVideoEdits();
    snap.markers = [
      { id: 'keep', time: 1, label: 'Keep', color: 'blue' },
      { id: 'gone', time: 3, label: 'Gone', color: 'red' },
      { id: 'later', time: 8, label: 'Later', color: 'yellow' },
    ];
    let n = 0;
    const next = planRemoval(snap, [{ start: 2, end: 4 }], { src: '/media/take.mp4', duration: 10 }, () => `clip_${n++}`);
    const video = next.clips.filter((clip) => clip.trackId === 'v1');
    expect(video.length).toBeGreaterThan(1);
    expect(Math.max(...next.clips.map((clip) => clip.endTime))).toBeCloseTo(8, 1);
    expect(next.markers.map((marker) => marker.id)).toEqual(['keep', 'later']);
    expect(next.markers.find((marker) => marker.id === 'later')?.time).toBeCloseTo(6, 1);
    expect(next.trimEnd).toBe(0);
  });
});

function videoRef(): RefObject<HTMLVideoElement | null> {
  const video = {
    duration: 20,
    currentTime: 0,
    playbackRate: 1,
    volume: 1,
    muted: false,
    pause() {},
    play() { return Promise.resolve(); },
  };
  return { current: video as unknown as HTMLVideoElement };
}

describe('applyVideoEdit', () => {
  it('applies a silence ripple as a single undo step', () => {
    const { result } = renderHook(() => useVideoEditor(videoRef()));
    act(() => result.current.onLoadedMetadata());
    act(() => result.current.addMarker(3, 'Inside', 'red'));
    let n = 0;
    act(() => {
      result.current.applyVideoEdit((snap) => planRemoval(
        snap,
        [{ start: 2, end: 4 }],
        { src: '/media/take.mp4', duration: 10 },
        () => `clip_${n++}`,
      ));
    });
    expect(result.current.state.clips.length).toBeGreaterThan(0);
    expect(result.current.state.markers).toHaveLength(0);
    const clipCount = result.current.state.clips.length;
    act(() => result.current.addMarker(1, 'Later edit', 'yellow'));
    act(() => result.current.undo());
    expect(result.current.state.clips).toHaveLength(clipCount);
    act(() => result.current.undo());
    expect(result.current.state.clips).toHaveLength(0);
    expect(result.current.state.markers).toHaveLength(1);
  });
});
