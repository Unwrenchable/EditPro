import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useEditorSession } from '../../session/editorSessionContext';
import VideoDropZone from './VideoDropZone';
import ProTimeline from './ProTimeline';
import VideoControls from './VideoControls';
import VideoAdjustmentPanel from './VideoAdjustmentPanel';
import VideoScopesPanel from './VideoScopesPanel';
import VideoExportModal from './VideoExportModal';
import { buildLumetriFilter, getAutoReframeOverlay } from '../../utils/videoUtils';
import { placeTransition } from '../../utils/video/creative';
import ProgramOverlay from './ProgramOverlay';
import { useWaveformPeaks } from '../../hooks/useWaveformPeaks';
import { formatFileSize } from '../../utils/imageFilters';
import { resolveSourcePath } from '../../utils/video/sourcePath';
import { sampleEffect, sampleTransform } from '../../utils/video/keyframes';
import { clipAtPlayhead, editPoints, neighborEdit } from '../../utils/video/timelineEdit';
import { matchNleShortcut, nleActionKind } from '../../utils/video/nleShortcuts';
import { monitorScale, resolutionLabel, selectPreviewUrl } from '../../playback/frameClock';
import { packPreviewGrade, previewBackendLabel } from '../../playback/gpu/grade';
import { useGpuPreview } from '../../playback/gpu/useGpuPreview';
import { liftGammaGainIsNeutral } from '../../utils/video/creative';
import { usePreviewSrc } from '../../playback/usePreviewSrc';
import { useProxyMedia } from '../../playback/useProxyMedia';
import PlaybackSettings from './PlaybackSettings';
import type { MagicMoviePlan, VideoEditorState, VideoExportOptions } from '../../types';

function previewLook(state: VideoEditorState, baseFilter: string): {
  filter: string;
  effectFilter: string;
  picture: React.CSSProperties;
  brightness: number | null;
  contrast: number | null;
  saturation: number | null;
  blur: number | null;
} {
  const clip = clipAtPlayhead(state.clips, state.tracks, state.currentTime);
  const useClip = Boolean(clip?.keyframes && clip.keyframes.length > 0);
  const keys = useClip ? clip?.keyframes : state.programKeyframes;
  const time = useClip && clip ? state.currentTime - clip.startTime : state.currentTime;
  const motion = sampleTransform(keys, time);
  const brightness = sampleEffect(keys, 'brightness', time);
  const contrast = sampleEffect(keys, 'contrast', time);
  const saturation = sampleEffect(keys, 'saturation', time);
  const blur = sampleEffect(keys, 'blur', time);
  const extras = [
    brightness !== null ? `brightness(${(1 + brightness).toFixed(3)})` : '',
    contrast !== null ? `contrast(${contrast.toFixed(3)})` : '',
    saturation !== null ? `saturate(${saturation.toFixed(3)})` : '',
    blur !== null ? `blur(${Math.max(0, blur).toFixed(2)}px)` : '',
  ].filter((part) => part.length > 0);
  const moved = motion.positionX !== 0 || motion.positionY !== 0 || motion.scale !== 1 || motion.rotation !== 0;
  return {
    filter: [baseFilter, ...extras].filter(Boolean).join(' '),
    effectFilter: extras.join(' '),
    brightness,
    contrast,
    saturation,
    blur,
    picture: {
      opacity: motion.opacity,
      transform: moved
        ? `translate(${motion.positionX * 100}%, ${motion.positionY * 100}%) rotate(${motion.rotation}deg) scale(${motion.scale})`
        : undefined,
      transformOrigin: 'center center',
    },
  };
}

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
  const gpuCanvasRef = useRef<HTMLCanvasElement>(null);
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
  const look = previewLook(state, videoFilter);
  const previewGrade = packPreviewGrade(state.lumetri, look);
  const cpuGrade = !liftGammaGainIsNeutral(state.creative.liftGammaGain) || state.creative.lut !== null;
  const previewBackend = useGpuPreview(videoRef, gpuCanvasRef, previewGrade, Boolean(state.videoUrl) && !cpuGrade);
  const reframeOverlay = getAutoReframeOverlay(state.autoReframe);
  const waveform = useWaveformPeaks(state.videoUrl);
  const proxy = useProxyMedia(state.mediaPath);
  const playbackUrl = selectPreviewUrl({
    originalUrl: state.videoUrl,
    proxyUrl: proxy.proxyUrl,
    useProxy: proxy.useProxy,
  });
  usePreviewSrc(videoRef, playbackUrl, state.mediaPath);
  const showingProxy = Boolean(proxy.useProxy && proxy.proxyUrl && playbackUrl === proxy.proxyUrl);
  const stageScale = monitorScale({ showingProxy, resolution: proxy.resolution });
  const proxyAvailable = Boolean(state.mediaPath && window.editpro?.startProxy);

  useEffect(() => {
    const video = videoRef.current;
    if (!video?.dataset) return;
    if (proxy.fps && proxy.fps > 0) video.dataset.frameRate = String(proxy.fps);
  }, [proxy.fps, playbackUrl, videoRef]);

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
  const handleDropTransition = useCallback((outgoingClipId: string, incomingClipId: string, kind: Parameters<typeof placeTransition>[3]) => {
    const placed = placeTransition(state.clips, outgoingClipId, incomingClipId, kind);
    if (!placed) return;
    const without = state.creative.transitions.filter((item) =>
      !(item.outgoingClipId === placed.outgoingClipId && item.incomingClipId === placed.incomingClipId));
    editor.setCreative({
      ...state.creative,
      transitions: [...without, { ...placed, id: `xfade_${Date.now()}` }],
    });
  }, [editor, state.clips, state.creative]);
  const handleDetectScenes   = useCallback(() => {
    // Simulated scene detection: add markers at regular intervals
    const interval = Math.max(state.duration / 8, 2);
    let t = interval;
    while (t < state.duration - 1) {
      editor.addMarker(Math.round(t * 10) / 10, 'Scene cut', 'green');
      t += interval;
    }
  }, [editor, state.duration]);

  // ── Keyboard shortcuts (transport). Timeline tools are handled in ProTimeline.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!state.videoUrl || document.querySelector('.export-modal')) return;
      const action = matchNleShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target: event.target,
      });
      if (!action || nleActionKind(action) !== 'transport') return;
      event.preventDefault();
      if (action.type === 'shuttle') {
        if (action.direction === 'stop') editor.shuttleStop();
        else if (action.direction === 'forward') editor.shuttleForward(action.slow);
        else editor.shuttleReverse(action.slow);
      } else if (action.type === 'playToggle') {
        editor.togglePlay(state.isPlaying, state.trimStart, state.trimEnd);
      } else if (action.type === 'step') {
        const direction = action.frames < 0 ? -1 : 1;
        for (let index = 0; index < Math.abs(action.frames); index += 1) editor.stepFrame(direction);
      } else if (action.type === 'setIn') {
        editor.setInPoint(state.currentTime, state.trimEnd);
      } else if (action.type === 'setOut') {
        editor.setOutPoint(state.currentTime, state.trimStart, state.duration);
      } else if (action.type === 'clearIn') {
        editor.setTrimStart(0, state.trimEnd);
      } else if (action.type === 'clearOut') {
        editor.setTrimEnd(state.duration, state.trimStart, state.duration);
      } else if (action.type === 'clearInOut') {
        editor.clearInOut(state.duration);
      } else if (action.type === 'marker') {
        editor.addMarker(state.currentTime);
      } else if (action.type === 'markClip') {
        editor.markClipAt(state.currentTime);
      } else if (action.type === 'trimToPlayhead') {
        editor.rippleToPlayhead(action.edge, state.currentTime);
      } else if (action.type === 'goto') {
        editor.seek(action.edge === 'start' ? 0 : state.duration);
      } else if (action.type === 'gotoEdit') {
        const next = neighborEdit(editPoints(state.clips, state.markers, state.trimStart, state.trimEnd), state.currentTime, action.direction);
        if (next !== null) editor.seek(next);
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
              <div className="playback-stage" data-monitor-scale={stageScale}>
              <ProgramOverlay
                creative={state.creative}
                currentTime={state.currentTime}
                trimStart={state.trimStart}
                trimEnd={state.trimEnd}
                playbackRate={state.playbackRate}
                transition={state.transition}
                clips={state.clips}
                lumetriFilter={videoFilter}
                pictureStyle={look.picture}
                canvasFilter={look.effectFilter}
                videoRef={videoRef}
                gpuActive={previewBackend !== 'css'}
                previewCanvas={
                  <canvas
                    ref={gpuCanvasRef}
                    className="gpu-preview-canvas"
                    data-preview-backend={previewBackend}
                    aria-hidden="true"
                  />
                }
              >
              <video
                ref={videoRef}
                className="preview-video"
                style={{ filter: previewBackend === 'css' ? (look.filter || undefined) : undefined }}
                preload="auto"
                playsInline
                crossOrigin={playbackUrl?.startsWith('media:') ? 'anonymous' : undefined}
                onLoadedMetadata={editor.onLoadedMetadata}
                onTimeUpdate={editor.onTimeUpdate}
                onEnded={handleEnded}
                aria-label="Video preview"
              />
              </ProgramOverlay>
              </div>
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

            <PlaybackSettings
              resolution={proxy.resolution}
              useProxy={proxy.useProxy}
              proxyAvailable={proxyAvailable}
              status={proxy.status}
              percent={proxy.percent}
              message={proxy.message}
              decodeLabel={proxy.decodeLabel}
              previewLabel={
                showingProxy
                  ? `Proxy ${proxy.width}×${proxy.height} · ${resolutionLabel(proxy.resolution)}`
                  : 'Original'
              }
              rendererLabel={previewBackendLabel(previewBackend)}
              onResolution={proxy.setResolution}
              onToggleProxy={proxy.toggleProxy}
              onCancelProxy={proxy.cancel}
            />

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
          snapping={state.snapping}
          shuttleRate={state.shuttleRate}
          programKeyframes={state.programKeyframes}
          hasVideo={!!state.videoUrl}
          onSeek={handleSeek}
          onTrimStartChange={handleTrimStart}
          onTrimEndChange={handleTrimEnd}
          onZoomChange={handleZoom}
          onToggleSnapping={() => editor.setSnapping(!state.snapping)}
          onAddMarker={handleAddMarker}
          onRemoveMarker={handleRemoveMarker}
          onAddTrack={handleAddTrack}
          onSetTrackMuted={handleSetTrackMuted}
          onSetTrackLocked={handleSetTrackLocked}
          onRemoveTrack={handleRemoveTrack}
          onDeleteClip={handleDeleteClip}
          onRippleDelete={(id) => editor.rippleDeleteClip(id)}
          onSplitClip={handleSplitClip}
          onRazorAt={(time) => editor.razorAt(time)}
          onMoveClip={(id, trackId, start, key) => editor.moveClip(id, trackId, start, key)}
          onTrimClip={(id, edge, time, key) => editor.trimClip(id, edge, time, key)}
          onRippleTrim={(id, edge, value, key) => editor.rippleTrimClip(id, edge, value, key)}
          onRollClip={(id, edge, time, key) => editor.rollClip(id, edge, time, key)}
          onSlipClip={(id, inPoint, key) => editor.slipClip(id, inPoint, key)}
          onSlideClip={(id, start, key) => editor.slideClip(id, start, key)}
          onToggleLink={(id) => editor.toggleClipLink(id, state.currentTime)}
          onAddKeyframe={(clipId, keyframe) => {
            if (clipId) editor.addClipKeyframe(clipId, keyframe);
            else editor.addProgramKeyframe(keyframe);
          }}
          onUpdateKeyframe={(clipId, keyframeId, patch, key) => {
            if (clipId) editor.updateClipKeyframe(clipId, keyframeId, patch, key);
            else editor.updateProgramKeyframe(keyframeId, patch, key);
          }}
          onRemoveKeyframe={(clipId, keyframeId) => {
            if (clipId) editor.removeClipKeyframe(clipId, keyframeId);
            else editor.removeProgramKeyframe(keyframeId);
          }}
          peaks={waveform.peaks}
          mediaDuration={waveform.duration || state.duration}
          onDropTransition={handleDropTransition}
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
        creative={state.creative}
        tracks={state.tracks}
        clips={state.clips}
        currentTime={state.currentTime}
        duration={state.duration}
        onCreativeChange={editor.setCreative}
        onSetTrackMuted={handleSetTrackMuted}
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
          programKeyframes={state.programKeyframes}
          creative={state.creative}
          onCreativeChange={editor.setCreative}
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
