import React, { useCallback } from 'react';
import { formatTime } from '../../utils/videoUtils';
import type { TimelineClip as TimelineClipType, TimelineTool } from '../../types';
import { snapSpan, snapTime } from '../../utils/video/timelineEdit';

interface TimelineClipProps {
  clip: TimelineClipType;
  pixelsPerSecond: number;
  trackHeight: number;
  isSelected: boolean;
  linked: boolean;
  tool: TimelineTool;
  snapping: boolean;
  snapPoints: readonly number[];
  selectedKeyframeId: string | null;
  onSelect: (clipId: string) => void;
  onDoubleClick: (clipId: string) => void;
  onRippleDelete: (clipId: string) => void;
  onRazor: (clipId: string, time: number) => void;
  onMove: (clipId: string, trackId: string, startTime: number, coalesceKey: string) => void;
  onTrim: (clipId: string, edge: 'in' | 'out', time: number, coalesceKey: string) => void;
  onRippleTrim: (clipId: string, edge: 'in' | 'out', value: number, coalesceKey: string) => void;
  onRoll: (clipId: string, edge: 'in' | 'out', time: number, coalesceKey: string) => void;
  onSlip: (clipId: string, newInPoint: number, coalesceKey: string) => void;
  onSlide: (clipId: string, newStart: number, coalesceKey: string) => void;
  onSelectKeyframe: (clipId: string, keyframeId: string) => void;
  onMoveKeyframe: (clipId: string, keyframeId: string, time: number, coalesceKey: string) => void;
}

function dragSeconds(originX: number, clientX: number, pixelsPerSecond: number): number {
  return (clientX - originX) / pixelsPerSecond;
}

const TimelineClipComponent: React.FC<TimelineClipProps> = ({
  clip,
  pixelsPerSecond,
  trackHeight,
  isSelected,
  linked,
  tool,
  snapping,
  snapPoints,
  selectedKeyframeId,
  onSelect,
  onDoubleClick,
  onRippleDelete,
  onRazor,
  onMove,
  onTrim,
  onRippleTrim,
  onRoll,
  onSlip,
  onSlide,
  onSelectKeyframe,
  onMoveKeyframe,
}) => {
  const left = clip.startTime * pixelsPerSecond;
  const duration = Math.max(0, clip.endTime - clip.startTime);
  const width = Math.max(2, duration * pixelsPerSecond);
  const label = clip.src.split('/').pop() ?? clip.id;
  const durationLabel = formatTime(clip.outPoint - clip.inPoint);
  const threshold = 8 / Math.max(pixelsPerSecond, 1);

  const listen = useCallback((event: React.MouseEvent, apply: (delta: number, clientX: number, clientY: number) => void) => {
    event.stopPropagation();
    event.preventDefault();
    const originX = event.clientX;
    const move = (ev: MouseEvent) => apply(dragSeconds(originX, ev.clientX, pixelsPerSecond), ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [pixelsPerSecond]);

  const handleBodyMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect(clip.id);
    const time = clip.startTime + dragSeconds(event.currentTarget.getBoundingClientRect().left, event.clientX, pixelsPerSecond);
    if (tool === 'razor') {
      onRazor(clip.id, Math.min(clip.endTime - 0.05, Math.max(clip.startTime + 0.05, time)));
      return;
    }
    if (tool === 'slip') {
      const origin = clip.inPoint;
      listen(event, (delta) => onSlip(clip.id, Math.max(0, origin + delta), `slip:${clip.id}`));
      return;
    }
    if (tool === 'slide') {
      const origin = clip.startTime;
      listen(event, (delta) => {
        const raw = Math.max(0, origin + delta);
        onSlide(clip.id, snapSpan(raw, duration, snapPoints, threshold, snapping), `slide:${clip.id}`);
      });
      return;
    }
    if (tool === 'select') {
      const origin = clip.startTime;
      listen(event, (delta, clientX, clientY) => {
        const raw = Math.max(0, origin + delta);
        const start = snapSpan(raw, duration, snapPoints, threshold, snapping);
        const hit = document.elementFromPoint(clientX, clientY)?.closest('[data-track-id]');
        const trackId = hit?.getAttribute('data-track-id') ?? clip.trackId;
        onMove(clip.id, trackId, start, `move:${clip.id}`);
      });
    }
  };

  const handleEdgeMouseDown = (edge: 'in' | 'out') => (event: React.MouseEvent) => {
    if (tool === 'razor' || tool === 'slip' || tool === 'slide') return;
    const originEdge = edge === 'in' ? clip.startTime : clip.endTime;
    const originIn = clip.inPoint;
    listen(event, (delta) => {
      const raw = Math.max(0, originEdge + delta);
      const snapped = snapTime(raw, snapPoints, threshold, snapping);
      const key = `${tool}:${clip.id}:${edge}`;
      if (tool === 'ripple') {
        onRippleTrim(clip.id, edge, edge === 'in' ? Math.max(0, originIn + delta) : snapped, key);
        return;
      }
      if (tool === 'roll') {
        onRoll(clip.id, edge, snapped, key);
        return;
      }
      onTrim(clip.id, edge, snapped, key);
    });
  };

  return (
    <div
      className={`tl-clip${isSelected ? ' tl-clip-selected' : ''}${linked ? ' tl-clip-linked' : ''}`}
      style={{ left, width, height: trackHeight - 4 }}
      title={`${label} (${durationLabel})${linked ? ' — linked' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Clip ${label}, duration ${durationLabel}${linked ? ', linked' : ''}`}
      aria-pressed={isSelected}
      onMouseDown={handleBodyMouseDown}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (event.shiftKey) onRippleDelete(clip.id);
        else onDoubleClick(clip.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(clip.id);
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          if (event.shiftKey) onRippleDelete(clip.id);
          else onDoubleClick(clip.id);
        }
      }}
    >
      <span className={`tl-clip-edge tl-clip-edge-in`} onMouseDown={handleEdgeMouseDown('in')} />
      <span className="tl-clip-label">
        {linked ? '⚭ ' : ''}
        {label}
      </span>
      <span className={`tl-clip-edge tl-clip-edge-out`} onMouseDown={handleEdgeMouseDown('out')} />
      {(clip.keyframes ?? []).map((keyframe) => (
        <span
          key={keyframe.id}
          className={`tl-keyframe tl-keyframe-${keyframe.property}${selectedKeyframeId === keyframe.id ? ' active' : ''}`}
          style={{ left: duration <= 0 ? 0 : `${(keyframe.time / duration) * 100}%` }}
          title={`${keyframe.property} ${keyframe.value}`}
          onMouseDown={(event) => {
            const origin = keyframe.time;
            onSelectKeyframe(clip.id, keyframe.id);
            listen(event, (delta) => {
              const next = Math.min(duration, Math.max(0, origin + delta));
              onMoveKeyframe(clip.id, keyframe.id, snapTime(next, snapPoints.map((point) => point - clip.startTime), threshold, snapping), `kf:${keyframe.id}`);
            });
          }}
        />
      ))}
    </div>
  );
};

export default TimelineClipComponent;
