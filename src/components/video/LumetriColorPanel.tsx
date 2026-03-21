import React, { useEffect, useRef, useState } from 'react';
import type { LumetriColor, LumetriCurves, ColorWheelAdjust } from '../../types';

// ── Curve Canvas ─────────────────────────────────────────────────────────────

type CurveChannel = 'master' | 'red' | 'green' | 'blue';

const CHANNEL_COLORS: Record<CurveChannel, string> = {
  master: '#e0e0e0',
  red: '#e05555',
  green: '#55c055',
  blue: '#5580e0',
};

function renderCurve(
  canvas: HTMLCanvasElement,
  shadow: number,
  midtone: number,
  highlight: number,
  color: string
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#252525';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo((i * W) / 4, 0);
    ctx.lineTo((i * W) / 4, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, (i * H) / 4);
    ctx.lineTo(W, (i * H) / 4);
    ctx.stroke();
  }

  // Reference diagonal
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(W, 0);
  ctx.stroke();

  // Control points in [0,1] space
  const adj = (v: number) => v / 250;
  const pts: [number, number][] = [
    [0, 0],
    [0.25, Math.min(1, Math.max(0, 0.25 + adj(shadow)))],
    [0.5, Math.min(1, Math.max(0, 0.5 + adj(midtone)))],
    [0.75, Math.min(1, Math.max(0, 0.75 + adj(highlight)))],
    [1, 1],
  ];

  // Map to canvas (invert Y)
  const cx = (p: [number, number]): [number, number] => [p[0] * W, (1 - p[1]) * H];
  const cp = pts.map(cx);

  // Draw smooth curve with cubic bezier segments
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cp[0][0], cp[0][1]);
  for (let i = 0; i < cp.length - 1; i++) {
    const x1 = cp[i][0],   y1 = cp[i][1];
    const x2 = cp[i+1][0], y2 = cp[i+1][1];
    const cpx = (x2 - x1) / 3;
    ctx.bezierCurveTo(x1 + cpx, y1, x2 - cpx, y2, x2, y2);
  }
  ctx.stroke();

  // Draw control point dots (middle 3 only)
  pts.slice(1, 4).forEach((p) => {
    const [px, py] = cx(p);
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

// ── Color Wheel ──────────────────────────────────────────────────────────────

interface ColorWheelProps {
  label: string;
  wheelKey: 'shadows' | 'midtones' | 'highlights';
  value: ColorWheelAdjust;
  disabled?: boolean;
  onChange: (wheel: 'shadows' | 'midtones' | 'highlights', axis: 'x' | 'y' | 'luminance', val: number) => void;
}

const ColorWheel: React.FC<ColorWheelProps> = ({ label, wheelKey, value, disabled, onChange }) => {
  const SIZE = 88;
  const RADIUS = SIZE / 2 - 6;
  const discRef = useRef<HTMLDivElement>(null);

  const applyPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const el = discRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let dx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    let dy = -((e.clientY - rect.top) / rect.height - 0.5) * 2;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) { dx /= dist; dy /= dist; }
    onChange(wheelKey, 'x', Math.round(dx * 100) / 100);
    onChange(wheelKey, 'y', Math.round(dy * 100) / 100);
  };

  const dotX = SIZE / 2 + value.x * RADIUS;
  const dotY = SIZE / 2 - value.y * RADIUS;

  return (
    <div className="color-wheel-wrap">
      <span className="color-wheel-title">{label}</span>
      <div
        ref={discRef}
        className={`color-wheel-disc${disabled ? ' disabled' : ''}`}
        style={{ width: SIZE, height: SIZE }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); applyPointer(e); }}
        onPointerMove={(e) => { if (e.buttons & 1) applyPointer(e); }}
        onDoubleClick={() => { if (!disabled) { onChange(wheelKey, 'x', 0); onChange(wheelKey, 'y', 0); } }}
        role="slider"
        aria-label={`${label} color wheel`}
        title="Click to adjust hue/saturation · Double-click to reset"
      >
        {/* Conic-gradient background via CSS class */}
        <div className="color-wheel-center-fade" />
        {/* Indicator dot */}
        <div
          className="color-wheel-dot"
          style={{ left: dotX - 5, top: dotY - 5, opacity: (value.x !== 0 || value.y !== 0) ? 1 : 0.5 }}
        />
      </div>
      <div className="slider-row" style={{ marginTop: 4 }}>
        <div className="slider-header">
          <span className="slider-label">Luma</span>
          <span className="slider-value">{value.luminance > 0 ? `+${value.luminance}` : value.luminance}</span>
        </div>
        <input
          type="range" min={-100} max={100} value={value.luminance}
          onChange={(e) => onChange(wheelKey, 'luminance', Number(e.target.value))}
          className="slider" disabled={disabled}
          aria-label={`${label} luminance`}
        />
      </div>
    </div>
  );
};

// ── Slider Row ────────────────────────────────────────────────────────────────

interface SliderRowProps {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; disabled?: boolean;
  displayValue?: string;
}
const SliderRow: React.FC<SliderRowProps> = ({ label, value, min, max, step = 1, onChange, disabled, displayValue }) => (
  <div className="slider-row">
    <div className="slider-header">
      <span className="slider-label">{label}</span>
      <span className="slider-value">{displayValue ?? (value > 0 ? `+${value}` : value)}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="slider" aria-label={label} disabled={disabled} />
  </div>
);

// ── Curves Tab ────────────────────────────────────────────────────────────────

interface CurvesTabProps {
  curves: LumetriCurves;
  disabled: boolean;
  onChange: (key: keyof LumetriCurves, value: number) => void;
}

const CurvesTab: React.FC<CurvesTabProps> = ({ curves, disabled, onChange }) => {
  const [channel, setChannel] = useState<CurveChannel>('master');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const channelKeys = {
    master: ['masterShadow', 'masterMidtone', 'masterHighlight'],
    red:    ['redShadow',    'redMidtone',    'redHighlight'],
    green:  ['greenShadow',  'greenMidtone',  'greenHighlight'],
    blue:   ['blueShadow',   'blueMidtone',   'blueHighlight'],
  } as const;

  const [shadowKey, midKey, highKey] = channelKeys[channel];
  const shadow    = curves[shadowKey];
  const midtone   = curves[midKey];
  const highlight = curves[highKey];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderCurve(canvas, shadow, midtone, highlight, CHANNEL_COLORS[channel]);
  }, [shadow, midtone, highlight, channel]);

  return (
    <div>
      {/* Channel selector */}
      <div className="curve-channel-btns">
        {(['master', 'red', 'green', 'blue'] as CurveChannel[]).map((ch) => (
          <button
            key={ch}
            className={`curve-ch-btn curve-ch-${ch}${channel === ch ? ' active' : ''}`}
            onClick={() => setChannel(ch)}
            title={ch.charAt(0).toUpperCase() + ch.slice(1)}
          >
            {ch === 'master' ? '●' : ch[0].toUpperCase()}
          </button>
        ))}
      </div>
      {/* Canvas */}
      <div className="curve-canvas-wrap">
        <canvas ref={canvasRef} width={160} height={160} className="curve-canvas" />
      </div>
      {/* Sliders */}
      <SliderRow label="Shadows"    value={shadow}    min={-100} max={100} onChange={(v) => onChange(shadowKey, v)} disabled={disabled} />
      <SliderRow label="Midtones"   value={midtone}   min={-100} max={100} onChange={(v) => onChange(midKey, v)}    disabled={disabled} />
      <SliderRow label="Highlights" value={highlight} min={-100} max={100} onChange={(v) => onChange(highKey, v)}  disabled={disabled} />
    </div>
  );
};

// ── Main LumetriColorPanel ────────────────────────────────────────────────────

type LumetriTab = 'basic' | 'curves' | 'wheels';

interface LumetriColorPanelProps {
  lumetri: LumetriColor;
  disabled: boolean;
  onBasicChange: (key: keyof Omit<LumetriColor, 'curves' | 'wheels'>, value: number) => void;
  onCurvesChange: (key: keyof LumetriCurves, value: number) => void;
  onColorWheelChange: (wheel: 'shadows' | 'midtones' | 'highlights', axis: 'x' | 'y' | 'luminance', value: number) => void;
  onReset: () => void;
}

const LumetriColorPanel: React.FC<LumetriColorPanelProps> = ({
  lumetri, disabled, onBasicChange, onCurvesChange, onColorWheelChange, onReset,
}) => {
  const [tab, setTab] = useState<LumetriTab>('basic');

  return (
    <div className="lumetri-panel">
      <div className="lumetri-tabs">
        {(['basic', 'curves', 'wheels'] as LumetriTab[]).map((t) => (
          <button
            key={t}
            className={`lumetri-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'basic' && (
        <div className="panel-body">
          <p className="section-subtitle">Tone</p>
          <SliderRow label="Exposure"   value={lumetri.exposure}   min={-5}   max={5}   step={0.1} onChange={(v) => onBasicChange('exposure', v)}   disabled={disabled} displayValue={lumetri.exposure.toFixed(1)} />
          <SliderRow label="Contrast"   value={lumetri.contrast}   min={-100} max={100} onChange={(v) => onBasicChange('contrast', v)}   disabled={disabled} />
          <SliderRow label="Highlights" value={lumetri.highlights} min={-100} max={100} onChange={(v) => onBasicChange('highlights', v)} disabled={disabled} />
          <SliderRow label="Shadows"    value={lumetri.shadows}    min={-100} max={100} onChange={(v) => onBasicChange('shadows', v)}    disabled={disabled} />
          <SliderRow label="Whites"     value={lumetri.whites}     min={-100} max={100} onChange={(v) => onBasicChange('whites', v)}     disabled={disabled} />
          <SliderRow label="Blacks"     value={lumetri.blacks}     min={-100} max={100} onChange={(v) => onBasicChange('blacks', v)}     disabled={disabled} />
          <p className="section-subtitle" style={{ marginTop: 12 }}>White Balance</p>
          <SliderRow label="Temperature" value={lumetri.temperature} min={-100} max={100} onChange={(v) => onBasicChange('temperature', v)} disabled={disabled} />
          <SliderRow label="Tint"         value={lumetri.tint}        min={-100} max={100} onChange={(v) => onBasicChange('tint', v)}        disabled={disabled} />
          <p className="section-subtitle" style={{ marginTop: 12 }}>Creative</p>
          <SliderRow label="Saturation" value={lumetri.saturation} min={-100} max={100} onChange={(v) => onBasicChange('saturation', v)} disabled={disabled} />
          <SliderRow label="Vibrance"   value={lumetri.vibrance}   min={-100} max={100} onChange={(v) => onBasicChange('vibrance', v)}   disabled={disabled} />
        </div>
      )}

      {tab === 'curves' && (
        <div className="panel-body">
          <CurvesTab curves={lumetri.curves} disabled={disabled} onChange={onCurvesChange} />
        </div>
      )}

      {tab === 'wheels' && (
        <div className="panel-body">
          <p className="section-subtitle">Three-Way Color Corrector</p>
          <div className="color-wheels-row">
            <ColorWheel label="Shadows"    wheelKey="shadows"    value={lumetri.wheels.shadows}    disabled={disabled} onChange={onColorWheelChange} />
            <ColorWheel label="Midtones"   wheelKey="midtones"   value={lumetri.wheels.midtones}   disabled={disabled} onChange={onColorWheelChange} />
            <ColorWheel label="Highlights" wheelKey="highlights" value={lumetri.wheels.highlights} disabled={disabled} onChange={onColorWheelChange} />
          </div>
        </div>
      )}

      <div className="panel-footer">
        <button className="reset-btn" onClick={onReset} disabled={disabled}>
          ↺ Reset Lumetri
        </button>
      </div>
    </div>
  );
};

export default LumetriColorPanel;
