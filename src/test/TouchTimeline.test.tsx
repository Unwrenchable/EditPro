import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TouchTimeline from '../components/video/TouchTimeline';
import type { TimelineClip } from '../types';

const clip: TimelineClip = {
  id: 'c1',
  src: 'browser:clip.mp4:1',
  trackId: 'v1',
  startTime: 2,
  endTime: 6,
  inPoint: 0,
  outPoint: 4,
};

function renderTimeline(onSeek = vi.fn(), extra: Partial<ComponentProps<typeof TouchTimeline>> = {}) {
  const onZoomChange = vi.fn();
  const onRazorAt = vi.fn();
  const onDeleteClip = vi.fn();
  render(
    <TouchTimeline
      duration={10}
      currentTime={1}
      trimStart={0}
      trimEnd={10}
      zoom={1}
      clips={[clip]}
      onSeek={onSeek}
      onTrimStartChange={vi.fn()}
      onTrimEndChange={vi.fn()}
      onZoomChange={onZoomChange}
      onRazorAt={onRazorAt}
      onDeleteClip={onDeleteClip}
      {...extra}
    />,
  );
  return { onZoomChange, onRazorAt, onDeleteClip };
}

describe('TouchTimeline', () => {
  it('scrubs, zooms, splits, and deletes from large controls', () => {
    const onSeek = vi.fn();
    const { onZoomChange, onRazorAt, onDeleteClip } = renderTimeline(onSeek);
    const slider = screen.getByRole('slider', { name: 'Video timeline' });
    slider.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 100,
        top: 0,
        height: 48,
        right: 100,
        bottom: 48,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    fireEvent.pointerDown(slider, { clientX: 50, pointerId: 1 });
    expect(onSeek).toHaveBeenCalledWith(5);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(onZoomChange).toHaveBeenCalledWith(1.5);
    fireEvent.click(screen.getByRole('button', { name: 'Split at playhead' }));
    expect(onRazorAt).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clip · 0:02' }));
    expect(onSeek).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete clip c1' }));
    expect(onDeleteClip).toHaveBeenCalledWith('c1');
  });
});
