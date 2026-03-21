import React from 'react';

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

interface VideoAdjustmentPanelProps {
  brightness: number;
  contrast: number;
  saturation: number;
  onAdjustmentChange: (key: 'brightness' | 'contrast' | 'saturation', value: number) => void;
  onOpenVideo: () => void;
  videoUrl: string | null;
}

const VideoAdjustmentPanel: React.FC<VideoAdjustmentPanelProps> = ({
  brightness,
  contrast,
  saturation,
  onAdjustmentChange,
  onOpenVideo,
  videoUrl,
}) => {
  const disabled = !videoUrl;

  return (
    <aside className="right-panel">
      <div className="panel-section">
        <h3 className="section-title">Color Grading</h3>
        <SliderRow
          label="Brightness"
          value={brightness}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('brightness', v)}
        />
        <SliderRow
          label="Contrast"
          value={contrast}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('contrast', v)}
        />
        <SliderRow
          label="Saturation"
          value={saturation}
          min={-100}
          max={100}
          onChange={(v) => onAdjustmentChange('saturation', v)}
        />
      </div>

      <div className="panel-section">
        <h3 className="section-title">File</h3>
        <button className="reset-btn" onClick={onOpenVideo}>
          Open Video
        </button>
        {disabled && (
          <p className="panel-hint">Load a video file to begin editing</p>
        )}
      </div>
    </aside>
  );
};

export default VideoAdjustmentPanel;
