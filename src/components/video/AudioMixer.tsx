import React, { useEffect, useState } from 'react';
import type { TimelineTrack } from '../../types';
import {
  LOUDNESS_TARGETS,
  createDefaultTrackMix,
  meterLevel,
  sampleAutomation,
  trackFader,
  type CreativeState,
  type TrackMix,
} from '../../utils/video/creative';

interface AudioMixerProps {
  creative: CreativeState;
  tracks: readonly TimelineTrack[];
  currentTime: number;
  trimStart: number;
  playbackRate: number;
  peaks: readonly number[];
  mediaDuration: number;
  disabled?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  onCreativeChange: (creative: CreativeState, coalesceKey?: string) => void;
  onSetTrackMuted: (trackId: string, muted: boolean) => void;
}

const liveMeters = new WeakMap<HTMLMediaElement, AnalyserNode>();

function livePeak(video: HTMLMediaElement | null): number | null {
  if (!video || video.readyState < 2) return null;
  try {
    let analyser = liveMeters.get(video);
    if (!analyser) {
      const context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const source = context.createMediaElementSource(video);
      source.connect(analyser);
      analyser.connect(context.destination);
      liveMeters.set(video, analyser);
    }
    const bins = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(bins);
    let peak = 0;
    for (const sample of bins) {
      peak = Math.max(peak, Math.abs(sample - 128) / 128);
    }
    return peak;
  } catch {
    return null;
  }
}

function mixFor(creative: CreativeState, trackId: string): TrackMix {
  return creative.trackMix.find((item) => item.trackId === trackId) ?? createDefaultTrackMix(trackId);
}

const AudioMixer: React.FC<AudioMixerProps> = ({
  creative,
  tracks,
  currentTime,
  trimStart,
  playbackRate,
  peaks,
  mediaDuration,
  disabled,
  videoRef,
  onCreativeChange,
  onSetTrackMuted,
}) => {
  const [masterLevel, setMasterLevel] = useState(0);
  const audioTracks = tracks.filter((track) => track.type === 'audio');
  const rate = playbackRate > 0 ? playbackRate : 1;
  const outputTime = (currentTime - trimStart) / rate;

  useEffect(() => {
    const video = videoRef?.current ?? null;
    if (!video) return undefined;
    let handle = 0;
    let active = true;
    const tick = () => {
      if (!active) return;
      setMasterLevel(livePeak(video) ?? 0);
      handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      window.cancelAnimationFrame(handle);
    };
  }, [videoRef]);

  const write = (trackId: string, partial: Partial<TrackMix>, key?: string) => {
    const current = mixFor(creative, trackId);
    const next = { ...current, ...partial };
    onCreativeChange({
      ...creative,
      trackMix: [...creative.trackMix.filter((item) => item.trackId !== trackId), next],
    }, key);
  };

  return (
    <div className="audio-mixer" aria-label="Audio mixer">
      <p className="section-subtitle">Mixer</p>
      <div className="mixer-meter" aria-label="Master meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(masterLevel * 100)}>
        <div className="mixer-meter-fill" style={{ width: `${Math.round(masterLevel * 100)}%` }} />
      </div>
      <p className="section-subtitle">Loudness</p>
      <div className="loudness-targets">
        {LOUDNESS_TARGETS.map((target) => (
          <button
            key={target}
            type="button"
            className={`tl-tool-btn${creative.loudness.targetLufs === target ? ' active' : ''}`}
            aria-pressed={creative.loudness.targetLufs === target && creative.loudness.normalizeOnExport}
            disabled={disabled}
            onClick={() => onCreativeChange({
              ...creative,
              loudness: { ...creative.loudness, targetLufs: target, normalizeOnExport: true },
            })}
          >
            {target} LUFS
          </button>
        ))}
      </div>
      <p className="panel-hint" style={{ textAlign: 'left' }}>
        Export uses ffmpeg loudnorm at {creative.loudness.targetLufs} LUFS
        {creative.loudness.normalizeOnExport ? '' : ' when normalization is on'}.
      </p>

      {audioTracks.map((track) => {
        const mix = mixFor(creative, track.id);
        const fader = trackFader(
          tracks.map((item) => ({ id: item.id, muted: item.muted })),
          creative.trackMix,
          track.id,
        );
        const ride = sampleAutomation(mix.automation, outputTime);
        const level = meterLevel(peaks, mediaDuration, currentTime, fader * ride);
        const eq = mix.eq ?? createDefaultTrackMix(track.id).eq!;
        const compressor = mix.compressor ?? createDefaultTrackMix(track.id).compressor!;
        return (
          <section key={track.id} className="mixer-track" aria-label={`${track.name} channel`}>
            <div className="tl-kf-row">
              <strong>{track.name}</strong>
              <button
                type="button"
                className={`tl-tool-btn${track.muted ? ' active' : ''}`}
                aria-label={`${track.name} channel mute`}
                aria-pressed={track.muted}
                onClick={() => onSetTrackMuted(track.id, !track.muted)}
              >
                Mute
              </button>
              <button
                type="button"
                className={`tl-tool-btn${mix.solo ? ' active' : ''}`}
                aria-label={`${track.name} channel solo`}
                aria-pressed={mix.solo}
                disabled={disabled}
                onClick={() => write(track.id, { solo: !mix.solo })}
              >
                Solo
              </button>
            </div>
            <div
              className="mixer-meter"
              role="meter"
              aria-label={`${track.name} meter`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level * 100)}
            >
              <div className="mixer-meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <label className="slider-row">
              <span className="slider-label">Fader</span>
              <input
                className="slider"
                type="range"
                aria-label={`${track.name} fader`}
                min={0}
                max={2}
                step={0.01}
                disabled={disabled}
                value={mix.volume}
                onChange={(event) => write(track.id, { volume: Number(event.target.value) }, `fader:${track.id}`)}
              />
            </label>
            <p className="section-subtitle">EQ</p>
            {([
              ['lowGain', 'Low', -12, 12],
              ['midGain', 'Mid', -12, 12],
              ['highGain', 'High', -12, 12],
            ] as const).map(([key, label, min, max]) => (
              <label key={key} className="slider-row">
                <span className="slider-label">{label}</span>
                <input
                  className="slider"
                  type="range"
                  aria-label={`${track.name} ${label} EQ`}
                  min={min}
                  max={max}
                  step={0.5}
                  disabled={disabled}
                  value={eq[key]}
                  onChange={(event) => write(track.id, { eq: { ...eq, [key]: Number(event.target.value) } }, `eq:${track.id}:${key}`)}
                />
              </label>
            ))}
            <label className="slider-row">
              <span className="slider-label">Mid frequency</span>
              <input
                className="slider"
                type="range"
                aria-label={`${track.name} mid frequency`}
                min={200}
                max={8000}
                step={10}
                disabled={disabled}
                value={eq.midFrequency}
                onChange={(event) => write(track.id, { eq: { ...eq, midFrequency: Number(event.target.value) } }, `eq:${track.id}:freq`)}
              />
            </label>
            <label className="slider-row">
              <span className="slider-label">Noise reduction</span>
              <input
                className="slider"
                type="range"
                aria-label={`${track.name} noise reduction`}
                min={0}
                max={100}
                step={1}
                disabled={disabled}
                value={mix.noiseReduction ?? 0}
                onChange={(event) => write(track.id, { noiseReduction: Number(event.target.value) }, `nr:${track.id}`)}
              />
            </label>
            <label className="toggle-row">
              <span className="slider-label">Compressor</span>
              <input
                type="checkbox"
                aria-label={`${track.name} compressor`}
                disabled={disabled}
                checked={compressor.enabled}
                onChange={(event) => write(track.id, { compressor: { ...compressor, enabled: event.target.checked } })}
              />
            </label>
            {compressor.enabled && (
              <>
                {([
                  ['threshold', 'Threshold', -40, 0, 0.5],
                  ['ratio', 'Ratio', 1, 20, 0.1],
                  ['attack', 'Attack', 1, 100, 1],
                  ['release', 'Release', 10, 1000, 5],
                  ['makeup', 'Makeup', 0, 12, 0.5],
                ] as const).map(([key, label, min, max, step]) => (
                  <label key={key} className="slider-row">
                    <span className="slider-label">{label}</span>
                    <input
                      className="slider"
                      type="range"
                      aria-label={`${track.name} compressor ${label}`}
                      min={min}
                      max={max}
                      step={step}
                      disabled={disabled}
                      value={compressor[key]}
                      onChange={(event) => write(track.id, {
                        compressor: { ...compressor, [key]: Number(event.target.value) },
                      }, `comp:${track.id}:${key}`)}
                    />
                  </label>
                ))}
              </>
            )}
            <div className="tl-kf-row">
              <button
                type="button"
                className="tl-tool-btn"
                aria-label={`${track.name} keyframe fader`}
                disabled={disabled}
                onClick={() => {
                  const existing = mix.automation ?? [];
                  const stamp = Math.max(0, outputTime).toFixed(3);
                  const base = `ride_${track.id}_${stamp}`;
                  const id = existing.some((item) => item.id === base) ? `${base}_${existing.length}` : base;
                  write(track.id, {
                    automation: [...existing, { id, time: Math.max(0, outputTime), gain: mix.volume }],
                  });
                }}
              >
                Keyframe fader
              </button>
            </div>
            {(mix.automation ?? []).map((keyframe) => (
              <label key={keyframe.id} className="slider-row">
                <span className="slider-label">{keyframe.time.toFixed(2)}s</span>
                <input
                  className="slider"
                  type="range"
                  aria-label={`${track.name} automation ${keyframe.id}`}
                  min={0}
                  max={2}
                  step={0.01}
                  disabled={disabled}
                  value={keyframe.gain}
                  onChange={(event) => write(track.id, {
                    automation: (mix.automation ?? []).map((item) => (
                      item.id === keyframe.id ? { ...item, gain: Number(event.target.value) } : item
                    )),
                  }, `auto:${keyframe.id}`)}
                />
              </label>
            ))}
          </section>
        );
      })}
    </div>
  );
};

export default AudioMixer;
