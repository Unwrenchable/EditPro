import React, { useRef } from 'react';

interface TimelineSplitterProps {
  height: number;
  min: number;
  max: number;
  onChange: (height: number) => void;
}

/** Drag or arrow-key the boundary between the monitor and the timeline. */
const TimelineSplitter: React.FC<TimelineSplitterProps> = ({ height, min, max, onChange }) => {
  const origin = useRef({ y: 0, height: 0 });

  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    origin.current = { y: event.clientY, height };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      onChange(clamp(origin.current.height - (ev.clientY - origin.current.y)));
    };
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  return (
    <div
      className="timeline-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={height}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') onChange(clamp(height + 16));
        if (event.key === 'ArrowDown') onChange(clamp(height - 16));
      }}
    />
  );
};

export default TimelineSplitter;
