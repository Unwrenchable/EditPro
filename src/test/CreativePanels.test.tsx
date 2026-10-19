import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreativePanels from '../components/video/CreativePanels';
import type { TimelineClip, TimelineTrack } from '../types';
import { createDefaultCreativeState } from '../utils/video/creative';

const tracks: TimelineTrack[] = [
  { id: 'v1', type: 'video', name: 'V1', muted: false, locked: false },
  { id: 'a1', type: 'audio', name: 'A1', muted: false, locked: false },
];

const clips: TimelineClip[] = [
  { id: 'c1', src: '/media/a.mp4', trackId: 'v1', startTime: 0, endTime: 4, inPoint: 0, outPoint: 4 },
];

function renderPart(part: 'audio' | 'picture' | 'grade', onCreativeChange = vi.fn()) {
  render(
    <CreativePanels
      creative={createDefaultCreativeState()}
      disabled={false}
      tracks={tracks}
      clips={clips}
      currentTime={1}
      duration={8}
      videoUrl={null}
      transition="cut"
      onTransitionChange={() => {}}
      onCreativeChange={onCreativeChange}
      onSetTrackMuted={() => {}}
      part={part}
    />,
  );
  return onCreativeChange;
}

describe('CreativePanels', () => {
  it('writes timeline clip volume onto clip audio', () => {
    const onCreativeChange = renderPart('audio');
    fireEvent.change(screen.getByRole('slider', { name: 'Timeline clip 1 volume' }), { target: { value: '0.5' } });
    const next = onCreativeChange.mock.calls.at(-1)?.[0];
    expect(next.clipAudio).toEqual([
      expect.objectContaining({ clipId: 'c1', volume: 0.5 }),
    ]);
  });

  it('adds an animated title preset and edits stroke width', () => {
    const onCreativeChange = renderPart('picture');
    fireEvent.click(screen.getByRole('button', { name: 'center title' }));
    const created = onCreativeChange.mock.calls.at(-1)?.[0];
    expect(created.titles).toHaveLength(1);
    expect(created.titles[0].animation).toBe('fade');
    expect(created.titles[0].text).toBe('Title');

    render(
      <CreativePanels
        creative={created}
        disabled={false}
        tracks={tracks}
        clips={clips}
        currentTime={1}
        duration={8}
        videoUrl={null}
        transition="cut"
        onTransitionChange={() => {}}
        onCreativeChange={onCreativeChange}
        onSetTrackMuted={() => {}}
        part="picture"
      />,
    );
    fireEvent.change(screen.getByRole('slider', { name: 'Title stroke width' }), { target: { value: '1' } });
    const edited = onCreativeChange.mock.calls.at(-1)?.[0];
    expect(edited.titles[0].strokeWidth).toBe(1);
  });

  it('moves a lift wheel channel', () => {
    const onCreativeChange = renderPart('grade');
    fireEvent.change(screen.getByRole('slider', { name: 'lift r' }), { target: { value: '0.25' } });
    const next = onCreativeChange.mock.calls.at(-1)?.[0];
    expect(next.liftGammaGain.lift.r).toBe(0.25);
    expect(next.liftGammaGain.gamma.g).toBe(1);
  });
});
