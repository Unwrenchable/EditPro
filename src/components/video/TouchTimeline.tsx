import React, { useRef } from 'react';
import { formatTime } from '../../utils/videoUtils';
import { pinchScale, pointerDistance, seekRatio, type Point } from '../../pwa/gestures';
import type { TimelineClip } from '../../types';

interface TouchTimelineProps {
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  zoom: number;
  clips: TimelineClip[];
  onSeek: (time: number) => void;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  onZoomChange: (zoom: number) => void;
  onRazorAt: (time: number) => void;
  onDeleteClip: (clipId: string) => void;
}

/**
 * Phone and tablet timeline. One seek track, large trim handles, pinch zoom,
 * and a short clip list. The full multitrack editor stays on a fine pointer.
 */
const TouchTimeline: React.FC<TouchTimelineProps> = ({
  duration,
  currentTime,
  trimStart,
  trimEnd,
  zoom,
  clips,
  onSeek,
  onTrimStartChange,
  onTrimEndChange,
  onZoomChange,
  onRazorAt,
  onDeleteClip,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  const span = duration > 0 ? duration : 1;
  const playhead = (currentTime / span) * 100;
  const inPct = (trimStart / span) * 100;
  const outPct = (trimEnd / span) * 100;

  const seekAt = (clientX: number) => {
    const track = trackRef.current;
    if (!track || duration <= 0) return;
    const rect = track.getBoundingClientRect();
    onSeek(seekRatio(clientX, rect.left, rect.width) * duration);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2) {
      const [first, second] = [...pointers.current.values()];
      if (first && second) {
        pinchStart.current = { distance: pointerDistance(first, second), zoom };
      }
      return;
    }
    pinchStart.current = null;
    seekAt(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinchStart.current) {
      const [first, second] = [...pointers.current.values()];
      if (!first || !second) return;
      onZoomChange(pinchScale(pinchStart.current.distance, pointerDistance(first, second), pinchStart.current.zoom));
      return;
    }
    seekAt(event.clientX);
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  return (
    <section className="touch-timeline" aria-label="Simplified timeline">
      <div className="touch-timeline-times">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(Math.max(0, trimEnd - trimStart))} selected</span>
        <span>{formatTime(duration)}</span>
      </div>
      <div
        ref={trackRef}
        className="touch-seek"
        role="slider"
        aria-label="Video timeline"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onKeyDown={(event) => {
          if (duration <= 0) return;
          if (event.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + 0.5));
          if (event.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 0.5));
        }}
      >
        <div className="touch-seek-range" style={{ left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }} />
        <div className="touch-seek-playhead" style={{ left: `${playhead}%` }} />
      </div>
      <div className="touch-trim">
        <label>
          In
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={trimStart}
            aria-label="Trim start"
            onChange={(event) => onTrimStartChange(Number(event.target.value))}
          />
        </label>
        <label>
          Out
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={trimEnd}
            aria-label="Trim end"
            onChange={(event) => onTrimEndChange(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="touch-actions">
        <button type="button" onClick={() => onZoomChange(Math.max(0.5, zoom - 0.5))} aria-label="Zoom out">−</button>
        <span>Zoom {zoom.toFixed(1)}×</span>
        <button type="button" onClick={() => onZoomChange(Math.min(8, zoom + 0.5))} aria-label="Zoom in">+</button>
        <button type="button" onClick={() => onRazorAt(currentTime)}>Split at playhead</button>
      </div>
      {clips.length > 0 && (
        <ul className="touch-clips">
          {clips.map((clip) => (
            <li key={clip.id}>
              <button type="button" onClick={() => onSeek(clip.startTime)}>
                Clip · {formatTime(clip.startTime)}
              </button>
              <button type="button" onClick={() => onDeleteClip(clip.id)} aria-label={`Delete clip ${clip.id}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="touch-hint">Drag to scrub. Pinch to zoom. A mouse or trackpad keeps the full multitrack timeline.</p>
    </section>
  );
};

export default TouchTimeline;
