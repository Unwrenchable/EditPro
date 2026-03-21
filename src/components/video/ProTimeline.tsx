import React, { useRef, useCallback, useEffect } from 'react';
import { formatTime } from '../../utils/videoUtils';
import type { TimelineMarker } from '../../types';

const PIXELS_PER_SECOND = 60;
const TRACK_HEADER_W    = 58;
const RULER_H           = 22;
const MARKER_H          = 16;
const TRACK_H           = 34;
const AUDIO_TRACK_H     = 30;

const MARKER_COLORS: Record<TimelineMarker['color'], string> = {
  red: '#e05555', yellow: '#e0c044', green: '#44a055', blue: '#4477e0',
};

interface ProTimelineProps {
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  markers: TimelineMarker[];
  zoom: number;
  hasVideo: boolean;
  onSeek: (time: number) => void;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  onZoomChange: (zoom: number) => void;
  onAddMarker: () => void;
  onRemoveMarker: (id: string) => void;
}

const ProTimeline: React.FC<ProTimelineProps> = ({
  duration, currentTime, trimStart, trimEnd, markers, zoom, hasVideo,
  onSeek, onTrimStartChange, onTrimEndChange, onZoomChange, onAddMarker, onRemoveMarker,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const pps = PIXELS_PER_SECOND * zoom;
  const trackWidth = Math.max(duration * pps + 40, 400);
  const totalH = RULER_H + MARKER_H + TRACK_H + AUDIO_TRACK_H;

  // Auto-scroll to keep playhead visible
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasVideo) return;
    const playheadX = currentTime * pps;
    const { scrollLeft, clientWidth } = el;
    const margin = clientWidth * 0.15;
    if (playheadX < scrollLeft + margin) {
      el.scrollLeft = Math.max(0, playheadX - margin);
    } else if (playheadX > scrollLeft + clientWidth - margin) {
      el.scrollLeft = playheadX - clientWidth + margin;
    }
  }, [currentTime, pps, hasVideo]);

  const timeFromMouseX = useCallback(
    (clientX: number): number => {
      const el = scrollRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left - TRACK_HEADER_W + el.scrollLeft;
      return Math.max(0, Math.min(duration, x / pps));
    },
    [pps, duration]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      onSeek(timeFromMouseX(e.clientX));
    },
    [onSeek, timeFromMouseX]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging.current) onSeek(timeFromMouseX(e.clientX));
    },
    [onSeek, timeFromMouseX]
  );

  const stopDrag = useCallback(() => { isDragging.current = false; }, []);

  // Build time ruler ticks
  const tickSecs = zoom >= 5 ? 1 : zoom >= 2 ? 2 : zoom >= 1 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickSecs) ticks.push(t);

  const playheadLeft = currentTime * pps;
  const trimInLeft   = trimStart  * pps;
  const trimOutLeft  = trimEnd    * pps;

  if (!hasVideo) {
    return (
      <div className="pro-timeline pro-timeline-empty">
        <p className="tl-empty-msg">Load a video to see the timeline</p>
      </div>
    );
  }

  return (
    <div className="pro-timeline">
      {/* ── Toolbar ── */}
      <div className="pro-tl-toolbar">
        <button className="tl-tool-btn" onClick={onAddMarker} title="Add marker (M)">
          ◆ Mark
        </button>
        <span className="tl-timecode">{formatTime(currentTime)} / {formatTime(duration)}</span>
        <div className="tl-zoom-row">
          <span className="tl-zoom-label">Zoom</span>
          <input
            type="range" min={0.5} max={8} step={0.5} value={zoom}
            onChange={(e) => onZoomChange(Number(e.target.value))}
            className="tl-zoom-slider" aria-label="Timeline zoom"
          />
          <span className="tl-zoom-value">{zoom.toFixed(1)}×</span>
        </div>
      </div>

      {/* ── Track area (scrollable) ── */}
      <div
        ref={scrollRef}
        className="pro-tl-scroll"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
        style={{ height: totalH + 2 }}
      >
        {/* Left track headers (sticky via absolute+sticky trick) */}
        <div className="pro-tl-headers" style={{ width: TRACK_HEADER_W, height: totalH }}>
          <div className="tl-hd-ruler"  style={{ height: RULER_H }}  />
          <div className="tl-hd-lane"   style={{ height: MARKER_H }} />
          <div className="tl-hd-track"  style={{ height: TRACK_H }}>
            <span className="tl-hd-label">V1</span>
          </div>
          <div className="tl-hd-track tl-hd-audio" style={{ height: AUDIO_TRACK_H }}>
            <span className="tl-hd-label">A1</span>
          </div>
        </div>

        {/* Content column (scrolls) */}
        <div className="pro-tl-content" style={{ width: trackWidth, height: totalH }}>
          {/* ── Time ruler ── */}
          <div className="tl-ruler" style={{ height: RULER_H, width: trackWidth }}>
            {ticks.map((t) => (
              <div key={t} className="tl-tick" style={{ left: t * pps }}>
                <span className="tl-tick-label">{formatTime(t)}</span>
              </div>
            ))}
          </div>

          {/* ── Marker lane ── */}
          <div className="tl-marker-lane" style={{ height: MARKER_H, width: trackWidth }}>
            {markers.map((m) => (
              <div
                key={m.id}
                className="tl-marker"
                style={{
                  left: m.time * pps,
                  color: MARKER_COLORS[m.color],
                }}
                title={`${m.label || 'Marker'} — ${formatTime(m.time)} (double-click to delete)`}
                onDoubleClick={(e) => { e.stopPropagation(); onRemoveMarker(m.id); }}
              >
                ◆
              </div>
            ))}
          </div>

          {/* ── Video track V1 ── */}
          <div className="tl-track tl-track-video" style={{ height: TRACK_H, width: trackWidth }}>
            {/* Trimmed-out start */}
            {trimStart > 0 && (
              <div className="tl-clip-muted" style={{ left: 0, width: trimInLeft }} />
            )}
            {/* Active clip region */}
            <div
              className="tl-clip-active"
              style={{ left: trimInLeft, width: trimOutLeft - trimInLeft }}
            >
              <span className="tl-clip-label">Video</span>
            </div>
            {/* Trimmed-out end */}
            {trimEnd < duration && (
              <div className="tl-clip-muted" style={{ left: trimOutLeft, width: (duration - trimEnd) * pps }} />
            )}
          </div>

          {/* ── Audio track A1 ── */}
          <div className="tl-track tl-track-audio" style={{ height: AUDIO_TRACK_H, width: trackWidth }}>
            {trimStart > 0 && (
              <div className="tl-clip-muted tl-clip-muted-audio" style={{ left: 0, width: trimInLeft }} />
            )}
            <div
              className="tl-clip-active tl-clip-active-audio"
              style={{ left: trimInLeft, width: trimOutLeft - trimInLeft }}
            >
              {/* Simulated waveform */}
              <div className="tl-waveform">
                {Array.from({ length: Math.min(Math.floor((trimEnd - trimStart) * pps / 4), 200) }).map((_, i) => (
                  <div
                    key={i}
                    className="tl-wave-bar"
                    style={{ height: `${25 + Math.sin(i * 0.7) * 15 + Math.sin(i * 2.1) * 8}%` }}
                  />
                ))}
              </div>
            </div>
            {trimEnd < duration && (
              <div className="tl-clip-muted tl-clip-muted-audio" style={{ left: trimOutLeft, width: (duration - trimEnd) * pps }} />
            )}
          </div>

          {/* ── Trim handles (In/Out points) ── */}
          <div
            className="tl-trim-handle tl-trim-in"
            style={{ left: trimInLeft, top: RULER_H + MARKER_H, height: TRACK_H + AUDIO_TRACK_H }}
            title={`In point: ${formatTime(trimStart)}`}
          />
          <div
            className="tl-trim-handle tl-trim-out"
            style={{ left: trimOutLeft, top: RULER_H + MARKER_H, height: TRACK_H + AUDIO_TRACK_H }}
            title={`Out point: ${formatTime(trimEnd)}`}
          />

          {/* ── Playhead ── */}
          <div
            className="tl-playhead"
            style={{ left: playheadLeft, height: totalH }}
          >
            <div className="tl-playhead-head" />
          </div>
        </div>
      </div>

      {/* ── In/Out sliders (accessible keyboard control) ── */}
      <div className="tl-inout-bar">
        <div className="trim-row">
          <label className="trim-label">In</label>
          <input type="range" min={0} max={duration} step={0.1} value={trimStart}
            onChange={(e) => onTrimStartChange(Number(e.target.value))}
            className="trim-slider" aria-label="Trim start" />
          <span className="trim-time">{formatTime(trimStart)}</span>
        </div>
        <div className="trim-row">
          <label className="trim-label">Out</label>
          <input type="range" min={0} max={duration} step={0.1} value={trimEnd}
            onChange={(e) => onTrimEndChange(Number(e.target.value))}
            className="trim-slider" aria-label="Trim end" />
          <span className="trim-time">{formatTime(trimEnd)}</span>
        </div>
        <div className="trim-duration">
          Duration: <strong>{formatTime(trimEnd - trimStart)}</strong>
        </div>
      </div>
    </div>
  );
};

export default ProTimeline;
