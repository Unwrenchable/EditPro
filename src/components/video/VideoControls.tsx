import React from 'react';
import { formatTime } from '../../utils/videoUtils';

interface VideoControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playbackRate: number;
  onTogglePlay: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onPlaybackRateChange: (rate: number) => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onAddMarker: () => void;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

const VideoControls: React.FC<VideoControlsProps> = ({
  isPlaying, currentTime, duration, volume, isMuted, playbackRate,
  onTogglePlay, onVolumeChange, onToggleMute, onPlaybackRateChange,
  onStepBack, onStepForward, onSkipBack, onSkipForward, onAddMarker,
}) => {
  return (
    <div className="video-controls">
      <div className="controls-left">
        <button className="vc-icon-btn" onClick={onSkipBack}   title="Skip back 10s (Shift+J)" aria-label="Skip back 10 seconds">⏮</button>
        <button className="vc-icon-btn" onClick={onStepBack}   title="Step back 1 frame (←)"  aria-label="Step back one frame">◀</button>
        <button className="play-btn"    onClick={onTogglePlay}  aria-label={isPlaying ? 'Pause (K)' : 'Play (L or Space)'}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="vc-icon-btn" onClick={onStepForward} title="Step forward 1 frame (→)" aria-label="Step forward one frame">▶</button>
        <button className="vc-icon-btn" onClick={onSkipForward} title="Skip forward 10s (Shift+L)" aria-label="Skip forward 10 seconds">⏭</button>
        <span className="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>

      <div className="controls-center">
        <label className="speed-label">Speed:</label>
        <select
          className="speed-select"
          value={playbackRate}
          onChange={(e) => onPlaybackRateChange(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {PLAYBACK_RATES.map((r) => (
            <option key={r} value={r}>{r}×</option>
          ))}
        </select>
        <button className="vc-icon-btn vc-marker-btn" onClick={onAddMarker} title="Add marker (M)" aria-label="Add marker">◆</button>
      </div>

      <div className="controls-right">
        <button className="mute-btn" onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
        </button>
        <input
          type="range" min={0} max={1} step={0.05} value={isMuted ? 0 : volume}
          onChange={(e) => onVolumeChange(Number(e.target.value))}
          className="volume-slider" aria-label="Volume"
        />
      </div>
    </div>
  );
};

export default VideoControls;
