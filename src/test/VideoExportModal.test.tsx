import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VideoExportModal from '../components/video/VideoExportModal';
import { DEFAULT_AUDIO, DEFAULT_LUMETRI } from '../utils/videoUtils';
import type { EditProBridge, VideoExportEvent } from '../types/electron';

const tracks = [
  { id: 'v1', type: 'video' as const, name: 'V1', muted: false, locked: false },
  { id: 'a1', type: 'audio' as const, name: 'A1', muted: false, locked: false },
];

function renderModal(sourcePath: string | null = 'C:\\Videos\\clip.mp4') {
  const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
  return render(
    <VideoExportModal
      file={file}
      sourcePath={sourcePath}
      trimStart={0}
      trimEnd={4}
      playbackRate={1}
      volume={1}
      muted={false}
      lumetri={DEFAULT_LUMETRI}
      audio={DEFAULT_AUDIO}
      autoReframe="original"
      transition="fade"
      clips={[]}
      tracks={tracks}
      initialPlatform="youtube"
      initialQuality={90}
      onTransitionChange={() => {}}
      onClose={() => {}}
    />
  );
}

describe('VideoExportModal', () => {
  beforeEach(() => {
    delete window.editpro;
  });

  afterEach(() => {
    delete window.editpro;
  });

  it('explains that browser preview cannot encode video', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/desktop app/);
    expect(screen.getByRole('alert')).toHaveTextContent(/ffmpeg/);
  });

  it('does not start ffmpeg when the save dialog is cancelled', async () => {
    const startVideoExport = vi.fn();
    window.editpro = {
      saveVideo: vi.fn().mockResolvedValue(null),
      startVideoExport,
      onExportEvent: () => () => {},
    } as unknown as EditProBridge;
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(window.editpro!.saveVideo).toHaveBeenCalled());
    expect(startVideoExport).not.toHaveBeenCalled();
  });

  it('shows a progress bar and cancels the running job', async () => {
    let listener: ((event: VideoExportEvent) => void) | null = null;
    const cancelVideoExport = vi.fn().mockResolvedValue(true);
    let resolveExport: (value: { status: 'cancelled'; outputPath: string }) => void = () => {};
    window.editpro = {
      saveVideo: vi.fn().mockResolvedValue('C:\\Out\\clip_1080p_30fps.mp4'),
      startVideoExport: vi.fn((request: { jobId: string; outputPath: string }) => {
        listener?.({ jobId: request.jobId, type: 'progress', percent: 35, timeSec: 1.2 });
        return new Promise((resolve) => {
          resolveExport = resolve;
        });
      }),
      cancelVideoExport,
      onExportEvent: (cb: (event: VideoExportEvent) => void) => {
        listener = cb;
        return () => {};
      },
      showItemInFolder: vi.fn(),
    } as unknown as EditProBridge;

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const bar = await screen.findByRole('progressbar', { name: 'Export progress' });
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '35'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
    await waitFor(() => expect(cancelVideoExport).toHaveBeenCalledTimes(1));
    resolveExport({ status: 'cancelled', outputPath: 'C:\\Out\\clip_1080p_30fps.mp4' });
    expect(await screen.findByText(/Export cancelled/)).toBeInTheDocument();
  });

  it('reports a finished file and a clear encoder error', async () => {
    window.editpro = {
      saveVideo: vi.fn().mockResolvedValue('C:\\Out\\clip.mp4'),
      startVideoExport: vi.fn().mockResolvedValue({
        status: 'error',
        outputPath: 'C:\\Out\\clip.mp4',
        message: 'Export failed: the disk is full.',
      }),
      onExportEvent: () => () => {},
    } as unknown as EditProBridge;
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk is full');
  });
});
