import React, { useCallback } from 'react';
import TimelineClipComponent from './TimelineClip';
import type { TimelineTrack as TimelineTrackType, TimelineClip } from '../../types';

const TRACK_H_VIDEO = 34;
const TRACK_H_AUDIO = 30;

interface TimelineTrackProps {
  track: TimelineTrackType;
  clips: TimelineClip[];
  pixelsPerSecond: number;
  trackWidth: number;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onDeleteClip: (clipId: string) => void;
  onToggleMute: (trackId: string, muted: boolean) => void;
  onToggleLock: (trackId: string, locked: boolean) => void;
  onRemoveTrack: (trackId: string) => void;
}

const HEADER_W = 100;

/**
 * Renders a single multi-track timeline row: a sticky header on the left
 * and scrollable clip content on the right.
 */
const TimelineTrackComponent: React.FC<TimelineTrackProps> = ({
  track,
  clips,
  pixelsPerSecond,
  trackWidth,
  selectedClipId,
  onSelectClip,
  onDeleteClip,
  onToggleMute,
  onToggleLock,
  onRemoveTrack,
}) => {
  const trackHeight = track.type === 'video' ? TRACK_H_VIDEO : TRACK_H_AUDIO;

  const handleMute = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleMute(track.id, !track.muted);
    },
    [track.id, track.muted, onToggleMute]
  );

  const handleLock = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleLock(track.id, !track.locked);
    },
    [track.id, track.locked, onToggleLock]
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemoveTrack(track.id);
    },
    [track.id, onRemoveTrack]
  );

  return (
    <div
      className={`tl-multitrack-row${track.muted ? ' tl-track-muted' : ''}${track.locked ? ' tl-track-locked' : ''}`}
      style={{ height: trackHeight, display: 'flex' }}
    >
      {/* ── Track header ── */}
      <div
        className="tl-multitrack-header"
        style={{ width: HEADER_W, minWidth: HEADER_W, height: trackHeight }}
        aria-label={`Track ${track.name}`}
      >
        <span className="tl-hd-label">{track.name}</span>
        <button
          className={`tl-hd-btn${track.muted ? ' active' : ''}`}
          onClick={handleMute}
          title={track.muted ? 'Unmute track' : 'Mute track'}
          aria-label={track.muted ? `Unmute track ${track.name}` : `Mute track ${track.name}`}
          aria-pressed={track.muted}
        >
          {track.muted ? 'M' : 'm'}
        </button>
        <button
          className={`tl-hd-btn${track.locked ? ' active' : ''}`}
          onClick={handleLock}
          title={track.locked ? 'Unlock track' : 'Lock track'}
          aria-label={track.locked ? `Unlock track ${track.name}` : `Lock track ${track.name}`}
          aria-pressed={track.locked}
        >
          {track.locked ? '🔒' : '🔓'}
        </button>
        <button
          className="tl-hd-btn tl-hd-remove"
          onClick={handleRemove}
          title={`Remove track ${track.name}`}
          aria-label={`Remove track ${track.name}`}
        >
          ×
        </button>
      </div>

      {/* ── Clip content ── */}
      <div
        className={`tl-track${track.type === 'video' ? ' tl-track-video' : ' tl-track-audio'}`}
        style={{ height: trackHeight, width: trackWidth, position: 'relative', flex: 1 }}
      >
        {clips.map((clip) => (
          <TimelineClipComponent
            key={clip.id}
            clip={clip}
            pixelsPerSecond={pixelsPerSecond}
            trackHeight={trackHeight}
            isSelected={selectedClipId === clip.id}
            onSelect={onSelectClip}
            onDoubleClick={onDeleteClip}
          />
        ))}
      </div>
    </div>
  );
};

export { HEADER_W as TRACK_HEADER_W, TRACK_H_VIDEO, TRACK_H_AUDIO };
export default TimelineTrackComponent;
