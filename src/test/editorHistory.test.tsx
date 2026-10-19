import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { usePhotoEditor } from '../hooks/usePhotoEditor';
import { useVideoEditor } from '../hooks/useVideoEditor';
import type { MagicMoviePlan } from '../types';
import { createDefaultPhotoEdits } from '../utils/editSnapshots';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from '../utils/videoUtils';

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

describe('usePhotoEditor history', () => {
  it('undoes and redoes photo edits, coalescing a slider drag', () => {
    const { result } = renderHook(() => usePhotoEditor());

    act(() => result.current.updateAdjustment('brightness', 10));
    act(() => result.current.updateAdjustment('brightness', 30));
    act(() => result.current.setFilter('sepia'));

    expect(result.current.state.adjustments.brightness).toBe(30);
    expect(result.current.state.filter).toBe('sepia');
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.state.filter).toBe('none');
    expect(result.current.state.adjustments.brightness).toBe(30);

    act(() => result.current.undo());
    expect(result.current.state.adjustments.brightness).toBe(0);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.state.adjustments.brightness).toBe(30);
  });

  it('treats reset as one undoable edit and clears history when a new image is loaded', () => {
    const { result } = renderHook(() => usePhotoEditor());
    act(() => {
      result.current.rotate(90);
      result.current.flip('horizontal');
    });
    act(() => result.current.resetAdjustments());
    expect(result.current.state.rotation).toBe(0);
    expect(result.current.state.flipH).toBe(false);

    act(() => result.current.undo());
    expect(result.current.state.rotation).toBe(90);
    expect(result.current.state.flipH).toBe(true);

    act(() => result.current.loadImage(new File(['pixels'], 'still.png', { type: 'image/png' })));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.state.rotation).toBe(0);
    expect(result.current.state.mediaName).toBe('still.png');
  });

  it('restores a snapshot as a new baseline that serializes back to the same edits', () => {
    const { result } = renderHook(() => usePhotoEditor());
    const edits = createDefaultPhotoEdits();
    edits.adjustments = { ...edits.adjustments, contrast: 22 };
    edits.crop = { x: 1, y: 2, width: 30, height: 40 };

    act(() => result.current.updateAdjustment('exposure', 5));
    act(() =>
      result.current.restore(edits, {
        file: null,
        url: null,
        path: '/pics/still.jpg',
        name: 'still.jpg',
        missing: true,
      }),
    );

    expect(result.current.state.adjustments.contrast).toBe(22);
    expect(result.current.state.adjustments.exposure).toBe(0);
    expect(result.current.state.crop).toEqual(edits.crop);
    expect(result.current.state.mediaMissing).toBe(true);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.getEdits()).toEqual(edits);
  });
});

describe('useVideoEditor history', () => {
  it('undoes timeline edits and leaves playback out of the history', () => {
    const ref = videoRef();
    const { result } = renderHook(() => useVideoEditor(ref));

    act(() => result.current.onLoadedMetadata());
    expect(result.current.state.trimEnd).toBe(20);
    expect(result.current.state.duration).toBe(20);
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.seek(4));
    expect(result.current.state.currentTime).toBe(4);
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.setTrimStart(2, result.current.state.trimEnd));
    act(() => result.current.setTrimStart(3, result.current.state.trimEnd));
    act(() => result.current.addMarker(4, 'Scene', 'blue'));
    act(() => result.current.addTrack('video'));
    act(() => result.current.addClip('v1', '/media/a.mp4', 0, 5, 1));

    expect(result.current.state.trimStart).toBe(3);
    expect(result.current.state.markers).toHaveLength(1);
    expect(result.current.state.tracks.some((track) => track.type === 'video' && track.id !== 'v1')).toBe(true);
    expect(result.current.state.clips).toHaveLength(1);

    act(() => result.current.deleteClip(result.current.state.clips[0].id));
    expect(result.current.state.clips).toHaveLength(0);
    act(() => result.current.undo());
    expect(result.current.state.clips).toHaveLength(1);

    act(() => result.current.undo());
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.state.clips).toHaveLength(0);
    expect(result.current.state.markers).toHaveLength(0);
    expect(result.current.state.tracks).toHaveLength(2);
    expect(result.current.state.trimStart).toBe(3);

    act(() => result.current.undo());
    expect(result.current.state.trimStart).toBe(0);
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.state.trimStart).toBe(3);
  });

  it('splits a clip as one undoable timeline edit', () => {
    const { result } = renderHook(() => useVideoEditor(videoRef()));
    act(() => result.current.addClip('v1', '/media/a.mp4', 0, 10, 0));
    const clipId = result.current.state.clips[0].id;
    act(() => result.current.splitClip(clipId, 4));
    expect(result.current.state.clips).toHaveLength(2);
    expect(result.current.state.clips[0]?.endTime).toBe(4);

    act(() => result.current.undo());
    expect(result.current.state.clips).toHaveLength(1);
    expect(result.current.state.clips[0]?.endTime).toBe(10);
  });

  it('applies a magic plan as a single undo step', () => {
    const plan: MagicMoviePlan = {
      title: 'Teaser',
      style: 'cinematic',
      description: 'A short cut',
      lumetri: { ...DEFAULT_LUMETRI, contrast: 40 },
      audio: { ...DEFAULT_AUDIO, loudness: -3 },
      autoReframe: '9:16',
      scenes: [{ label: 'Open', startPct: 0.25, endPct: 0.5, description: 'Wide', color: 'yellow' }],
      playbackRate: 1.25,
    };
    const { result } = renderHook(() => useVideoEditor(videoRef(12)));

    act(() => result.current.applyMagicPlan(plan, 12));
    expect(result.current.state.lumetri.contrast).toBe(40);
    expect(result.current.state.markers).toHaveLength(1);
    expect(result.current.state.markers[0]?.time).toBe(3);
    expect(result.current.state.playbackRate).toBe(1.25);

    act(() => result.current.undo());
    expect(result.current.state.lumetri.contrast).toBe(0);
    expect(result.current.state.markers).toHaveLength(0);
    expect(result.current.state.playbackRate).toBe(1);
    expect(result.current.canRedo).toBe(true);
  });
});
