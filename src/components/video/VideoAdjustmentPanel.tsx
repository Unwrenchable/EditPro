import React, { useState } from 'react';

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

type VideoPanel = 'color' | 'audio' | 'effects' | 'file';

interface VideoAdjustmentPanelProps {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  highlights: number;
  shadows: number;
  onAdjustmentChange: (
    key: 'brightness' | 'contrast' | 'saturation' | 'temperature' | 'highlights' | 'shadows',
    value: number
  ) => void;
  onOpenVideo: () => void;
  videoUrl: string | null;
}

const VideoAdjustmentPanel: React.FC<VideoAdjustmentPanelProps> = ({
  brightness,
  contrast,
  saturation,
  temperature,
  highlights,
  shadows,
  onAdjustmentChange,
  onOpenVideo,
  videoUrl,
}) => {
  const disabled = !videoUrl;
  const [activePanel, setActivePanel] = useState<VideoPanel>('color');

  const PANELS: { id: VideoPanel; label: string; icon: string }[] = [
    { id: 'color', label: 'Color', icon: '🎨' },
    { id: 'audio', label: 'Audio', icon: '🔊' },
    { id: 'effects', label: 'Effects', icon: '✨' },
    { id: 'file', label: 'File', icon: '📁' },
  ];

  return (
    <aside className="right-panel">
      <div className="panel-tabs">
        {PANELS.map((p) => (
          <button
            key={p.id}
            className={`panel-tab ${activePanel === p.id ? 'active' : ''}`}
            onClick={() => setActivePanel(p.id)}
            title={p.label}
          >
            <span className="panel-tab-icon">{p.icon}</span>
            <span className="panel-tab-label">{p.label}</span>
          </button>
        ))}
      </div>

      {activePanel === 'color' && (
        <div className="panel-body">
          <p className="section-subtitle">Color Grading</p>
          <SliderRow label="Brightness" value={brightness} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('brightness', v)} disabled={disabled} />
          <SliderRow label="Contrast" value={contrast} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('contrast', v)} disabled={disabled} />
          <SliderRow label="Saturation" value={saturation} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('saturation', v)} disabled={disabled} />
          <SliderRow label="Highlights" value={highlights} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('highlights', v)} disabled={disabled} />
          <SliderRow label="Shadows" value={shadows} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('shadows', v)} disabled={disabled} />
          <SliderRow label="Temperature" value={temperature} min={-100} max={100}
            onChange={(v) => onAdjustmentChange('temperature', v)} disabled={disabled} />
        </div>
      )}

      {activePanel === 'audio' && (
        <div className="panel-body">
          <p className="section-subtitle">Audio</p>
          <div className="info-box">
            <p>🎚 Audio mixer, equalization, and noise reduction are available in the
            timeline panel below the video preview.</p>
          </div>
          <p className="section-subtitle" style={{ marginTop: 12 }}>Tracks</p>
          <div className="track-list">
            <div className="track-item">
              <span className="track-icon">🎵</span>
              <span className="track-label">Video Audio</span>
              <span className="track-badge">Main</span>
            </div>
          </div>
        </div>
      )}

      {activePanel === 'effects' && (
        <div className="panel-body">
          <p className="section-subtitle">Transitions</p>
          <div className="effects-grid">
            {['Cut', 'Fade', 'Dissolve', 'Wipe', 'Slide', 'Zoom'].map((t) => (
              <button key={t} className="effect-btn" disabled={disabled}>{t}</button>
            ))}
          </div>
          <p className="section-subtitle" style={{ marginTop: 12 }}>Speed</p>
          <div className="info-box">
            <p>Use the Speed control in the playback bar to apply speed ramping.</p>
          </div>
        </div>
      )}

      {activePanel === 'file' && (
        <div className="panel-body">
          <button className="reset-btn" onClick={onOpenVideo}>
            📁 Open Video
          </button>
          {disabled && (
            <p className="panel-hint">Load a video file to begin editing</p>
          )}
          <div className="info-box" style={{ marginTop: 12 }}>
            <p><strong>Supported formats:</strong><br />
            MP4, WebM, MOV, AVI, MKV, M4V, FLV, WMV</p>
          </div>
        </div>
      )}

      <div className="panel-footer">
        <button className="reset-btn" onClick={() => {
          (['brightness', 'contrast', 'saturation', 'temperature', 'highlights', 'shadows'] as const)
            .forEach((k) => onAdjustmentChange(k, 0));
        }} disabled={disabled}>
          ↺ Reset Color
        </button>
      </div>
    </aside>
  );
};

export default VideoAdjustmentPanel;
