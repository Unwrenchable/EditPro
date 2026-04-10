import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useVideoEditor } from '../../hooks/useVideoEditor';
import VideoDropZone from './VideoDropZone';
import ProTimeline from './ProTimeline';
import VideoControls from './VideoControls';
import VideoAdjustmentPanel from './VideoAdjustmentPanel';
import VideoScopesPanel from './VideoScopesPanel';
import { buildLumetriFilter, getAutoReframeOverlay } from '../../utils/videoUtils';
import { formatFileSize } from '../../utils/imageFilters';
import type { VideoExportOptions, MagicMoviePlan } from '../../types';

// ── Video Export Modal ────────────────────────────────────────────────────────

interface VideoExportModalProps {
  file: File | null;
  onClose: () => void;
}

const VideoExportModal: React.FC<VideoExportModalProps> = ({ file, onClose }) => {
  const [opts, setOpts] = useState<VideoExportOptions>({
    platform: 'youtube', resolution: '1080p', frameRate: 30, format: 'mp4', quality: 90,
  });
  const [done, setDone] = useState(false);

  const handleExport = () => {
    if (!file) return;
    // Download the original file renamed to reflect export settings
    const url = URL.createObjectURL(file);
    const ext = opts.format;
    const name = file.name.replace(/\.[^.]+$/, '') + `_${opts.resolution}_${opts.frameRate}fps.${ext}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setDone(true);
    setTimeout(onClose, 1500);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Video export">
      <div className="modal" style={{ minWidth: 360 }}>
        <h2 className="modal-title">Export Video</h2>
        {done ? (
          <div className="info-box" style={{ marginBottom: 16 }}>✅ Export started — check your Downloads folder.</div>
        ) : (
          <div className="modal-body">
            <div className="form-row">
              <label className="form-label">Platform</label>
              <select className="form-select" value={opts.platform}
                onChange={(e) => setOpts({ ...opts, platform: e.target.value as VideoExportOptions['platform'] })}>
                <option value="youtube">YouTube (1080p 30fps MP4)</option>
                <option value="tiktok">TikTok / Reels (1080p 30fps MP4)</option>
                <option value="vimeo">Vimeo HD (1080p 24fps MP4)</option>
                <option value="twitter">Twitter / X (720p 30fps MP4)</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {opts.platform === 'custom' && (
              <>
                <div className="form-row">
                  <label className="form-label">Resolution</label>
                  <select className="form-select" value={opts.resolution}
                    onChange={(e) => setOpts({ ...opts, resolution: e.target.value as VideoExportOptions['resolution'] })}>
                    <option value="4K">4K (3840×2160)</option>
                    <option value="1080p">1080p (1920×1080)</option>
                    <option value="720p">720p (1280×720)</option>
                    <option value="480p">480p (854×480)</option>
                  </select>
                </div>
                <div className="form-row">
                  <label className="form-label">Frame Rate</label>
                  <select className="form-select" value={opts.frameRate}
                    onChange={(e) => setOpts({ ...opts, frameRate: Number(e.target.value) as VideoExportOptions['frameRate'] })}>
                    <option value={24}>24 fps (film)</option>
                    <option value={30}>30 fps (standard)</option>
                    <option value={60}>60 fps (smooth)</option>
                  </select>
                </div>
                <div className="form-row">
                  <label className="form-label">Format</label>
                  <select className="form-select" value={opts.format}
                    onChange={(e) => setOpts({ ...opts, format: e.target.value as VideoExportOptions['format'] })}>
                    <option value="mp4">MP4 (H.264)</option>
                    <option value="webm">WebM (VP9)</option>
                    <option value="mov">MOV (ProRes)</option>
                  </select>
                </div>
              </>
            )}
            <div className="form-row">
              <label className="form-label">Quality: {opts.quality}%</label>
              <input type="range" min={40} max={100} value={opts.quality}
                onChange={(e) => setOpts({ ...opts, quality: Number(e.target.value) })}
                className="slider" aria-label="Export quality" />
            </div>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {!done && (
            <button className="btn-primary" onClick={handleExport}>↓ Export</button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── VideoEditor ───────────────────────────────────────────────────────────────

interface VideoEditorProps {
  /** When provided (coming from Magic Movie mode), this plan is applied once the video loads. */
  initialMagicPlan?: MagicMoviePlan;
  /** When provided, this file is loaded automatically on mount. */
  initialFile?: File;
}

const VideoEditor: React.FC<VideoEditorProps> = ({ initialMagicPlan, initialFile }) => {
  // Component owns the video ref (correct React pattern per react-hooks/refs)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const editor = useVideoEditor(videoRef);
  const { state } = editor;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  // ── Magic Movie bootstrap ──────────────────────────────────────────────────
  // Load the initial file on mount if provided (e.g. coming from Magic Movie)
  useEffect(() => {
    if (initialFile) {
      editor.loadVideo(initialFile);
    }
    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply the magic plan once the video has loaded (duration becomes > 0)
  const magicAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialMagicPlan || !state.duration || magicAppliedRef.current) return;
    magicAppliedRef.current = true;

    editor.setLumetri(initialMagicPlan.lumetri);
    editor.setAudio(initialMagicPlan.audio);
    editor.setAutoReframe(initialMagicPlan.autoReframe);
    if (initialMagicPlan.playbackRate !== 1) {
      editor.setPlaybackRate(initialMagicPlan.playbackRate);
    }
    initialMagicPlan.scenes.forEach((scene) => {
      const t = scene.startPct * state.duration;
      editor.addMarker(t, scene.label, scene.color);
    });
  }, [state.duration, initialMagicPlan, editor]);

  const videoFilter = buildLumetriFilter(state.lumetri);
  const reframeOverlay = getAutoReframeOverlay(state.autoReframe);

  // ── File handling ──────────────────────────────────────────────────────────
  const handleOpenVideo = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) editor.loadVideo(file);
  };

  // ── Stable transport callbacks (created in component, not hook) ────────────
  const handleTogglePlay = useCallback(() => {
    editor.togglePlay(state.isPlaying, state.trimStart, state.trimEnd);
  }, [editor, state.isPlaying, state.trimStart, state.trimEnd]);

  const handleVolumeChange   = useCallback((v: number) => editor.setVolume(v),           [editor]);
  const handleToggleMute     = useCallback(() => editor.toggleMute(state.isMuted),        [editor, state.isMuted]);
  const handleRateChange     = useCallback((r: number) => editor.setPlaybackRate(r),      [editor]);
  const handleSeek           = useCallback((t: number) => editor.seek(t),                 [editor]);
  const handleTrimStart      = useCallback((v: number) => editor.setTrimStart(v, state.trimEnd), [editor, state.trimEnd]);
  const handleTrimEnd        = useCallback((v: number) => editor.setTrimEnd(v, state.trimStart, state.duration), [editor, state.trimStart, state.duration]);
  const handleZoom           = useCallback((z: number) => editor.setTimelineZoom(z),      [editor]);
  const handleAddMarker      = useCallback(() => editor.addMarker(state.currentTime),     [editor, state.currentTime]);
  const handleRemoveMarker   = useCallback((id: string) => editor.removeMarker(id),       [editor]);
  const handleEnded          = useCallback(() => editor.pause(),                           [editor]);
  const handleStepBack       = useCallback(() => editor.stepFrame(-1),                    [editor]);
  const handleStepForward    = useCallback(() => editor.stepFrame(1),                     [editor]);
  const handleSkipBack       = useCallback(() => editor.skip(-10),                        [editor]);
  const handleSkipForward    = useCallback(() => editor.skip(10),                         [editor]);
  const handleAddTrack       = useCallback((type: Parameters<typeof editor.addTrack>[0]) => editor.addTrack(type), [editor]);
  const handleSetTrackMuted  = useCallback((id: string, m: boolean) => editor.setTrackMuted(id, m), [editor]);
  const handleSetTrackLocked = useCallback((id: string, l: boolean) => editor.setTrackLocked(id, l), [editor]);
  const handleRemoveTrack    = useCallback((id: string) => editor.removeTrack(id), [editor]);
  const handleDeleteClip     = useCallback((id: string) => editor.deleteClip(id), [editor]);
  const handleSplitClip      = useCallback((id: string, t: number) => editor.splitClip(id, t), [editor]);
  const handleDetectScenes   = useCallback(() => {
    // Simulated scene detection: add markers at regular intervals
    const interval = Math.max(state.duration / 8, 2);
    let t = interval;
    while (t < state.duration - 1) {
      editor.addMarker(Math.round(t * 10) / 10, 'Scene cut', 'green');
      t += interval;
    }
  }, [editor, state.duration]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!state.videoUrl) return;
      // Don't fire when typing in an input or select
      if ((e.target as HTMLElement).tagName === 'INPUT' ||
          (e.target as HTMLElement).tagName === 'TEXTAREA' ||
          (e.target as HTMLElement).tagName === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          editor.togglePlay(state.isPlaying, state.trimStart, state.trimEnd);
          break;
        case 'k': case 'K':
          editor.pause();
          break;
        case 'l': case 'L':
          if (!state.isPlaying) editor.play(state.trimStart, state.trimEnd);
          break;
        case 'j': case 'J':
          editor.skip(-5);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          editor.stepFrame(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          editor.stepFrame(1);
          break;
        case 'i': case 'I':
          editor.setInPoint(state.currentTime, state.trimEnd);
          break;
        case 'o': case 'O':
          editor.setOutPoint(state.currentTime, state.trimStart, state.duration);
          break;
        case 'm': case 'M':
          editor.addMarker(state.currentTime);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editor, state]);

  return (
    <div className="editor-layout">
      <div className="editor-main">
        {!state.videoUrl ? (
          <VideoDropZone onFileSelected={editor.loadVideo} videoUrl={state.videoUrl} />
        ) : (
          <div className="video-area">
            {/* ── Program Monitor ── */}
            <div className="video-container" style={{ position: 'relative' }}>
              <video
                ref={videoRef}
                src={state.videoUrl}
                className="preview-video"
                style={{ filter: videoFilter }}
                onLoadedMetadata={editor.onLoadedMetadata}
                onTimeUpdate={editor.onTimeUpdate}
                onEnded={handleEnded}
                aria-label="Video preview"
              />
              {/* Auto Reframe crop overlay */}
              {reframeOverlay && (
                <div
                  className="autoreframe-overlay"
                  style={{
                    position: 'absolute',
                    left: reframeOverlay.left,
                    right: reframeOverlay.right,
                    top: reframeOverlay.top,
                    bottom: reframeOverlay.bottom,
                    pointerEvents: 'none',
                    zIndex: 5,
                  }}
                >
                  <div className="autoreframe-label">{state.autoReframe}</div>
                </div>
              )}
            </div>

            {/* ── Transport controls ── */}
            <VideoControls
              isPlaying={state.isPlaying}
              currentTime={state.currentTime}
              duration={state.duration}
              volume={state.volume}
              isMuted={state.isMuted}
              playbackRate={state.playbackRate}
              onTogglePlay={handleTogglePlay}
              onVolumeChange={handleVolumeChange}
              onToggleMute={handleToggleMute}
              onPlaybackRateChange={handleRateChange}
              onStepBack={handleStepBack}
              onStepForward={handleStepForward}
              onSkipBack={handleSkipBack}
              onSkipForward={handleSkipForward}
              onAddMarker={handleAddMarker}
            />

            {/* ── Video Scopes ── */}
            <VideoScopesPanel videoRef={videoRef} />
          </div>
        )}

        {/* ── Pro Timeline ── */}
        <ProTimeline
          duration={state.duration}
          currentTime={state.currentTime}
          trimStart={state.trimStart}
          trimEnd={state.trimEnd}
          markers={state.markers}
          tracks={state.tracks}
          clips={state.clips}
          zoom={state.timelineZoom}
          hasVideo={!!state.videoUrl}
          onSeek={handleSeek}
          onTrimStartChange={handleTrimStart}
          onTrimEndChange={handleTrimEnd}
          onZoomChange={handleZoom}
          onAddMarker={handleAddMarker}
          onRemoveMarker={handleRemoveMarker}
          onAddTrack={handleAddTrack}
          onSetTrackMuted={handleSetTrackMuted}
          onSetTrackLocked={handleSetTrackLocked}
          onRemoveTrack={handleRemoveTrack}
          onDeleteClip={handleDeleteClip}
          onSplitClip={handleSplitClip}
        />

        {state.file && (
          <div className="file-info-bar">
            <span>{state.file.name}</span>
            <span>{formatFileSize(state.file.size)}</span>
            {state.markers.length > 0 && (
              <span>{state.markers.length} marker{state.markers.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.webm,.ogg,.mov,.avi,.mkv,.m4v,.flv,.wmv"
          className="hidden-input"
          onChange={handleFileChange}
          aria-label="Open video file"
        />
      </div>

      {/* ── Right Panel ── */}
      <VideoAdjustmentPanel
        lumetri={state.lumetri}
        audio={state.audio}
        autoReframe={state.autoReframe}
        videoUrl={state.videoUrl}
        onLumetriBasicChange={editor.updateLumetriBasic}
        onCurvesChange={editor.updateLumetriCurves}
        onColorWheelChange={editor.updateColorWheel}
        onAudioChange={editor.updateAudio}
        onSetAutoReframe={editor.setAutoReframe}
        onResetLumetri={editor.resetLumetri}
        onOpenVideo={handleOpenVideo}
        onExport={() => setShowExportModal(true)}
        onDetectScenes={handleDetectScenes}
      />

      {showExportModal && (
        <VideoExportModal
          file={state.file}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
};

export default VideoEditor;
