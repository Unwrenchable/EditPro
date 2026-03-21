import React, { useState } from 'react';
import LumetriColorPanel from './LumetriColorPanel';
import EssentialSoundPanel from './EssentialSoundPanel';
import type {
  LumetriColor, LumetriCurves, AudioTrackSettings, AudioCategory,
  AutoReframeAspect, VideoExportOptions,
} from '../../types';

type MainPanel = 'lumetri' | 'sound' | 'effects' | 'ai' | 'export';

const MAIN_PANELS: { id: MainPanel; label: string; icon: string }[] = [
  { id: 'lumetri',  label: 'Color',   icon: '🎨' },
  { id: 'sound',    label: 'Sound',   icon: '🎙' },
  { id: 'effects',  label: 'Effects', icon: '✨' },
  { id: 'ai',       label: 'AI',      icon: '🤖' },
  { id: 'export',   label: 'Export',  icon: '📤' },
];

const EXPORT_PLATFORMS: { id: VideoExportOptions['platform']; label: string; res: VideoExportOptions['resolution']; fps: 24|30|60; format: VideoExportOptions['format'] }[] = [
  { id: 'youtube',  label: 'YouTube 1080p',   res: '1080p', fps: 30, format: 'mp4'  },
  { id: 'tiktok',   label: 'TikTok / Reels',  res: '1080p', fps: 30, format: 'mp4'  },
  { id: 'vimeo',    label: 'Vimeo HD',         res: '1080p', fps: 24, format: 'mp4'  },
  { id: 'twitter',  label: 'Twitter / X',      res: '720p',  fps: 30, format: 'mp4'  },
  { id: 'custom',   label: 'Custom',           res: '1080p', fps: 30, format: 'mp4'  },
];

const TRANSITIONS = ['Cut', 'Fade', 'Dissolve', 'Cross-Fade', 'Wipe', 'Slide', 'Zoom', 'Dip to Black'];

const AUTO_REFRAME_ASPECTS: { value: AutoReframeAspect; label: string }[] = [
  { value: 'original', label: '16:9 Original' },
  { value: '9:16',     label: '9:16 Vertical' },
  { value: '1:1',      label: '1:1 Square'    },
  { value: '4:5',      label: '4:5 Portrait'  },
  { value: '4:3',      label: '4:3 Classic'   },
];

interface VideoAdjustmentPanelProps {
  lumetri: LumetriColor;
  audio: AudioTrackSettings;
  autoReframe: AutoReframeAspect;
  videoUrl: string | null;
  onLumetriBasicChange: (key: keyof Omit<LumetriColor, 'curves' | 'wheels'>, value: number) => void;
  onCurvesChange: (key: keyof LumetriCurves, value: number) => void;
  onColorWheelChange: (wheel: 'shadows' | 'midtones' | 'highlights', axis: 'x' | 'y' | 'luminance', value: number) => void;
  onAudioChange: (key: keyof AudioTrackSettings, value: number | boolean | AudioCategory) => void;
  onSetAutoReframe: (aspect: AutoReframeAspect) => void;
  onResetLumetri: () => void;
  onOpenVideo: () => void;
  onExport: () => void;
  onDetectScenes: () => void;
}

const VideoAdjustmentPanel: React.FC<VideoAdjustmentPanelProps> = ({
  lumetri, audio, autoReframe, videoUrl,
  onLumetriBasicChange, onCurvesChange, onColorWheelChange, onAudioChange,
  onSetAutoReframe, onResetLumetri, onOpenVideo, onExport, onDetectScenes,
}) => {
  const disabled = !videoUrl;
  const [activePanel, setActivePanel] = useState<MainPanel>('lumetri');
  const [exportPlatform, setExportPlatform] = useState<VideoExportOptions['platform']>('youtube');
  const [exportQuality, setExportQuality] = useState(90);
  const [appliedTransition, setAppliedTransition] = useState<string | null>(null);

  const selectedPlatformDef = EXPORT_PLATFORMS.find((p) => p.id === exportPlatform)!;

  return (
    <aside className="right-panel">
      <div className="panel-tabs">
        {MAIN_PANELS.map((p) => (
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

      {/* ── Lumetri Color ── */}
      {activePanel === 'lumetri' && (
        <LumetriColorPanel
          lumetri={lumetri}
          disabled={disabled}
          onBasicChange={onLumetriBasicChange}
          onCurvesChange={onCurvesChange}
          onColorWheelChange={onColorWheelChange}
          onReset={onResetLumetri}
        />
      )}

      {/* ── Essential Sound ── */}
      {activePanel === 'sound' && (
        <EssentialSoundPanel
          audio={audio}
          disabled={disabled}
          onChange={onAudioChange}
        />
      )}

      {/* ── Effects ── */}
      {activePanel === 'effects' && (
        <div className="panel-body">
          <p className="section-subtitle">Transitions</p>
          <div className="effects-grid">
            {TRANSITIONS.map((t) => (
              <button
                key={t}
                className={`effect-btn${appliedTransition === t ? ' effect-btn-active' : ''}`}
                disabled={disabled}
                onClick={() => setAppliedTransition(appliedTransition === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
          {appliedTransition && (
            <div className="info-box" style={{ marginTop: 10 }}>
              <strong>{appliedTransition}</strong> transition applied at In/Out points.
            </div>
          )}
          <p className="section-subtitle" style={{ marginTop: 12 }}>Adjustment Layer</p>
          <div className="info-box">
            <p>Apply color grades or effects to multiple clips simultaneously by adding an Adjustment Layer above your clips on the timeline.</p>
          </div>
        </div>
      )}

      {/* ── AI Tools ── */}
      {activePanel === 'ai' && (
        <div className="panel-body">
          <p className="section-subtitle">Auto Reframe</p>
          <p className="panel-hint" style={{ textAlign: 'left', marginBottom: 8 }}>
            Reframe output for different platforms:
          </p>
          <div className="reframe-btns">
            {AUTO_REFRAME_ASPECTS.map((a) => (
              <button
                key={a.value}
                className={`reframe-btn${autoReframe === a.value ? ' active' : ''}`}
                onClick={() => onSetAutoReframe(a.value)}
                disabled={disabled}
              >
                {a.label}
              </button>
            ))}
          </div>

          <p className="section-subtitle" style={{ marginTop: 14 }}>Scene Edit Detection</p>
          <div className="info-box" style={{ marginBottom: 10 }}>
            <p>Automatically detect cuts in pre-edited footage and split into individual clips on the timeline.</p>
          </div>
          <button className="reset-btn" onClick={onDetectScenes} disabled={disabled}>
            🔍 Detect Scenes
          </button>

          <p className="section-subtitle" style={{ marginTop: 14 }}>Enhance Speech</p>
          <div className="info-box">
            <p>AI-powered noise removal — makes dialogue sound professionally recorded. Configure in the <strong>Sound</strong> panel → Dialogue → Clarity.</p>
          </div>
        </div>
      )}

      {/* ── Export ── */}
      {activePanel === 'export' && (
        <div className="panel-body">
          <button className="reset-btn" style={{ marginBottom: 14 }} onClick={onOpenVideo}>
            📁 Open Video
          </button>
          <p className="section-subtitle">Platform Preset</p>
          <div className="export-platform-grid">
            {EXPORT_PLATFORMS.map((p) => (
              <button
                key={p.id}
                className={`export-preset-btn${exportPlatform === p.id ? ' active' : ''}`}
                onClick={() => setExportPlatform(p.id)}
                disabled={disabled}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="info-box" style={{ marginTop: 10 }}>
            <p>
              <strong>Resolution:</strong> {selectedPlatformDef.res}<br />
              <strong>Frame Rate:</strong> {selectedPlatformDef.fps} fps<br />
              <strong>Format:</strong> {selectedPlatformDef.format.toUpperCase()}
            </p>
          </div>
          <div className="slider-row" style={{ marginTop: 10 }}>
            <div className="slider-header">
              <span className="slider-label">Quality</span>
              <span className="slider-value">{exportQuality}%</span>
            </div>
            <input type="range" min={40} max={100} value={exportQuality}
              onChange={(e) => setExportQuality(Number(e.target.value))}
              className="slider" disabled={disabled} aria-label="Export quality" />
          </div>
          <button
            className="btn-primary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={onExport}
            disabled={disabled}
          >
            ↓ Export Video
          </button>
        </div>
      )}
    </aside>
  );
};

export default VideoAdjustmentPanel;
