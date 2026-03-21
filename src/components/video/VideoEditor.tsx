import React, { useRef, useCallback } from 'react';
import { useVideoEditor } from '../../hooks/useVideoEditor';
import VideoDropZone from './VideoDropZone';
import VideoTimeline from './VideoTimeline';
import VideoControls from './VideoControls';
import VideoAdjustmentPanel from './VideoAdjustmentPanel';
import { buildVideoFilter } from '../../utils/videoUtils';
import { formatFileSize } from '../../utils/imageFilters';

const VideoEditor: React.FC = () => {
  // The component owns the ref — correct React pattern that satisfies react-hooks/refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const editor = useVideoEditor(videoRef);
  const { state } = editor;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoFilter = buildVideoFilter(state.brightness, state.contrast, state.saturation);

  const handleOpenVideo = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) editor.loadVideo(file);
  };

  // Stable callbacks derived from current state — created here in the component,
  // not in the hook, so the linter sees them as component-level handlers.
  const handleTogglePlay = useCallback(() => {
    editor.togglePlay(state.isPlaying, state.trimStart, state.trimEnd);
  }, [editor, state.isPlaying, state.trimStart, state.trimEnd]);

  const handleVolumeChange = useCallback(
    (vol: number) => editor.setVolume(vol),
    [editor]
  );

  const handleToggleMute = useCallback(
    () => editor.toggleMute(state.isMuted),
    [editor, state.isMuted]
  );

  const handlePlaybackRateChange = useCallback(
    (rate: number) => editor.setPlaybackRate(rate),
    [editor]
  );

  const handleSeek = useCallback(
    (time: number) => editor.seek(time),
    [editor]
  );

  const handleTrimStartChange = useCallback(
    (value: number) => editor.setTrimStart(value, state.trimEnd),
    [editor, state.trimEnd]
  );

  const handleTrimEndChange = useCallback(
    (value: number) => editor.setTrimEnd(value, state.trimStart, state.duration),
    [editor, state.trimStart, state.duration]
  );

  const handleEnded = useCallback(() => editor.pause(), [editor]);

  return (
    <div className="editor-layout">
      <div className="editor-main">
        {!state.videoUrl ? (
          <VideoDropZone onFileSelected={editor.loadVideo} videoUrl={state.videoUrl} />
        ) : (
          <div className="video-area">
            <div className="video-container">
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
            </div>
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
              onPlaybackRateChange={handlePlaybackRateChange}
            />
            <VideoTimeline
              duration={state.duration}
              currentTime={state.currentTime}
              trimStart={state.trimStart}
              trimEnd={state.trimEnd}
              onSeek={handleSeek}
              onTrimStartChange={handleTrimStartChange}
              onTrimEndChange={handleTrimEndChange}
            />
          </div>
        )}

        {state.file && (
          <div className="file-info-bar">
            <span>{state.file.name}</span>
            <span>{formatFileSize(state.file.size)}</span>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.webm,.ogg,.mov,.avi"
          className="hidden-input"
          onChange={handleFileInputChange}
          aria-label="Open video file"
        />
      </div>

      <VideoAdjustmentPanel
        brightness={state.brightness}
        contrast={state.contrast}
        saturation={state.saturation}
        temperature={state.temperature}
        highlights={state.highlights}
        shadows={state.shadows}
        onAdjustmentChange={editor.updateVideoAdjustment}
        onOpenVideo={handleOpenVideo}
        videoUrl={state.videoUrl}
      />
    </div>
  );
};

export default VideoEditor;
