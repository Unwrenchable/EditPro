import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackSettings from '../components/video/PlaybackSettings';

describe('PlaybackSettings', () => {
  const props = {
    resolution: 'full' as const,
    useProxy: true,
    proxyAvailable: true,
    status: 'running' as const,
    percent: 42.4,
    message: null,
    decodeLabel: 'Hardware decode on',
    previewLabel: 'Proxy 1920×1080 · Full',
    onResolution: vi.fn(),
    onToggleProxy: vi.fn(),
    onCancelProxy: vi.fn(),
  };

  it('switches resolution, proxy mode, and shows generation progress', () => {
    render(<PlaybackSettings {...props} />);
    expect(screen.getByText('Hardware decode on')).toBeInTheDocument();
    expect(screen.getByText('Export uses the original')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Proxy generation' })).toHaveAttribute('aria-valuenow', '42');

    fireEvent.change(screen.getByRole('combobox', { name: 'Playback resolution' }), { target: { value: 'quarter' } });
    expect(props.onResolution).toHaveBeenCalledWith('quarter');

    fireEvent.click(screen.getByRole('button', { name: 'Proxy' }));
    expect(props.onToggleProxy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancelProxy).toHaveBeenCalledTimes(1);
  });

  it('reports a proxy failure without hiding the original-export note', () => {
    render(
      <PlaybackSettings
        {...props}
        status="error"
        message="Proxy generation failed. Playback will keep using the original."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/original/);
    expect(screen.getByText('Export uses the original')).toBeInTheDocument();
  });
});
