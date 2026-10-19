import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { describe, expect, it } from 'vitest';
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

describe('professional timeline history', () => {
  it('undoes a ripple delete, a keyframe, and snapping without recording shuttle', () => {
    const { result } = renderHook(() => useVideoEditor(videoRef()));
    act(() => result.current.addTrack('video'));
    act(() => result.current.addClip('v1', '/media/a.mp4', 0, 4, 0));
    act(() => result.current.addClip('v1', '/media/b.mp4', 0, 4, 4));
    const first = result.current.state.clips[0];
    const second = result.current.state.clips[1];
    expect(result.current.state.tracks.filter((track) => track.type === 'video').length).toBeGreaterThan(1);

    act(() => result.current.rippleDeleteClip(first.id));
    expect(result.current.state.clips).toHaveLength(1);
    expect(result.current.state.clips[0]?.startTime).toBe(0);

    act(() => result.current.undo());
    expect(result.current.state.clips).toHaveLength(2);
    expect(result.current.state.clips.find((clip) => clip.id === second.id)?.startTime).toBe(4);

    act(() => result.current.addClipKeyframe(second.id, {
      id: 'kf1',
      time: 1,
      property: 'opacity',
      value: 0.25,
      easing: 'easeInOut',
    }));
    expect(result.current.state.clips.find((clip) => clip.id === second.id)?.keyframes).toHaveLength(1);
    act(() => result.current.undo());
    expect(result.current.state.clips.find((clip) => clip.id === second.id)?.keyframes).toEqual([]);

    act(() => result.current.setSnapping(false));
    expect(result.current.state.snapping).toBe(false);
    act(() => result.current.undo());
    expect(result.current.state.snapping).toBe(true);

    act(() => result.current.shuttleForward());
    act(() => result.current.shuttleForward());
    expect(result.current.state.shuttleRate).toBe(2);
    expect(result.current.state.playbackRate).toBe(1);
    const undoSteps = result.current.canUndo;
    act(() => result.current.shuttleStop());
    expect(result.current.state.shuttleRate).toBe(0);
    expect(result.current.canUndo).toBe(undoSteps);
  });

  it('rolls and slips as single undo steps and links a pair', () => {
    const { result } = renderHook(() => useVideoEditor(videoRef()));
    act(() => {
      result.current.addClip('v1', '/media/a.mp4', 0, 4, 0);
      result.current.addClip('v1', '/media/b.mp4', 0, 4, 4);
      result.current.addClip('a1', '/media/a.mp4', 0, 4, 0);
    });
    const [videoA, videoB, audio] = result.current.state.clips;
    act(() => result.current.linkClips(videoA.id, audio.id));
    expect(result.current.state.clips.find((clip) => clip.id === audio.id)?.linkId).toBeTruthy();

    act(() => result.current.rollClip(videoA.id, 'out', 5));
    expect(result.current.state.clips.find((clip) => clip.id === videoB.id)?.startTime).toBe(5);
    act(() => result.current.undo());
    expect(result.current.state.clips.find((clip) => clip.id === videoB.id)?.startTime).toBe(4);

    act(() => result.current.slipClip(videoB.id, 1));
    expect(result.current.state.clips.find((clip) => clip.id === videoB.id)).toMatchObject({
      startTime: 4,
      inPoint: 1,
      outPoint: 5,
    });
    act(() => result.current.unlinkClips(videoA.id));
    expect(result.current.state.clips.find((clip) => clip.id === audio.id)?.linkId).toBeNull();
  });
});
