import React, { useRef, useCallback, useEffect, useState } from 'react';
import { formatTime } from '../../utils/videoUtils';
import type { TimelineMarker, TimelineTrack, TimelineClip, TrackType } from '../../types';
import TimelineTrackComponent, { TRACK_HEADER_W, TRACK_H_VIDEO, TRACK_H_AUDIO } from './TimelineTrack';
import TimelineRuler from './TimelineRuler';

const PIXELS_PER_SECOND = 60;
const RULER_H           = 22;
const MARKER_H          = 16;

const MARKER_COLORS: Record<TimelineMarker['color'], string> = {
  red: '#e05555', yellow: '#e0c044', green: '#44a055', blue: '#4477e0',
};

interface ProTimelineProps {
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  markers: TimelineMarker[];
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  zoom: number;
  hasVideo: boolean;
  onSeek: (time: number) => void;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  onZoomChange: (zoom: number) => void;
  onAddMarker: () => void;
  onRemoveMarker: (id: string) => void;
  onAddTrack: (type: TrackType) => void;
  onSetTrackMuted: (trackId: string, muted: boolean) => void;
  onSetTrackLocked: (trackId: string, locked: boolean) => void;
  onRemoveTrack: (trackId: string) => void;
  onDeleteClip: (clipId: string) => void;
  onSplitClip: (clipId: string, atTime: number) => void;
}

const ProTimeline: React.FC<ProTimelineProps> = ({
  duration, currentTime, trimStart, trimEnd, markers, tracks, clips, zoom, hasVideo,
  onSeek, onTrimStartChange, onTrimEndChange, onZoomChange, onAddMarker, onRemoveMarker,
  onAddTrack, onSetTrackMuted, onSetTrackLocked, onRemoveTrack, onDeleteClip, onSplitClip,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const pps = PIXELS_PER_SECOND * zoom;
  const trackWidth = Math.max(duration * pps + 40, 400);
  // Total height = ruler + marker lane + sum of all track heights
  const tracksH = tracks.reduce(
    (sum, t) => sum + (t.type === 'video' ? TRACK_H_VIDEO : TRACK_H_AUDIO),
    0
  );
  const totalH = RULER_H + MARKER_H + tracksH;

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

  const handleSplitSelected = useCallback(() => {
    if (selectedClipId) onSplitClip(selectedClipId, currentTime);
  }, [selectedClipId, currentTime, onSplitClip]);

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
        <button className="tl-tool-btn" onClick={onAddMarker} title="Add marker (M)" aria-label="Add marker">
          ◆ Mark
        </button>
        <button className="tl-tool-btn" onClick={() => onAddTrack('video')} title="Add video track" aria-label="Add video track">
          + V
        </button>
        <button className="tl-tool-btn" onClick={() => onAddTrack('audio')} title="Add audio track" aria-label="Add audio track">
          + A
        </button>
        {selectedClipId && (
          <button className="tl-tool-btn" onClick={handleSplitSelected} title="Split clip at playhead" aria-label="Split selected clip at playhead">
            ✂ Split
          </button>
        )}
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
        {/* Content column — MultiTrack rows handle their own headers */}
        <div className="pro-tl-content-multitrack" style={{ width: trackWidth + TRACK_HEADER_W, minWidth: '100%' }}>
          {/* ── Time ruler (spans full width) ── */}
          <div style={{ display: 'flex' }}>
            <div style={{ width: TRACK_HEADER_W, minWidth: TRACK_HEADER_W, height: RULER_H }} className="tl-hd-ruler" />
            <TimelineRuler
              duration={duration}
              pixelsPerSecond={pps}
              width={trackWidth}
              height={RULER_H}
              currentTime={currentTime}
            />
          </div>

          {/* ── Marker lane ── */}
          <div style={{ display: 'flex' }}>
            <div style={{ width: TRACK_HEADER_W, minWidth: TRACK_HEADER_W, height: MARKER_H }} className="tl-hd-lane" />
            <div className="tl-marker-lane" style={{ height: MARKER_H, width: trackWidth, position: 'relative' }}>
              {markers.map((m) => (
                <div
                  key={m.id}
                  className="tl-marker"
                  style={{ left: m.time * pps, color: MARKER_COLORS[m.color] }}
                  title={`${m.label || 'Marker'} — ${formatTime(m.time)} (double-click to delete)`}
                  onDoubleClick={(e) => { e.stopPropagation(); onRemoveMarker(m.id); }}
                >
                  ◆
                </div>
              ))}
            </div>
          </div>

          {/* ── Multi-track rows ── */}
          {tracks.map((track) => (
            <TimelineTrackComponent
              key={track.id}
              track={track}
              clips={clips.filter((c) => c.trackId === track.id)}
              pixelsPerSecond={pps}
              trackWidth={trackWidth}
              selectedClipId={selectedClipId}
              onSelectClip={setSelectedClipId}
              onDeleteClip={onDeleteClip}
              onToggleMute={onSetTrackMuted}
              onToggleLock={onSetTrackLocked}
              onRemoveTrack={onRemoveTrack}
            />
          ))}

          {/* ── Trim handles overlaid on track content area ── */}
          <div
            className="tl-trim-handle tl-trim-in"
            style={{
              left: trimInLeft + TRACK_HEADER_W,
              top: RULER_H + MARKER_H,
              height: tracksH,
            }}
            title={`In point: ${formatTime(trimStart)}`}
          />
          <div
            className="tl-trim-handle tl-trim-out"
            style={{
              left: trimOutLeft + TRACK_HEADER_W,
              top: RULER_H + MARKER_H,
              height: tracksH,
            }}
            title={`Out point: ${formatTime(trimEnd)}`}
          />

          {/* ── Playhead ── */}
          <div
            className="tl-playhead"
            style={{ left: playheadLeft + TRACK_HEADER_W, height: totalH, top: 0 }}
            aria-hidden="true"
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
