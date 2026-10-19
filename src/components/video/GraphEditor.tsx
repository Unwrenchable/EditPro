import React, { useRef } from 'react';
import type { ClipKeyframe, EaseCurve, KeyframeProperty } from '../../types';
import { BEZIER_PRESETS, DEFAULT_BEZIER, type BezierHandles } from '../../../electron/export/easing';
import {
  bezierHandlesFromDrag,
  channelKeyframes,
  findChannel,
  sampleKeyframes,
  type KeyframePatch,
} from '../../utils/video/keyframes';

const NAMED_PRESETS: { id: EaseCurve; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease in' },
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'hold', label: 'Hold' },
];

interface GraphEditorProps {
  keyframes: readonly ClipKeyframe[];
  property: KeyframeProperty;
  effectParam?: string;
  duration: number;
  playhead: number;
  selectedKeyframeId: string | null;
  onSelect: (keyframeId: string | null) => void;
  onChange: (keyframeId: string, patch: KeyframePatch, coalesceKey?: string) => void;
  onPreset: (easing: EaseCurve, bezier?: BezierHandles) => void;
}

interface DragState {
  id: string;
  kind: 'key' | 'left' | 'right';
}

const PAD = 12;

function viewBoxPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  duration: number,
  min: number,
  max: number,
): { time: number; value: number } {
  const width = Math.max(rect.width, 1);
  const height = Math.max(rect.height, 1);
  const x = Math.min(1, Math.max(0, (clientX - rect.left - PAD) / (width - PAD * 2)));
  const y = Math.min(1, Math.max(0, (clientY - rect.top - PAD) / (height - PAD * 2)));
  const span = max - min || 1;
  return {
    time: x * duration,
    value: max - y * span,
  };
}

const GraphEditor: React.FC<GraphEditorProps> = ({
  keyframes,
  property,
  effectParam,
  duration,
  playhead,
  selectedKeyframeId,
  onSelect,
  onChange,
  onPreset,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const channel = findChannel(property, effectParam);
  const min = channel?.min ?? -2;
  const max = channel?.max ?? 2;
  const fallback = channel?.fallback ?? 0;
  const span = Math.max(duration, 0.05);
  const keys = channelKeyframes(keyframes, property, effectParam);
  const width = 320;
  const height = 148;
  const innerW = width - PAD * 2;
  const innerH = height - PAD * 2;
  const xOf = (time: number) => PAD + (Math.min(span, Math.max(0, time)) / span) * innerW;
  const yOf = (value: number) => PAD + (1 - (value - min) / (max - min || 1)) * innerH;

  const samples: string[] = [];
  const count = 48;
  for (let index = 0; index <= count; index += 1) {
    const time = (span * index) / count;
    const value = sampleKeyframes(keys, time, fallback);
    samples.push(`${index === 0 ? 'M' : 'L'}${xOf(time).toFixed(2)} ${yOf(value).toFixed(2)}`);
  }

  const selected = keys.find((keyframe) => keyframe.id === selectedKeyframeId) ?? null;
  const selectedIndex = selected ? keys.findIndex((keyframe) => keyframe.id === selected.id) : -1;
  const previous = selectedIndex > 0 ? keys[selectedIndex - 1] : null;
  const handles = selected?.bezier ?? DEFAULT_BEZIER;
  const showHandles = Boolean(selected && previous && selected.easing === 'bezier');

  const handlePoint = (which: 'left' | 'right') => {
    if (!previous || !selected) return { x: 0, y: 0 };
    const unitX = which === 'left' ? handles.x1 : handles.x2;
    const unitY = which === 'left' ? handles.y1 : handles.y2;
    const time = previous.time + unitX * (selected.time - previous.time);
    const value = previous.value + unitY * (selected.value - previous.value);
    return { x: xOf(time), y: yOf(value) };
  };

  const readPointer = (event: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return viewBoxPoint(event.clientX, event.clientY, rect, span, min, max);
  };

  const onPointerDown = (event: React.PointerEvent, drag: DragState) => {
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = drag;
    onSelect(drag.id);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = readPointer(event);
    if (!point) return;
    if (drag.kind === 'key') {
      onChange(
        drag.id,
        { time: Math.min(span, Math.max(0, point.time)), value: Math.min(max, Math.max(min, point.value)) },
        `graph:${drag.id}`,
      );
      return;
    }
    const key = keys.find((item) => item.id === drag.id);
    const index = key ? keys.findIndex((item) => item.id === key.id) : -1;
    const left = index > 0 ? keys[index - 1] : null;
    if (!key || !left) return;
    const next = bezierHandlesFromDrag(left, key, drag.kind, point.time, point.value, key.bezier ?? DEFAULT_BEZIER);
    onChange(drag.id, { easing: 'bezier', bezier: next }, `graph-bezier:${drag.id}`);
  };

  const stopDrag = () => {
    dragRef.current = null;
  };

  const leftHandle = handlePoint('left');
  const rightHandle = handlePoint('right');

  return (
    <div className="tl-graph" aria-label="Graph editor">
      <div className="tl-graph-presets">
        {NAMED_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="tl-tool-btn"
            onClick={() => onPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
        {BEZIER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="tl-tool-btn"
            aria-label={`Easing preset ${preset.label}`}
            onClick={() => onPreset('bezier', preset.handles)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="tl-graph-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Keyframe curve"
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
      >
        <rect x={0} y={0} width={width} height={height} className="tl-graph-bg" />
        {[0, 0.5, 1].map((mark) => (
          <line
            key={mark}
            x1={PAD}
            x2={width - PAD}
            y1={yOf(min + (max - min) * mark)}
            y2={yOf(min + (max - min) * mark)}
            className="tl-graph-grid"
          />
        ))}
        <path data-testid="graph-curve" d={samples.join(' ')} className="tl-graph-curve" />
        <line
          x1={xOf(playhead)}
          x2={xOf(playhead)}
          y1={PAD}
          y2={height - PAD}
          className="tl-graph-playhead"
        />
        {showHandles && previous && selected && (
          <>
            <line x1={xOf(previous.time)} y1={yOf(previous.value)} x2={leftHandle.x} y2={leftHandle.y} className="tl-graph-handle-line" />
            <line x1={xOf(selected.time)} y1={yOf(selected.value)} x2={rightHandle.x} y2={rightHandle.y} className="tl-graph-handle-line" />
            <circle
              cx={leftHandle.x}
              cy={leftHandle.y}
              r={5}
              className="tl-graph-handle"
              role="button"
              aria-label="Bezier handle left"
              onPointerDown={(event) => onPointerDown(event, { id: selected.id, kind: 'left' })}
            />
            <circle
              cx={rightHandle.x}
              cy={rightHandle.y}
              r={5}
              className="tl-graph-handle"
              role="button"
              aria-label="Bezier handle right"
              onPointerDown={(event) => onPointerDown(event, { id: selected.id, kind: 'right' })}
            />
          </>
        )}
        {keys.map((keyframe) => (
          <rect
            key={keyframe.id}
            x={xOf(keyframe.time) - 4}
            y={yOf(keyframe.value) - 4}
            width={8}
            height={8}
            className={`tl-graph-key${keyframe.id === selected?.id ? ' active' : ''}`}
            role="button"
            aria-label={`Graph keyframe ${keyframe.id}`}
            onPointerDown={(event) => onPointerDown(event, { id: keyframe.id, kind: 'key' })}
          />
        ))}
      </svg>
    </div>
  );
};

export default GraphEditor;
