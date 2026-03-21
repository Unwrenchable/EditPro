import React, { useRef, useCallback } from 'react';
import { useVideoEditor } from '../../hooks/useVideoEditor';
import VideoDropZone from './VideoDropZone';
import VideoTimeline from './VideoTimeline';
import VideoControls from './VideoControls';
import VideoAdjustmentPanel from './VideoAdjustmentPanel';
import { buildVideoFilter } from '../../utils/videoUtils';
import { formatFileSize } from '../../utils/imageFilters';

const VideoEditor: React.FC = () => {
  const editor = useVideoEditor();
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

  return (
    <div className="editor-layout">
      <div className="editor-main">
        {!state.videoUrl ? (
          <VideoDropZone onFileSelected={editor.loadVideo} videoUrl={state.videoUrl} />
        ) : (
          <div className="video-area">
            <div className="video-container">
              <video
                ref={editor.setVideoRef}
                src={state.videoUrl}
                className="preview-video"
                style={{ filter: videoFilter }}
                onLoadedMetadata={editor.onLoadedMetadata}
                onTimeUpdate={editor.onTimeUpdate}
                onEnded={() => {
                  editor.pause();
                }}
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
              onTogglePlay={editor.togglePlay}
              onVolumeChange={editor.setVolume}
              onToggleMute={editor.toggleMute}
              onPlaybackRateChange={editor.setPlaybackRate}
            />
            <VideoTimeline
              duration={state.duration}
              currentTime={state.currentTime}
              trimStart={state.trimStart}
              trimEnd={state.trimEnd}
              onSeek={editor.seek}
              onTrimStartChange={editor.setTrimStart}
              onTrimEndChange={editor.setTrimEnd}
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
        onAdjustmentChange={editor.updateVideoAdjustment}
        onOpenVideo={handleOpenVideo}
        videoUrl={state.videoUrl}
      />
    </div>
  );
};

export default VideoEditor;
