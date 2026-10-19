import React, { useState } from 'react';
import {
  createIdentityCurves,
  sampleCurve,
  type CurveChannel,
  type CurvePoint,
  type RgbCurves,
} from '../../utils/video/creative';

interface CurveEditorProps {
  curves: RgbCurves;
  disabled?: boolean;
  onChange: (curves: RgbCurves, coalesceKey?: string) => void;
}

const CHANNELS: { id: CurveChannel; label: string }[] = [
  { id: 'luma', label: 'Luma' },
  { id: 'red', label: 'Red' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
];

const WIDTH = 220;
const HEIGHT = 140;
const PAD = 8;

function sorted(points: readonly CurvePoint[]): CurvePoint[] {
  return [...points].sort((a, b) => a.x - b.x);
}

const CurveEditor: React.FC<CurveEditorProps> = ({ curves, disabled, onChange }) => {
  const [channel, setChannel] = useState<CurveChannel>('luma');
  const [selected, setSelected] = useState(0);
  const points = sorted(curves[channel]);
  const index = Math.min(selected, points.length - 1);
  const current = points[index] ?? points[0];

  const write = (next: CurvePoint[], coalesceKey?: string) => {
    onChange({ ...curves, [channel]: sorted(next) }, coalesceKey);
  };

  const xOf = (x: number) => PAD + x * (WIDTH - PAD * 2);
  const yOf = (y: number) => PAD + (1 - y) * (HEIGHT - PAD * 2);

  const path = points.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${xOf(point.x).toFixed(1)} ${yOf(point.y).toFixed(1)}`).join(' ');

  return (
    <div className="curve-editor" aria-label="RGB curves">
      <div className="tl-graph-presets" role="tablist" aria-label="Curve channel">
        {CHANNELS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={channel === item.id}
            className={`tl-tool-btn${channel === item.id ? ' active' : ''}`}
            onClick={() => { setChannel(item.id); setSelected(0); }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <svg className="curve-editor-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${channel} curve`}>
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="tl-graph-bg" />
        <line x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={PAD} className="tl-graph-grid" />
        <path d={path} className={`curve-editor-line curve-${channel}`} />
        {points.map((point, pointIndex) => (
          <circle
            key={`${point.x}-${pointIndex}`}
            cx={xOf(point.x)}
            cy={yOf(point.y)}
            r={pointIndex === index ? 5 : 3.5}
            className="tl-graph-key"
            role="button"
            aria-label={`${channel} curve point ${pointIndex + 1}`}
            onClick={() => setSelected(pointIndex)}
          />
        ))}
      </svg>
      <label className="slider-row">
        <span className="slider-label">Point {index + 1}</span>
        <input
          className="slider"
          type="range"
          aria-label="Curve point"
          min={0}
          max={1}
          step={0.01}
          disabled={disabled || !current}
          value={current?.y ?? 0}
          onChange={(event) => {
            const next = points.slice();
            next[index] = { ...next[index], y: Number(event.target.value) };
            write(next, `curve:${channel}:${index}`);
          }}
        />
      </label>
      <div className="tl-kf-row">
        <button
          type="button"
          className="tl-tool-btn"
          disabled={disabled || points.length >= 8}
          onClick={() => {
            const x = 0.5;
            const without = points.filter((point) => Math.abs(point.x - x) > 0.02);
            const next = [...without, { x, y: sampleCurve(points, x) }];
            setSelected(sorted(next).findIndex((point) => Math.abs(point.x - x) < 0.001));
            write(next);
          }}
        >
          Add point
        </button>
        <button
          type="button"
          className="tl-tool-btn"
          disabled={disabled || points.length <= 2 || index === 0 || index === points.length - 1}
          onClick={() => {
            write(points.filter((_, pointIndex) => pointIndex !== index));
            setSelected(Math.max(0, index - 1));
          }}
        >
          Remove point
        </button>
        <button
          type="button"
          className="tl-tool-btn"
          disabled={disabled}
          onClick={() => onChange(createIdentityCurves())}
        >
          Reset curves
        </button>
      </div>
    </div>
  );
};

export default CurveEditor;
