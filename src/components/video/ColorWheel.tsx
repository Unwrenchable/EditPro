import React, { useRef } from 'react';
import { rgbFromWheel, shiftWheelMaster, wheelFromRgb, type RgbTriplet } from '../../utils/video/creative';

interface ColorWheelProps {
  label: string;
  rgb: RgbTriplet;
  neutral: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (rgb: RgbTriplet, coalesceKey?: string) => void;
}

const SIZE = 116;

function pointerToWheel(event: React.PointerEvent, rect: DOMRect): { angle: number; amount: number } {
  const dx = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  const dy = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;
  return {
    angle: Math.atan2(-dy, dx),
    amount: Math.min(1, Math.hypot(dx, dy)),
  };
}

const ColorWheel: React.FC<ColorWheelProps> = ({ label, rgb, neutral, min, max, disabled, onChange }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const { angle, amount } = wheelFromRgb(rgb, neutral, min, max);
  const puckX = SIZE / 2 + Math.cos(angle) * amount * (SIZE / 2 - 8);
  const puckY = SIZE / 2 - Math.sin(angle) * amount * (SIZE / 2 - 8);
  const average = (rgb.r + rgb.g + rgb.b) / 3;

  const writeFromPointer = (event: React.PointerEvent) => {
    if (disabled) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1) return;
    const next = pointerToWheel(event, rect);
    onChange(rgbFromWheel(next.angle, next.amount, neutral, min, max), `wheel:${label}`);
  };

  return (
    <div className="color-wheel">
      <svg
        ref={svgRef}
        className="color-wheel-pad"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="slider"
        aria-label={`${label} color wheel`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(amount * 100)}
        aria-disabled={disabled || undefined}
        onPointerDown={(event) => {
          if (disabled) return;
          svgRef.current?.setPointerCapture(event.pointerId);
          writeFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (disabled || !svgRef.current?.hasPointerCapture(event.pointerId)) return;
          writeFromPointer(event);
        }}
      >
        <defs>
          <radialGradient id={`${label}-wheel`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#888" />
            <stop offset="100%" stopColor="#1a1a1a" />
          </radialGradient>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2 - 2} fill={`url(#${label}-wheel)`} stroke="#333" />
        <circle cx={SIZE / 2} cy={8} r={4} fill="#e05050" />
        <circle cx={SIZE - 14} cy={SIZE * 0.72} r={4} fill="#50c878" />
        <circle cx={14} cy={SIZE * 0.72} r={4} fill="#5080e0" />
        <circle cx={puckX} cy={puckY} r={6} fill="#fff" stroke="#111" />
      </svg>
      <label className="slider-row">
        <span className="slider-label">Master</span>
        <input
          className="slider"
          type="range"
          aria-label={`${label} master`}
          min={min - neutral}
          max={max - neutral}
          step={0.01}
          disabled={disabled}
          value={average - neutral}
          onChange={(event) => {
            const target = neutral + Number(event.target.value);
            onChange(shiftWheelMaster(rgb, target - average, min, max), `wheel-master:${label}`);
          }}
        />
      </label>
    </div>
  );
};

export default ColorWheel;
