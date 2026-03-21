import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoControls from '../components/video/VideoControls';

describe('VideoControls', () => {
  const baseProps = {
    isPlaying: false,
    currentTime: 0,
    duration: 120,
    volume: 1,
    isMuted: false,
    playbackRate: 1,
    onTogglePlay: vi.fn(),
    onVolumeChange: vi.fn(),
    onToggleMute: vi.fn(),
    onPlaybackRateChange: vi.fn(),
  };

  it('shows play icon when not playing', () => {
    render(<VideoControls {...baseProps} />);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('shows pause icon when playing', () => {
    render(<VideoControls {...baseProps} isPlaying={true} />);
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  it('calls onTogglePlay when play button is clicked', () => {
    const onTogglePlay = vi.fn();
    render(<VideoControls {...baseProps} onTogglePlay={onTogglePlay} />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleMute when mute button clicked', () => {
    const onToggleMute = vi.fn();
    render(<VideoControls {...baseProps} onToggleMute={onToggleMute} />);
    fireEvent.click(screen.getByRole('button', { name: /mute/i }));
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('displays current time and duration', () => {
    render(<VideoControls {...baseProps} currentTime={65} duration={120} />);
    expect(screen.getByText('1:05 / 2:00')).toBeInTheDocument();
  });

  it('calls onPlaybackRateChange when speed is changed', () => {
    const onPlaybackRateChange = vi.fn();
    render(<VideoControls {...baseProps} onPlaybackRateChange={onPlaybackRateChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: /speed/i }), {
      target: { value: '2' },
    });
    expect(onPlaybackRateChange).toHaveBeenCalledWith(2);
  });
});
