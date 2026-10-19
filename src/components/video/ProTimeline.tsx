import React, { useRef, useCallback, useEffect, useState } from 'react';
import { formatTime } from '../../utils/videoUtils';
import type { ClipKeyframe, EaseCurve, KeyframeProperty, TimelineMarker, TimelineTool, TimelineTrack, TimelineClip, TrackType } from '../../types';
import type { BezierHandles } from '../../../electron/export/easing';
import { DEFAULT_BEZIER } from '../../../electron/export/easing';
import type { ClipTransitionKind } from '../../utils/video/creative';
import TimelineTrackComponent, { TRACK_HEADER_W, TRACK_H_VIDEO, TRACK_H_AUDIO } from './TimelineTrack';
import TimelineRuler from './TimelineRuler';
import KeyframeInspector from './KeyframeInspector';
import GraphEditor from './GraphEditor';
import { defaultKeyframeValue, type KeyframePatch } from '../../utils/video/keyframes';
import { collectSnapPoints, createTimelineId, displayTrackOrder, linkedGroup } from '../../utils/video/timelineEdit';
import { matchNleShortcut, nleActionKind } from '../../utils/video/nleShortcuts';

const PIXELS_PER_SECOND = 60;
const RULER_H = 22;
const MARKER_H = 16;

const MARKER_COLORS: Record<TimelineMarker['color'], string> = {
  red: '#e05555', yellow: '#e0c044', green: '#44a055', blue: '#4477e0',
};

const TOOLS: { id: TimelineTool; label: string; title: string }[] = [
  { id: 'select', label: 'V', title: 'Selection (V)' },
  { id: 'razor', label: 'C', title: 'Razor (C)' },
  { id: 'ripple', label: 'B', title: 'Ripple edit (B)' },
  { id: 'roll', label: 'N', title: 'Roll edit (N)' },
  { id: 'slip', label: 'Y', title: 'Slip (Y)' },
  { id: 'slide', label: 'U', title: 'Slide (U)' },
];

interface ProTimelineProps {
  duration: number;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  markers: TimelineMarker[];
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  zoom: number;
  snapping: boolean;
  shuttleRate: number;
  programKeyframes: ClipKeyframe[];
  hasVideo: boolean;
  onSeek: (time: number) => void;
  onTrimStartChange: (value: number) => void;
  onTrimEndChange: (value: number) => void;
  onZoomChange: (zoom: number) => void;
  onToggleSnapping: () => void;
  onAddMarker: () => void;
  onRemoveMarker: (id: string) => void;
  onAddTrack: (type: TrackType) => void;
  onSetTrackMuted: (trackId: string, muted: boolean) => void;
  onSetTrackLocked: (trackId: string, locked: boolean) => void;
  onRemoveTrack: (trackId: string) => void;
  onDeleteClip: (clipId: string) => void;
  onRippleDelete: (clipId: string) => void;
  onSplitClip: (clipId: string, atTime: number) => void;
  onRazorAt: (time: number) => void;
  onMoveClip: (clipId: string, trackId: string, startTime: number, coalesceKey?: string) => void;
  onTrimClip: (clipId: string, edge: 'in' | 'out', time: number, coalesceKey?: string) => void;
  onRippleTrim: (clipId: string, edge: 'in' | 'out', value: number, coalesceKey?: string) => void;
  onRollClip: (clipId: string, edge: 'in' | 'out', time: number, coalesceKey?: string) => void;
  onSlipClip: (clipId: string, newInPoint: number, coalesceKey?: string) => void;
  onSlideClip: (clipId: string, newStart: number, coalesceKey?: string) => void;
  onToggleLink: (selectedId: string | null) => void;
  onAddKeyframe: (clipId: string | null, keyframe: ClipKeyframe) => void;
  onUpdateKeyframe: (clipId: string | null, keyframeId: string, patch: KeyframePatch, coalesceKey?: string) => void;
  onRemoveKeyframe: (clipId: string | null, keyframeId: string) => void;
  peaks?: readonly number[];
  mediaDuration?: number;
  onDropTransition?: (outgoingClipId: string, incomingClipId: string, kind: ClipTransitionKind) => void;
  onInsertClip?: () => void;
}

const ProTimeline: React.FC<ProTimelineProps> = ({
  duration, currentTime, trimStart, trimEnd, markers, tracks, clips, zoom, snapping, shuttleRate,
  programKeyframes, hasVideo,
  onSeek, onTrimStartChange, onTrimEndChange, onZoomChange, onToggleSnapping, onAddMarker, onRemoveMarker,
  onAddTrack, onSetTrackMuted, onSetTrackLocked, onRemoveTrack, onDeleteClip, onRippleDelete, onSplitClip,
  onRazorAt, onMoveClip, onTrimClip, onRippleTrim, onRollClip, onSlipClip, onSlideClip, onToggleLink,
  onAddKeyframe, onUpdateKeyframe, onRemoveKeyframe,
  peaks = [], mediaDuration = 0, onDropTransition, onInsertClip,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [targetedTrackId, setTargetedTrackId] = useState<string | null>(null);
  const [tool, setTool] = useState<TimelineTool>('select');
  const [property, setProperty] = useState<KeyframeProperty>('opacity');
  const [effectParam, setEffectParam] = useState('blur');
  const [easing, setEasing] = useState<EaseCurve>('linear');
  const [armedBezier, setArmedBezier] = useState<BezierHandles>(DEFAULT_BEZIER);
  const [keyframesOpen, setKeyframesOpen] = useState(false);

  const orderedTracks = displayTrackOrder(tracks);
  const pps = PIXELS_PER_SECOND * zoom;
  const trackWidth = Math.max(duration * pps + 40, 400);
  const tracksH = orderedTracks.reduce(
    (sum, track) => sum + (track.type === 'video' ? TRACK_H_VIDEO : TRACK_H_AUDIO),
    0,
  );
  const totalH = RULER_H + MARKER_H + tracksH;
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;

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
    [pps, duration],
  );

  const snapPointsFor = useCallback((clipId: string) => {
    const exclude = linkedGroup(clips, clipId).map((clip) => clip.id);
    return collectSnapPoints(clips, markers, trimStart, trimEnd, currentTime, exclude);
  }, [clips, markers, trimStart, trimEnd, currentTime]);

  const addKeyframe = useCallback(() => {
    const localTime = selectedClip ? Math.min(Math.max(0, currentTime - selectedClip.startTime), Math.max(0, selectedClip.endTime - selectedClip.startTime)) : currentTime;
    const keyframe: ClipKeyframe = {
      id: createTimelineId('kf'),
      time: localTime,
      property,
      value: defaultKeyframeValue(property, property === 'effect' ? effectParam : undefined),
      easing,
    };
    if (easing === 'bezier') keyframe.bezier = armedBezier;
    if (property === 'effect') {
      const param = effectParam.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(param)) return;
      keyframe.effectParam = param;
    }
    onAddKeyframe(selectedClip?.id ?? null, keyframe);
    setSelectedKeyframeId(keyframe.id);
  }, [armedBezier, currentTime, easing, effectParam, onAddKeyframe, property, selectedClip]);

  useEffect(() => {
    if (!hasVideo) return;
    const handler = (event: KeyboardEvent) => {
      if (document.querySelector('.export-modal')) return;
      const action = matchNleShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target: event.target,
      });
      if (!action || nleActionKind(action) !== 'timeline') return;
      event.preventDefault();
      if (action.type === 'tool') setTool(action.tool);
      else if (action.type === 'toggleSnap') onToggleSnapping();
      else if (action.type === 'zoom') onZoomChange(Math.min(8, Math.max(0.5, zoom + action.direction * 0.5)));
      else if (action.type === 'zoomReset') onZoomChange(1);
      else if (action.type === 'razorPlayhead') onRazorAt(currentTime);
      else if (action.type === 'delete' && selectedClipId) {
        if (action.ripple) onRippleDelete(selectedClipId);
        else onDeleteClip(selectedClipId);
      } else if (action.type === 'nudge' && selectedClip) {
        const delta = action.frames / 30;
        onMoveClip(selectedClip.id, selectedClip.trackId, Math.max(0, selectedClip.startTime + delta));
      } else if (action.type === 'addKeyframe') addKeyframe();
      else if (action.type === 'toggleLink') onToggleLink(selectedClipId);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    addKeyframe, currentTime, hasVideo, onDeleteClip, onMoveClip, onRazorAt, onRippleDelete,
    onToggleLink, onToggleSnapping, onZoomChange, selectedClip, selectedClipId, zoom,
  ]);

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('.tl-clip, .tl-multitrack-header, .tl-keyframe')) return;
    isDragging.current = true;
    onSeek(timeFromMouseX(event.clientX));
  }, [onSeek, timeFromMouseX]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    if (isDragging.current) onSeek(timeFromMouseX(event.clientX));
  }, [onSeek, timeFromMouseX]);

  const stopDrag = useCallback(() => { isDragging.current = false; }, []);

  const playheadLeft = currentTime * pps;
  const trimInLeft = trimStart * pps;
  const trimOutLeft = trimEnd * pps;
  const inspectorKeys = selectedClip ? selectedClip.keyframes ?? [] : programKeyframes;

  if (!hasVideo) {
    return (
      <div className="pro-timeline pro-timeline-empty">
        <p className="tl-empty-msg">Load a video to see the timeline</p>
      </div>
    );
  }

  return (
    <div className="pro-timeline">
      <div className="pro-tl-toolbar">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tl-tool-btn${tool === item.id ? ' active' : ''}`}
            aria-pressed={tool === item.id}
            aria-label={item.title}
            title={item.title}
            onClick={() => setTool(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={`tl-tool-btn${snapping ? ' active' : ''}`}
          aria-pressed={snapping}
          aria-label="Toggle snapping"
          title="Toggle snapping (S)"
          onClick={onToggleSnapping}
        >
          Snap
        </button>
        <button className="tl-tool-btn" onClick={onAddMarker} title="Add marker (M)" aria-label="Add marker">
          ◆ Mark
        </button>
        <button className="tl-tool-btn" onClick={() => onAddTrack('video')} title="Add video track" aria-label="Add video track">
          + V
        </button>
        <button className="tl-tool-btn" onClick={() => onAddTrack('audio')} title="Add audio track" aria-label="Add audio track">
          + A
        </button>
        <button className="tl-tool-btn" onClick={() => onRazorAt(currentTime)} title="Razor all unlocked tracks at the playhead (Ctrl+K)" aria-label="Razor at playhead">
          ✂ Razor
        </button>
        <button
          type="button"
          className="tl-tool-btn"
          onClick={onInsertClip}
          disabled={!onInsertClip || duration <= 0}
          title="Insert the open media at the end of V1 and A1"
          aria-label="Insert clip on timeline"
        >
          Insert
        </button>
        {selectedClipId && (
          <button className="tl-tool-btn" onClick={() => onSplitClip(selectedClipId, currentTime)} title="Split selected clip at playhead" aria-label="Split selected clip at playhead">
            Split
          </button>
        )}
        {selectedClipId && (
          <button className="tl-tool-btn" onClick={() => onToggleLink(selectedClipId)} title="Link or unlink (Alt+L)" aria-label="Link or unlink">
            {selectedClip?.linkId ? 'Unlink' : 'Link'}
          </button>
        )}
        <span className="tl-timecode">
          {formatTime(currentTime)} / {formatTime(duration)}
          {shuttleRate !== 0 ? `  ${shuttleRate > 0 ? '▶' : '◀'} ${Math.abs(shuttleRate)}×` : ''}
        </span>
        <button
          type="button"
          className={`tl-tool-btn${keyframesOpen ? ' active' : ''}`}
          aria-pressed={keyframesOpen}
          aria-expanded={keyframesOpen}
          aria-label="Keyframes"
          title="Graph editor and easing"
          onClick={() => setKeyframesOpen((open) => !open)}
        >
          Keyframes
        </button>
        <div className="tl-zoom-row">
          <span className="tl-zoom-label">Zoom</span>
          <input
            type="range" min={0.5} max={8} step={0.5} value={zoom}
            onChange={(event) => onZoomChange(Number(event.target.value))}
            className="tl-zoom-slider" aria-label="Timeline zoom"
          />
          <span className="tl-zoom-value">{zoom.toFixed(1)}×</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="pro-tl-scroll"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <div className="pro-tl-content-multitrack" style={{ width: trackWidth + TRACK_HEADER_W, minWidth: '100%' }}>
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

          <div style={{ display: 'flex' }}>
            <div style={{ width: TRACK_HEADER_W, minWidth: TRACK_HEADER_W, height: MARKER_H }} className="tl-hd-lane" />
            <div className="tl-marker-lane" style={{ height: MARKER_H, width: trackWidth, position: 'relative' }}>
              {markers.map((marker) => (
                <div
                  key={marker.id}
                  className="tl-marker"
                  style={{ left: marker.time * pps, color: MARKER_COLORS[marker.color] }}
                  title={`${marker.label || 'Marker'} — ${formatTime(marker.time)} (double-click to delete)`}
                  onDoubleClick={(event) => { event.stopPropagation(); onRemoveMarker(marker.id); }}
                >
                  ◆
                </div>
              ))}
            </div>
          </div>

          {orderedTracks.map((track) => (
            <TimelineTrackComponent
              key={track.id}
              track={track}
              clips={clips.filter((clip) => clip.trackId === track.id)}
              pixelsPerSecond={pps}
              trackWidth={trackWidth}
              selectedClipId={selectedClipId}
              targeted={targetedTrackId === track.id}
              tool={tool}
              snapping={snapping}
              snapPointsFor={snapPointsFor}
              selectedKeyframeId={selectedKeyframeId}
              onSelectTrack={setTargetedTrackId}
              onSelectClip={setSelectedClipId}
              onDeleteClip={onDeleteClip}
              onRippleDelete={onRippleDelete}
              onRazor={onSplitClip}
              onMove={onMoveClip}
              onTrim={onTrimClip}
              onRippleTrim={onRippleTrim}
              onRoll={onRollClip}
              onSlip={onSlipClip}
              onSlide={onSlideClip}
              onSelectKeyframe={(clipId, keyframeId) => {
                setSelectedClipId(clipId);
                setSelectedKeyframeId(keyframeId);
              }}
              onMoveKeyframe={(clipId, keyframeId, time, coalesceKey) => onUpdateKeyframe(clipId, keyframeId, { time }, coalesceKey)}
              onToggleMute={onSetTrackMuted}
              onToggleLock={onSetTrackLocked}
              onRemoveTrack={onRemoveTrack}
              peaks={track.type === 'audio' ? peaks : []}
              mediaDuration={mediaDuration}
              onDropTransition={onDropTransition}
            />
          ))}

          <div
            className="tl-trim-handle tl-trim-in"
            style={{ left: trimInLeft + TRACK_HEADER_W, top: RULER_H + MARKER_H, height: tracksH }}
            title={`In point: ${formatTime(trimStart)}`}
          />
          <div
            className="tl-trim-handle tl-trim-out"
            style={{ left: trimOutLeft + TRACK_HEADER_W, top: RULER_H + MARKER_H, height: tracksH }}
            title={`Out point: ${formatTime(trimEnd)}`}
          />
          <div className="tl-playhead" style={{ left: playheadLeft + TRACK_HEADER_W, height: totalH, top: 0 }} aria-hidden="true">
            <div className="tl-playhead-head" />
          </div>
        </div>
      </div>

      {keyframesOpen && (
      <div className="tl-keyframes">
      <GraphEditor
        keyframes={inspectorKeys}
        property={property}
        effectParam={property === 'effect' ? effectParam : undefined}
        duration={selectedClip ? Math.max(0.05, selectedClip.endTime - selectedClip.startTime) : Math.max(duration, 0.05)}
        playhead={selectedClip ? currentTime - selectedClip.startTime : currentTime}
        selectedKeyframeId={selectedKeyframeId}
        onSelect={setSelectedKeyframeId}
        onChange={(keyframeId, patch, coalesceKey) => onUpdateKeyframe(selectedClip?.id ?? null, keyframeId, patch, coalesceKey)}
        onPreset={(next, handles) => {
          setEasing(next);
          if (handles) setArmedBezier(handles);
          if (!selectedKeyframeId) return;
          onUpdateKeyframe(
            selectedClip?.id ?? null,
            selectedKeyframeId,
            handles ? { easing: next, bezier: handles } : { easing: next, bezier: undefined },
          );
        }}
      />
      <KeyframeInspector
        targetLabel={selectedClip ? `Clip ${selectedClip.src.split('/').pop()}` : 'Program'}
        keyframes={inspectorKeys}
        property={property}
        effectParam={effectParam}
        easing={easing}
        selectedKeyframeId={selectedKeyframeId}
        onPropertyChange={setProperty}
        onEffectParamChange={setEffectParam}
        onEasingChange={(next) => {
          setEasing(next);
          if (next === 'bezier') setArmedBezier(DEFAULT_BEZIER);
        }}
        onSelectKeyframe={setSelectedKeyframeId}
        onAdd={addKeyframe}
        onPatch={(keyframeId, patch, coalesceKey) => onUpdateKeyframe(selectedClip?.id ?? null, keyframeId, patch, coalesceKey)}
        onRemove={(keyframeId) => onRemoveKeyframe(selectedClip?.id ?? null, keyframeId)}
      />
      </div>
      )}

      <div className="tl-inout-bar">
        <div className="trim-row">
          <label className="trim-label">In</label>
          <input type="range" min={0} max={duration} step={0.1} value={trimStart}
            onChange={(event) => onTrimStartChange(Number(event.target.value))}
            className="trim-slider" aria-label="Trim start" />
          <span className="trim-time">{formatTime(trimStart)}</span>
        </div>
        <div className="trim-row">
          <label className="trim-label">Out</label>
          <input type="range" min={0} max={duration} step={0.1} value={trimEnd}
            onChange={(event) => onTrimEndChange(Number(event.target.value))}
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
