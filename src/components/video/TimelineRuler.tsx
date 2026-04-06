import React from 'react';
import { formatTime } from '../../utils/videoUtils';

interface TimelineRulerProps {
  duration: number;
  pixelsPerSecond: number;
  width: number;
  height: number;
  currentTime: number;
}

/**
 * Horizontal time ruler showing tick marks and time labels.
 * Rendered inside the scrollable timeline track area.
 */
const TimelineRuler: React.FC<TimelineRulerProps> = ({
  duration,
  pixelsPerSecond,
  width,
  height,
  currentTime,
}) => {
  // Choose tick interval based on zoom density
  const tickSecs =
    pixelsPerSecond >= 300 ? 1 :
    pixelsPerSecond >= 120 ? 2 :
    pixelsPerSecond >=  60 ? 5 :
    pixelsPerSecond >=  30 ? 10 : 30;

  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickSecs) ticks.push(t);

  const playheadX = currentTime * pixelsPerSecond;

  return (
    <div
      className="tl-ruler"
      style={{ height, width, position: 'relative' }}
      role="presentation"
      aria-label="Timeline ruler"
    >
      {ticks.map((t) => (
        <div key={t} className="tl-tick" style={{ left: t * pixelsPerSecond }}>
          <span className="tl-tick-label">{formatTime(t)}</span>
        </div>
      ))}
      {/* Playhead marker on ruler */}
      <div
        className="tl-ruler-playhead"
        style={{ left: playheadX, height }}
        aria-hidden="true"
      />
    </div>
  );
};

export default TimelineRuler;
