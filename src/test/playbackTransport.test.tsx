import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useVideoEditor } from '../hooks/useVideoEditor';

function deferredPlay() {
  let resolvePlay: () => void = () => {};
  const pause = vi.fn();
  const video = {
    duration: 10,
    currentTime: 1,
    playbackRate: 1,
    volume: 1,
    muted: false,
    dataset: {} as DOMStringMap,
    pause,
    play: () =>
      new Promise<void>((resolve) => {
        resolvePlay = resolve;
      }),
  };
  const ref = { current: video as unknown as HTMLVideoElement } as RefObject<HTMLVideoElement | null>;
  return { ref, video, pause, resolvePlay: () => resolvePlay() };
}

describe('playback transport', () => {
  it('stays paused when play() resolves after pause', async () => {
    const { ref, pause, resolvePlay } = deferredPlay();
    const { result } = renderHook(() => useVideoEditor(ref));

    act(() => result.current.play(0, 10));
    expect(result.current.state.isPlaying).toBe(true);
    act(() => result.current.pause());
    expect(result.current.state.isPlaying).toBe(false);

    await act(async () => {
      resolvePlay();
    });
    expect(result.current.state.isPlaying).toBe(false);
    expect(pause).toHaveBeenCalled();
  });

  it('seeks to a frame boundary and steps one source frame', () => {
    const { ref, video } = deferredPlay();
    video.dataset.frameRate = '24';
    video.currentTime = 0;
    const { result } = renderHook(() => useVideoEditor(ref));

    act(() => result.current.seek(1));
    expect(result.current.state.currentTime).toBe(1);
    expect(video.currentTime).toBeCloseTo(1 + 0.15 / 24, 5);

    act(() => result.current.onTimeUpdate());
    expect(result.current.state.currentTime).toBe(1);

    video.currentTime = 0;
    act(() => result.current.stepFrame(1));
    expect(result.current.state.currentTime).toBeCloseTo(1 / 24, 5);
  });
});
