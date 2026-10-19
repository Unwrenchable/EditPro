import React, { useState } from 'react';
import LumetriColorPanel from './LumetriColorPanel';
import EssentialSoundPanel from './EssentialSoundPanel';
import type {
  LumetriColor, LumetriCurves, AudioTrackSettings, AudioCategory,
  AutoReframeAspect, VideoExportOptions, VideoTransition, TimelineClip, TimelineTrack,
} from '../../types';
import type { CreativeState } from '../../utils/video/creative';
import CreativePanels from './CreativePanels';
import SpeechTranscription from './SpeechTranscription';
import AudioMixer from './AudioMixer';
import { PLATFORM_PRESETS, TRANSITION_OPTIONS } from '../../utils/video/exportPlan';
import OfflineAiPanel from './ai/OfflineAiPanel';

type MainPanel = 'lumetri' | 'sound' | 'effects' | 'ai' | 'export';

const MAIN_PANELS: { id: MainPanel; label: string; icon: string }[] = [
  { id: 'lumetri',  label: 'Color',   icon: '🎨' },
  { id: 'sound',    label: 'Sound',   icon: '🎙' },
  { id: 'effects',  label: 'Effects', icon: '✨' },
  { id: 'ai',       label: 'AI',      icon: '🤖' },
  { id: 'export',   label: 'Export',  icon: '📤' },
];

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
  mediaFile?: File | null;
  onLumetriBasicChange: (key: keyof Omit<LumetriColor, 'curves' | 'wheels'>, value: number) => void;
  onCurvesChange: (key: keyof LumetriCurves, value: number) => void;
  onColorWheelChange: (wheel: 'shadows' | 'midtones' | 'highlights', axis: 'x' | 'y' | 'luminance', value: number) => void;
  onAudioChange: (key: keyof AudioTrackSettings, value: number | boolean | AudioCategory) => void;
  onSetAutoReframe: (aspect: AutoReframeAspect) => void;
  onResetLumetri: () => void;
  onOpenVideo: () => void;
  onExport: (prefs: { platform: VideoExportOptions['platform']; quality: number }) => void;
  transition: VideoTransition;
  onTransitionChange: (transition: VideoTransition) => void;
  creative: CreativeState;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  currentTime: number;
  duration: number;
  onCreativeChange: (creative: CreativeState, coalesceKey?: string) => void;
  onSetTrackMuted: (trackId: string, muted: boolean) => void;
  peaks?: readonly number[];
  mediaDuration?: number;
  trimStart?: number;
  playbackRate?: number;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

const VideoAdjustmentPanel: React.FC<VideoAdjustmentPanelProps> = ({
  lumetri, audio, autoReframe, videoUrl, mediaFile = null,
  onLumetriBasicChange, onCurvesChange, onColorWheelChange, onAudioChange,
  onSetAutoReframe, onResetLumetri, onOpenVideo, onExport,
  transition, onTransitionChange,
  creative, tracks, clips, currentTime, duration, onCreativeChange, onSetTrackMuted,
  peaks = [], mediaDuration = 0, trimStart = 0, playbackRate = 1, videoRef,
}) => {
  const disabled = !videoUrl;
  const [activePanel, setActivePanel] = useState<MainPanel>('lumetri');
  const [exportPlatform, setExportPlatform] = useState<VideoExportOptions['platform']>('youtube');
  const [exportQuality, setExportQuality] = useState(90);

  const selectedPlatformDef = PLATFORM_PRESETS.find((p) => p.id === exportPlatform) ?? PLATFORM_PRESETS[0];

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
        <>
        <LumetriColorPanel
          lumetri={lumetri}
          disabled={disabled}
          onBasicChange={onLumetriBasicChange}
          onCurvesChange={onCurvesChange}
          onColorWheelChange={onColorWheelChange}
          onReset={onResetLumetri}
        />
        <CreativePanels
          part="grade"
          creative={creative}
          disabled={disabled}
          tracks={tracks}
          clips={clips}
          currentTime={currentTime}
          duration={duration}
          videoUrl={videoUrl}
          transition={transition}
          onTransitionChange={onTransitionChange}
          onCreativeChange={onCreativeChange}
          onSetTrackMuted={onSetTrackMuted}
        />
        </>
      )}

      {/* ── Essential Sound ── */}
      {activePanel === 'sound' && (
        <>
        <AudioMixer
          creative={creative}
          tracks={tracks}
          currentTime={currentTime}
          trimStart={trimStart}
          playbackRate={playbackRate}
          peaks={peaks}
          mediaDuration={mediaDuration || duration}
          disabled={disabled}
          videoRef={videoRef}
          onCreativeChange={onCreativeChange}
          onSetTrackMuted={onSetTrackMuted}
        />
        <EssentialSoundPanel
          audio={audio}
          disabled={disabled}
          onChange={onAudioChange}
        />
        <CreativePanels
          part="audio"
          creative={creative}
          disabled={disabled}
          tracks={tracks}
          clips={clips}
          currentTime={currentTime}
          duration={duration}
          videoUrl={videoUrl}
          transition={transition}
          onTransitionChange={onTransitionChange}
          onCreativeChange={onCreativeChange}
          onSetTrackMuted={onSetTrackMuted}
        />
        </>
      )}

      {/* ── Effects ── */}
      {activePanel === 'effects' && (
        <div className="panel-body">
          <p className="section-subtitle">Transitions</p>
          <div className="effects-grid">
            {TRANSITION_OPTIONS.map((t) => (
              <button
                key={t.id}
                className={`effect-btn${transition === t.id ? ' effect-btn-active' : ''}`}
                disabled={disabled}
                onClick={() => onTransitionChange(transition === t.id && t.id !== 'cut' ? 'cut' : t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <CreativePanels
            part="picture"
            creative={creative}
            disabled={disabled}
            tracks={tracks}
            clips={clips}
            currentTime={currentTime}
            duration={duration}
            videoUrl={videoUrl}
            transition={transition}
            onTransitionChange={onTransitionChange}
            onCreativeChange={onCreativeChange}
            onSetTrackMuted={onSetTrackMuted}
          />
          {transition !== 'cut' && (
            <div className="info-box" style={{ marginTop: 10 }}>
              <strong>{TRANSITION_OPTIONS.find((t) => t.id === transition)?.label}</strong> is rendered at the In and Out points when you export.
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

          <OfflineAiPanel />

          <p className="section-subtitle" style={{ marginTop: 14 }}>Enhance Speech</p>
          <SpeechTranscription file={mediaFile} disabled={disabled} />
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
            {PLATFORM_PRESETS.map((p) => (
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
              <strong>Resolution:</strong> {selectedPlatformDef.resolution}<br />
              <strong>Frame Rate:</strong> {selectedPlatformDef.frameRate} fps<br />
              <strong>Format:</strong> {selectedPlatformDef.format.toUpperCase()}
              {selectedPlatformDef.aspect ? <><br /><strong>Frame:</strong> {selectedPlatformDef.aspect}</> : null}
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
            onClick={() => onExport({ platform: exportPlatform, quality: exportQuality })}
            disabled={disabled}
          >
            ↓ Export Video
          </button>
          <p className="panel-hint" style={{ textAlign: 'left' }}>
            Writes a new file with trim, color, sound, and transitions. Progress and cancel are in the export dialog.
          </p>
        </div>
      )}
    </aside>
  );
};

export default VideoAdjustmentPanel;
