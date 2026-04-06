import React, { useCallback } from 'react';
import { formatTime } from '../../utils/videoUtils';
import type { TimelineClip as TimelineClipType } from '../../types';

interface TimelineClipProps {
  clip: TimelineClipType;
  pixelsPerSecond: number;
  trackHeight: number;
  isSelected: boolean;
  onSelect: (clipId: string) => void;
  onDoubleClick: (clipId: string) => void;
}

/**
 * Renders a single clip block on the multi-track timeline.
 * Left position and width are derived from the clip's startTime/endTime.
 */
const TimelineClipComponent: React.FC<TimelineClipProps> = ({
  clip,
  pixelsPerSecond,
  trackHeight,
  isSelected,
  onSelect,
  onDoubleClick,
}) => {
  const left = clip.startTime * pixelsPerSecond;
  const width = Math.max(2, (clip.endTime - clip.startTime) * pixelsPerSecond);
  const label = clip.src.split('/').pop() ?? clip.id;
  const durationLabel = formatTime(clip.outPoint - clip.inPoint);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onSelect(clip.id);
    },
    [clip.id, onSelect]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDoubleClick(clip.id);
    },
    [clip.id, onDoubleClick]
  );

  return (
    <div
      className={`tl-clip${isSelected ? ' tl-clip-selected' : ''}`}
      style={{ left, width, height: trackHeight - 4 }}
      title={`${label} (${durationLabel}) — double-click to delete`}
      role="button"
      tabIndex={0}
      aria-label={`Clip ${label}, duration ${durationLabel}`}
      aria-pressed={isSelected}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(clip.id); }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onDoubleClick(clip.id); }
      }}
    >
      <span className="tl-clip-label">{label}</span>
    </div>
  );
};

export default TimelineClipComponent;
