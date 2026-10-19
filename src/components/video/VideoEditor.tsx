import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useEditorSession } from '../../session/editorSessionContext';
import VideoDropZone from './VideoDropZone';
import ProTimeline from './ProTimeline';
import VideoControls from './VideoControls';
import VideoAdjustmentPanel from './VideoAdjustmentPanel';
import VideoScopesPanel from './VideoScopesPanel';
import VideoExportModal from './VideoExportModal';
import { buildLumetriFilter, getAutoReframeOverlay } from '../../utils/videoUtils';
import { formatFileSize } from '../../utils/imageFilters';
import { resolveSourcePath } from '../../utils/video/sourcePath';
import type { MagicMoviePlan, VideoExportOptions } from '../../types';

// ── VideoEditor ───────────────────────────────────────────────────────────────

interface VideoEditorProps {
  /** When provided (coming from Magic Movie mode), this plan is applied once the video loads. */
  initialMagicPlan?: MagicMoviePlan;
  /** When provided, this file is loaded automatically on mount. */
  initialFile?: File;
  /** Increment to open the export dialog (top bar / menu). */
  exportRequestId?: number;
}

const VideoEditor: React.FC<VideoEditorProps> = ({
  initialMagicPlan,
  initialFile,
  exportRequestId = 0,
}) => {
  const { video: editor, videoRef, relinkVideo } = useEditorSession();
  const { state } = editor;
  const { loadVideo, applyMagicPlan } = editor;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportSeed, setExportSeed] = useState<{ platform: VideoExportOptions['platform']; quality: number }>({
    platform: 'youtube',
    quality: 90,
  });

  // ── Magic Movie bootstrap ──────────────────────────────────────────────────
  // Load the initial file on mount if provided (e.g. coming from Magic Movie).
  // `initialFile` and `editor.loadVideo` are both stable references for the
  // lifetime of this component instance (key-based remount in App).
  useEffect(() => {
    if (initialFile) {
      loadVideo(initialFile, resolveSourcePath(initialFile, window.editpro));
    }
  }, [initialFile, loadVideo]);

  // Open the dialog when the top bar or File menu asks, without an effect.
  const [seenExportRequest, setSeenExportRequest] = useState(exportRequestId);
  if (exportRequestId !== seenExportRequest) {
    setSeenExportRequest(exportRequestId);
    if (exportRequestId > 0 && state.videoUrl) setShowExportModal(true);
  }

  // Apply the magic plan once the video has loaded (duration becomes > 0)
  const magicAppliedRef = useRef(false);
  useEffect(() => {
    if (!initialMagicPlan || !state.duration || magicAppliedRef.current) return;
    magicAppliedRef.current = true;

    applyMagicPlan(initialMagicPlan, state.duration);
  }, [state.duration, initialMagicPlan, applyMagicPlan]);

  const videoFilter = buildLumetriFilter(state.lumetri);
  const reframeOverlay = getAutoReframeOverlay(state.autoReframe);

  // ── File handling ──────────────────────────────────────────────────────────
  const handleOpenVideo = useCallback(() => fileInputRef.current?.click(), []);
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) editor.loadVideo(file, resolveSourcePath(file, window.editpro));
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
      // Don't fire when typing in an input or select, or when a command shortcut is pressed.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
        {state.mediaMissing && (
          <div className="info-box media-missing-banner">
            <span>Video file is offline{state.mediaName ? `: ${state.mediaName}` : ''}.</span>
            <button type="button" className="btn-secondary" onClick={relinkVideo}>
              Relink
            </button>
          </div>
        )}
        {!state.videoUrl ? (
          <VideoDropZone
            onFileSelected={(file) => editor.loadVideo(file, resolveSourcePath(file, window.editpro))}
            videoUrl={state.videoUrl}
          />
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
        onExport={(prefs) => {
          setExportSeed(prefs);
          setShowExportModal(true);
        }}
        onDetectScenes={handleDetectScenes}
        transition={state.transition}
        onTransitionChange={editor.setTransition}
      />

      {showExportModal && state.file && (
        <VideoExportModal
          file={state.file}
          sourcePath={state.sourcePath ?? state.mediaPath}
          trimStart={state.trimStart}
          trimEnd={state.trimEnd}
          playbackRate={state.playbackRate}
          volume={state.volume}
          muted={state.isMuted}
          lumetri={state.lumetri}
          audio={state.audio}
          autoReframe={state.autoReframe}
          transition={state.transition}
          clips={state.clips}
          tracks={state.tracks}
          initialPlatform={exportSeed.platform}
          initialQuality={exportSeed.quality}
          onTransitionChange={editor.setTransition}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
};

export default VideoEditor;
