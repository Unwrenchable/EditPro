import React from 'react';
import { formatTime } from '../../utils/videoUtils';

interface VideoTimelineProps {
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  onSeek: (time: number) => void;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
}

const VideoTimeline: React.FC<VideoTimelineProps> = ({
  duration,
  currentTime,
  trimStart,
  trimEnd,
  onSeek,
  onTrimStartChange,
  onTrimEndChange,
}) => {
  if (duration <= 0) return null;

  const trimStartPct = (trimStart / duration) * 100;
  const trimEndPct = (trimEnd / duration) * 100;
  const playheadPct = (currentTime / duration) * 100;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(pct * duration);
  };

  return (
    <div className="timeline-panel">
      <div className="timeline-times">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div className="timeline-track" onClick={handleTrackClick} role="slider" aria-label="Video timeline" aria-valuenow={currentTime} aria-valuemin={0} aria-valuemax={duration}>
        {/* Trim region highlight */}
        <div
          className="timeline-trim-region"
          style={{
            left: `${trimStartPct}%`,
            width: `${trimEndPct - trimStartPct}%`,
          }}
        />
        {/* Playhead */}
        <div
          className="timeline-playhead"
          style={{ left: `${playheadPct}%` }}
        />
      </div>

      <div className="trim-controls">
        <div className="trim-row">
          <label className="trim-label">In point</label>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={trimStart}
            onChange={(e) => onTrimStartChange(Number(e.target.value))}
            className="trim-slider"
            aria-label="Trim start"
          />
          <span className="trim-time">{formatTime(trimStart)}</span>
        </div>
        <div className="trim-row">
          <label className="trim-label">Out point</label>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={trimEnd}
            onChange={(e) => onTrimEndChange(Number(e.target.value))}
            className="trim-slider"
            aria-label="Trim end"
          />
          <span className="trim-time">{formatTime(trimEnd)}</span>
        </div>
      </div>

      <div className="trim-duration">
        Clip duration: <strong>{formatTime(trimEnd - trimStart)}</strong>
      </div>
    </div>
  );
};

export default VideoTimeline;
