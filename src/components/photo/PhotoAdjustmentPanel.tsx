import React, { useState } from 'react';
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
  disabled?: boolean;
}

const SliderRow: React.FC<SliderRowProps> = ({ label, value, min, max, onChange, disabled }) => (
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
      disabled={disabled}
    />
  </div>
);

type PanelSection = 'filters' | 'light' | 'color' | 'detail' | 'effects' | 'transform';

const SECTIONS: { id: PanelSection; label: string; icon: string }[] = [
  { id: 'filters', label: 'Presets', icon: '✦' },
  { id: 'light', label: 'Light', icon: '☀' },
  { id: 'color', label: 'Color', icon: '🎨' },
  { id: 'detail', label: 'Detail', icon: '🔍' },
  { id: 'effects', label: 'Effects', icon: '✨' },
  { id: 'transform', label: 'Transform', icon: '↻' },
];

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
  const [activeSection, setActiveSection] = useState<PanelSection>('light');

  return (
    <aside className="right-panel">
      {/* Section tabs */}
      <div className="panel-tabs">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`panel-tab ${activeSection === s.id ? 'active' : ''}`}
            onClick={() => setActiveSection(s.id)}
            title={s.label}
            disabled={disabled && s.id !== 'filters'}
          >
            <span className="panel-tab-icon">{s.icon}</span>
            <span className="panel-tab-label">{s.label}</span>
          </button>
        ))}
      </div>

      {/* Presets */}
      {activeSection === 'filters' && (
        <div className="panel-body">
          <div className="filter-grid">
            {PHOTO_FILTERS.map((f) => (
              <button
                key={f.name}
                className={`filter-btn ${filter === f.name ? 'active' : ''}`}
                onClick={() => onFilterChange(f.name)}
                disabled={disabled}
                aria-pressed={filter === f.name}
              >
                <span
                  className="filter-preview"
                  style={{ filter: f.css || undefined }}
                />
                <span className="filter-label">{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Light */}
      {activeSection === 'light' && (
        <div className="panel-body">
          <SliderRow label="Exposure" value={adjustments.exposure} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('exposure', v)} disabled={disabled} />
          <SliderRow label="Brightness" value={adjustments.brightness} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('brightness', v)} disabled={disabled} />
          <SliderRow label="Contrast" value={adjustments.contrast} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('contrast', v)} disabled={disabled} />
          <SliderRow label="Highlights" value={adjustments.highlights} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('highlights', v)} disabled={disabled} />
          <SliderRow label="Shadows" value={adjustments.shadows} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('shadows', v)} disabled={disabled} />
          <SliderRow label="Whites" value={adjustments.whites ?? 0} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('whites' as keyof PhotoAdjustments, v)} disabled={disabled} />
          <SliderRow label="Blacks" value={adjustments.blacks ?? 0} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('blacks' as keyof PhotoAdjustments, v)} disabled={disabled} />
        </div>
      )}

      {/* Color */}
      {activeSection === 'color' && (
        <div className="panel-body">
          <SliderRow label="Saturation" value={adjustments.saturation} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('saturation', v)} disabled={disabled} />
          <SliderRow label="Vibrance" value={adjustments.vibrance ?? 0} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('vibrance' as keyof PhotoAdjustments, v)} disabled={disabled} />
          <SliderRow label="Temperature" value={adjustments.temperature} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('temperature', v)} disabled={disabled} />
          <SliderRow label="Tint" value={adjustments.tint} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('tint', v)} disabled={disabled} />
          <SliderRow label="Hue" value={adjustments.hue ?? 0} min={-180} max={180}
            onChange={(v) => onAdjustmentChange('hue' as keyof PhotoAdjustments, v)} disabled={disabled} />
        </div>
      )}

      {/* Detail */}
      {activeSection === 'detail' && (
        <div className="panel-body">
          <SliderRow label="Sharpness" value={adjustments.sharpness} min={0} max={100}
            onChange={(v) => onAdjustmentChange('sharpness', v)} disabled={disabled} />
          <SliderRow label="Noise Reduction" value={adjustments.noiseReduction ?? 0} min={0} max={100}
            onChange={(v) => onAdjustmentChange('noiseReduction' as keyof PhotoAdjustments, v)} disabled={disabled} />
          <SliderRow label="Clarity" value={adjustments.clarity ?? 0} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('clarity' as keyof PhotoAdjustments, v)} disabled={disabled} />
          <SliderRow label="Texture" value={adjustments.texture ?? 0} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('texture' as keyof PhotoAdjustments, v)} disabled={disabled} />
          <SliderRow label="Dehaze" value={adjustments.dehaze ?? 0} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('dehaze' as keyof PhotoAdjustments, v)} disabled={disabled} />
        </div>
      )}

      {/* Effects */}
      {activeSection === 'effects' && (
        <div className="panel-body">
          <SliderRow label="Vignette" value={adjustments.vignette ?? 0} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('vignette' as keyof PhotoAdjustments, v)} disabled={disabled} />
          <SliderRow label="Grain" value={adjustments.grain ?? 0} min={0} max={100}
            onChange={(v) => onAdjustmentChange('grain' as keyof PhotoAdjustments, v)} disabled={disabled} />
          <SliderRow label="Fade" value={adjustments.fade ?? 0} min={0} max={100}
            onChange={(v) => onAdjustmentChange('fade' as keyof PhotoAdjustments, v)} disabled={disabled} />
        </div>
      )}

      {/* Transform */}
      {activeSection === 'transform' && (
        <div className="panel-body">
          <p className="section-subtitle">Rotation</p>
          <div className="transform-buttons">
            <button className="transform-btn" onClick={() => onRotate(-90)}
              disabled={disabled} title="Rotate left 90°">↺ 90°</button>
            <button className="transform-btn" onClick={() => onRotate(90)}
              disabled={disabled} title="Rotate right 90°">↻ 90°</button>
          </div>
          <p className="section-subtitle" style={{ marginTop: 12 }}>Flip</p>
          <div className="transform-buttons">
            <button className="transform-btn" onClick={() => onFlip('horizontal')}
              disabled={disabled} title="Flip horizontal">↔ Horizontal</button>
            <button className="transform-btn" onClick={() => onFlip('vertical')}
              disabled={disabled} title="Flip vertical">↕ Vertical</button>
          </div>
        </div>
      )}

      {/* Reset footer */}
      <div className="panel-footer">
        <button className="reset-btn" onClick={onReset} disabled={disabled}>
          ↺ Reset All
        </button>
      </div>
    </aside>
  );
};

export default PhotoAdjustmentPanel;
