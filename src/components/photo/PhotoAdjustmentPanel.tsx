import React from 'react';
import type { PhotoAdjustments, PhotoFilterName } from '../../types';
import { PHOTO_FILTERS } from '../../utils/imageFilters';

interface PhotoAdjustmentPanelProps {
  adjustments: PhotoAdjustments;
  filter: PhotoFilterName;
  rotation: number;
  onAdjustmentChange: <K extends keyof PhotoAdjustments>(key: K, value: number) => void;
  onFilterChange: (filter: PhotoFilterName) => void;
  onRotate: (degrees: number) => void;
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  onReset: () => void;
  imageUrl: string | null;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({ label, value, min, max, onChange }) => (
  <div className="slider-row">
    <div className="slider-header">
      <span className="slider-label">{label}</span>
      <span className="slider-value">{value > 0 ? `+${value}` : value}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="slider"
      aria-label={label}
    />
  </div>
);

const PhotoAdjustmentPanel: React.FC<PhotoAdjustmentPanelProps> = ({
  adjustments,
  filter,
  onAdjustmentChange,
  onFilterChange,
  onRotate,
  onFlip,
  onReset,
  imageUrl,
}) => {
  const disabled = !imageUrl;

  return (
    <aside className="right-panel">
      <div className="panel-section">
        <h3 className="section-title">Filters</h3>
        <div className="filter-grid">
          {PHOTO_FILTERS.map((f) => (
            <button
              key={f.name}
              className={`filter-btn ${filter === f.name ? 'active' : ''}`}
              onClick={() => onFilterChange(f.name)}
              disabled={disabled}
              aria-pressed={filter === f.name}
            >
              <span className="filter-preview" style={{ filter: f.css || undefined }} />
              <span className="filter-label">{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <h3 className="section-title">Adjustments</h3>
        <SliderRow
          label="Brightness"
          value={adjustments.brightness}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('brightness', v)}
        />
        <SliderRow
          label="Contrast"
          value={adjustments.contrast}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('contrast', v)}
        />
        <SliderRow
          label="Saturation"
          value={adjustments.saturation}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('saturation', v)}
        />
        <SliderRow
          label="Exposure"
          value={adjustments.exposure}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('exposure', v)}
        />
        <SliderRow
          label="Highlights"
          value={adjustments.highlights}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('highlights', v)}
        />
        <SliderRow
          label="Shadows"
          value={adjustments.shadows}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('shadows', v)}
        />
        <SliderRow
          label="Sharpness"
          value={adjustments.sharpness}
          min={0}
          max={100}
          onChange={(v) => onAdjustmentChange('sharpness', v)}
        />
        <SliderRow
          label="Temperature"
          value={adjustments.temperature}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('temperature', v)}
        />
        <SliderRow
          label="Tint"
          value={adjustments.tint}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('tint', v)}
        />
      </div>

      <div className="panel-section">
        <h3 className="section-title">Transform</h3>
        <div className="transform-buttons">
          <button
            className="transform-btn"
            onClick={() => onRotate(-90)}
            disabled={disabled}
            title="Rotate left 90°"
          >
            ↺ 90°
          </button>
          <button
            className="transform-btn"
            onClick={() => onRotate(90)}
            disabled={disabled}
            title="Rotate right 90°"
          >
            ↻ 90°
          </button>
          <button
            className="transform-btn"
            onClick={() => onFlip('horizontal')}
            disabled={disabled}
            title="Flip horizontal"
          >
            ↔ Flip H
          </button>
          <button
            className="transform-btn"
            onClick={() => onFlip('vertical')}
            disabled={disabled}
            title="Flip vertical"
          >
            ↕ Flip V
          </button>
        </div>
      </div>

      <div className="panel-section">
        <button className="reset-btn" onClick={onReset} disabled={disabled}>
          ↺ Reset All
        </button>
      </div>
    </aside>
  );
};

export default PhotoAdjustmentPanel;
