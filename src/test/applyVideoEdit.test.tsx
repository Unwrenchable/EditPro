import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { planRemoval } from '../ai/editPlan';
import { useVideoEditor } from '../hooks/useVideoEditor';

function videoRef(duration = 20): RefObject<HTMLVideoElement | null> {
  const video = {
    duration,
    currentTime: 0,
    playbackRate: 1,
    volume: 1,
    muted: false,
    pause() {},
    play() {
      return Promise.resolve();
    },
  };
  return { current: video as unknown as HTMLVideoElement };
}

describe('applyVideoEdit', () => {
  it('applies an AI ripple as a single undo step', () => {
    const { result } = renderHook(() => useVideoEditor(videoRef()));
    act(() => result.current.onLoadedMetadata());
    act(() => result.current.addMarker(3, 'Inside', 'red'));
    act(() => result.current.addMarker(8, 'After', 'blue'));
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
    expect(result.current.state.markers.some((marker) => marker.label === 'Inside')).toBe(false);
    const clipCount = result.current.state.clips.length;
    act(() => result.current.addMarker(1, 'Later edit', 'yellow'));
    act(() => result.current.undo());
    expect(result.current.state.markers.some((marker) => marker.label === 'Later edit')).toBe(false);
    expect(result.current.state.clips).toHaveLength(clipCount);
    act(() => result.current.undo());
    expect(result.current.state.clips).toHaveLength(0);
    expect(result.current.state.markers.map((marker) => marker.label).sort()).toEqual(['After', 'Inside']);
  });
});
