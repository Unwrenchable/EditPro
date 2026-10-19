import React from 'react';
import { resolutionLabel, type PlaybackScale } from '../../playback/frameClock';

interface PlaybackSettingsProps {
  resolution: PlaybackScale;
  useProxy: boolean;
  proxyAvailable: boolean;
  status: 'idle' | 'unavailable' | 'running' | 'ready' | 'error' | 'cancelled';
  percent: number;
  message: string | null;
  decodeLabel: string;
  previewLabel: string;
  onResolution: (scale: PlaybackScale) => void;
  onToggleProxy: () => void;
  onCancelProxy: () => void;
}

const SCALES: PlaybackScale[] = ['full', 'half', 'quarter'];

/**
 * Preview quality controls. These change what the monitor decodes.
 * Export stays on the camera original regardless of the proxy toggle.
 */
const PlaybackSettings: React.FC<PlaybackSettingsProps> = ({
  resolution,
  useProxy,
  proxyAvailable,
  status,
  percent,
  message,
  decodeLabel,
  previewLabel,
  onResolution,
  onToggleProxy,
  onCancelProxy,
}) => {
  const rounded = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="playback-settings">
      <label className="speed-label" htmlFor="playback-resolution">
        Resolution
      </label>
      <select
        id="playback-resolution"
        className="speed-select"
        value={resolution}
        onChange={(event) => onResolution(event.target.value as PlaybackScale)}
        aria-label="Playback resolution"
      >
        {SCALES.map((scale) => (
          <option key={scale} value={scale}>
            {resolutionLabel(scale)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`proxy-toggle${useProxy ? ' is-active' : ''}`}
        aria-pressed={useProxy}
        disabled={!proxyAvailable && !useProxy}
        title={proxyAvailable ? 'Preview the proxy or the original file' : 'Open a video from disk in the desktop app to build a proxy'}
        onClick={onToggleProxy}
      >
        {useProxy ? 'Proxy' : 'Original'}
      </button>
      <span className="playback-meta">{previewLabel}</span>
      <span className="playback-meta">{decodeLabel}</span>
      {status === 'running' && (
        <span className="proxy-progress-wrap">
          <progress
            className="proxy-progress"
            value={rounded}
            max={100}
            aria-label="Proxy generation"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={rounded}
          />
          <span className="playback-meta">Building proxy {rounded}%</span>
          <button type="button" className="proxy-cancel" onClick={onCancelProxy}>
            Cancel
          </button>
        </span>
      )}
      {message && (
        <span className="playback-error" role="alert">
          {message}
        </span>
      )}
      <span className="playback-meta playback-export-note">Export uses the original</span>
    </div>
  );
};

export default PlaybackSettings;
