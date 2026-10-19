import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { useVideoEditor } from '../hooks/useVideoEditor';

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

describe('scene markers', () => {
  it('adds every detected cut in one undo step', () => {
    const { result } = renderHook(() => useVideoEditor(videoRef()));
    act(() => {
      result.current.applyVideoEdit((snap) => ({
        ...snap,
        markers: [
          ...snap.markers,
          { id: 's1', time: 1.2, label: 'Scene cut', color: 'green' as const },
          { id: 's2', time: 4.5, label: 'Scene cut', color: 'green' as const },
        ],
      }));
    });
    expect(result.current.state.markers).toHaveLength(2);
    act(() => result.current.addMarker(9, 'Manual', 'blue'));
    act(() => result.current.undo());
    expect(result.current.state.markers).toHaveLength(2);
    act(() => result.current.undo());
    expect(result.current.state.markers).toHaveLength(0);
  });
});
