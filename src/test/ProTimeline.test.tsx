import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProTimeline from '../components/video/ProTimeline';
import type { TimelineTrack } from '../types';

const tracks: TimelineTrack[] = [
  { id: 'v1', type: 'video', name: 'V1', muted: false, locked: false },
  { id: 'v2', type: 'video', name: 'V2', muted: false, locked: false },
  { id: 'a1', type: 'audio', name: 'A1', muted: false, locked: false },
];

describe('ProTimeline', () => {
  it('stacks video tracks above audio and exposes the edit tools', () => {
    const onToggleSnapping = vi.fn();
    const onRazorAt = vi.fn();
    const onAddTrack = vi.fn();
    render(
      <ProTimeline
        duration={10}
        currentTime={1}
        trimStart={0}
        trimEnd={10}
        markers={[]}
        tracks={tracks}
        clips={[]}
        zoom={1}
        snapping
        shuttleRate={2}
        programKeyframes={[]}
        hasVideo
        onSeek={vi.fn()}
        onTrimStartChange={vi.fn()}
        onTrimEndChange={vi.fn()}
        onZoomChange={vi.fn()}
        onToggleSnapping={onToggleSnapping}
        onAddMarker={vi.fn()}
        onRemoveMarker={vi.fn()}
        onAddTrack={onAddTrack}
        onSetTrackMuted={vi.fn()}
        onSetTrackLocked={vi.fn()}
        onRemoveTrack={vi.fn()}
        onDeleteClip={vi.fn()}
        onRippleDelete={vi.fn()}
        onSplitClip={vi.fn()}
        onRazorAt={onRazorAt}
        onMoveClip={vi.fn()}
        onTrimClip={vi.fn()}
        onRippleTrim={vi.fn()}
        onRollClip={vi.fn()}
        onSlipClip={vi.fn()}
        onSlideClip={vi.fn()}
        onToggleLink={vi.fn()}
        onAddKeyframe={vi.fn()}
        onUpdateKeyframe={vi.fn()}
        onRemoveKeyframe={vi.fn()}
      />,
    );

    const names = screen.getAllByLabelText(/Track /).map((element) => element.getAttribute('aria-label'));
    expect(names).toEqual(['Track V2', 'Track V1', 'Track A1']);
    expect(screen.getByLabelText('Keyframe inspector')).toBeInTheDocument();
    expect(screen.getByText(/▶ 2×/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle snapping' }));
    expect(onToggleSnapping).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Razor at playhead' }));
    expect(onRazorAt).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: 'Add audio track' }));
    expect(onAddTrack).toHaveBeenCalledWith('audio');

    fireEvent.keyDown(window, { key: 'c' });
    expect(screen.getByRole('button', { name: 'Razor (C)' })).toHaveAttribute('aria-pressed', 'true');
  });
});
