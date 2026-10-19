import { fileUrlToPath, isFilesystemPath, type ExportSourceClip } from './exportPlan';

interface ClipLike {
  id?: string;
  src: string;
  trackId: string;
  startTime: number;
  inPoint: number;
  outPoint: number;
}

interface TrackLike {
  id: string;
  type: 'video' | 'audio';
  muted: boolean;
}

/**
 * Timeline clips ffmpeg can open. Blob and data URLs are skipped — those
 * clips are still on the timeline but have no file for the encoder to read.
 * Muted tracks are left out of the render.
 */
export function timelineClipsForExport(
  clips: readonly ClipLike[],
  tracks: readonly TrackLike[]
): { clips: ExportSourceClip[]; skippedUnreadable: number } {
  const exported: ExportSourceClip[] = [];
  let skippedUnreadable = 0;
  for (const clip of clips) {
    const track = tracks.find((item) => item.id === clip.trackId);
    if (!track || track.muted) continue;
    if (!isFilesystemPath(clip.src)) {
      skippedUnreadable += 1;
      continue;
    }
    const exportedClip: ExportSourceClip = {
      sourcePath: fileUrlToPath(clip.src),
      trackType: track.type,
      startTime: clip.startTime,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
    };
    if (clip.id) {
      exportedClip.clipId = clip.id;
      exportedClip.trackId = clip.trackId;
    }
    exported.push(exportedClip);
  }
  return { clips: exported, skippedUnreadable };
}

export function isTrackMuted(
  tracks: readonly { id: string; type: string; muted: boolean }[],
  trackId: string
): boolean {
  return tracks.find((track) => track.id === trackId)?.muted ?? false;
}
