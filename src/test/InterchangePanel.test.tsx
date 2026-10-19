import { fireEvent, render, screen } from '@testing-library/react';
import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';
import InterchangePanel from '../components/video/InterchangePanel';
import { useVideoEditor } from '../hooks/useVideoEditor';
import type { TimelineClip, TimelineTrack } from '../types';
import { createTitleFromPreset } from '../utils/video/creative';
import edlSample from './fixtures/interview.edl?raw';

function videoRef(): RefObject<HTMLVideoElement | null> {
  const video = {
    duration: 20,
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

const tracks: TimelineTrack[] = [
  { id: 'v1', type: 'video', name: 'V1', muted: false, locked: false },
  { id: 'a1', type: 'audio', name: 'A1', muted: false, locked: false },
];

const clips: TimelineClip[] = [{
  id: 'c1',
  src: '/films/interview.mov',
  trackId: 'v1',
  startTime: 0,
  endTime: 4,
  inPoint: 3600,
  outPoint: 3604,
  linkId: null,
  keyframes: [],
}];

describe('InterchangePanel', () => {
  it('imports a CMX 3600 file onto the timeline', async () => {
    const onReplace = vi.fn();
    render(
      <InterchangePanel tracks={tracks} clips={clips} sequenceName="Interview" onReplace={onReplace} />,
    );
    const input = screen.getByLabelText('Import interchange file');
    const file = new File([edlSample], 'interview.edl', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(onReplace).toHaveBeenCalledTimes(1);
    const [nextTracks, nextClips] = onReplace.mock.calls[0] as [TimelineTrack[], TimelineClip[]];
    expect(nextTracks.map((track) => track.name)).toEqual(['V1', 'A1']);
    expect(nextClips.find((clip) => clip.trackId === 'v1')?.inPoint).toBe(3600);
    expect(screen.getByRole('status').textContent).toMatch(/Imported 2 clips/);
  });
});

describe('replaceTimeline', () => {
  it('replaces tracks and clips, keeps titles, and restores them on undo', () => {
    const { result } = renderHook(() => useVideoEditor(videoRef()));
    act(() => {
      result.current.setCreative({
        ...result.current.state.creative,
        titles: [createTitleFromPreset('lower-third', 1)],
      });
      result.current.addClip('v1', '/media/old.mp4', 0, 2, 0);
    });
    const title = result.current.state.creative.titles[0]?.text;
    expect(title).toBeTruthy();
    expect(result.current.state.clips).toHaveLength(1);

    act(() => {
      result.current.replaceTimeline(tracks, clips);
    });
    expect(result.current.state.clips).toHaveLength(1);
    expect(result.current.state.clips[0]?.src).toBe('/films/interview.mov');
    expect(result.current.state.clips[0]?.inPoint).toBe(3600);
    expect(result.current.state.creative.titles[0]?.text).toBe(title);

    act(() => result.current.undo());
    expect(result.current.state.clips[0]?.src).toBe('/media/old.mp4');
    expect(result.current.state.creative.titles[0]?.text).toBe(title);
  });

  it('keeps the current tracks when an import has none', () => {
    const { result } = renderHook(() => useVideoEditor(videoRef()));
    act(() => result.current.addTrack('audio'));
    const before = result.current.state.tracks.map((track) => track.id);
    act(() => result.current.replaceTimeline([], []));
    expect(result.current.state.tracks.map((track) => track.id)).toEqual(before);
    expect(result.current.state.clips).toEqual([]);
  });
});
