import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AudioTrackSettings,
  AutoReframeAspect,
  ClipKeyframe,
  LumetriColor,
  TimelineClip,
  TimelineTrack,
  VideoExportOptions,
  VideoTransition,
} from '../../types';
import { formatTime } from '../../utils/videoUtils';
import {
  buildExportPlan,
  PLATFORM_PRESETS,
  suggestExportFilename,
  TRANSITION_OPTIONS,
  unwrapIpcError,
  type ExportJob,
} from '../../utils/video/exportPlan';
import {
  encoderStatusLabel,
  selectVideoEncoder,
  siblingOutputPath,
  type CreativeState,
  type DeliveryCodec,
  type EncoderChoice,
} from '../../utils/video/creative';
import { isTrackMuted, timelineClipsForExport } from '../../utils/video/exportClips';
import { resolveSourcePath } from '../../utils/video/sourcePath';
import { getPlatform } from '../../platform';
import type { MotionDocument } from '../../utils/video/motionGraphics';

interface VideoExportModalProps {
  file: File | null;
  sourcePath: string | null;
  trimStart: number;
  trimEnd: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  lumetri: LumetriColor;
  audio: AudioTrackSettings;
  autoReframe: AutoReframeAspect;
  transition: VideoTransition;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  programKeyframes?: ClipKeyframe[];
  initialPlatform: VideoExportOptions['platform'];
  initialQuality: number;
  onTransitionChange: (transition: VideoTransition) => void;
  onClose: () => void;
  creative?: CreativeState;
  graphics?: MotionDocument;
  onCreativeChange?: (creative: CreativeState, coalesceKey?: string) => void;
}

type Phase = 'idle' | 'rendering' | 'done' | 'error' | 'cancelled';

const ASPECTS: { value: AutoReframeAspect; label: string }[] = [
  { value: 'original', label: 'Original (fit)' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16 Vertical' },
  { value: '1:1', label: '1:1 Square' },
  { value: '4:5', label: '4:5 Portrait' },
  { value: '4:3', label: '4:3' },
];

function newJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

const VideoExportModal: React.FC<VideoExportModalProps> = ({
  file,
  sourcePath,
  trimStart,
  trimEnd,
  playbackRate,
  volume,
  muted,
  lumetri,
  audio,
  autoReframe,
  transition,
  clips,
  tracks,
  programKeyframes = [],
  initialPlatform,
  initialQuality,
  onTransitionChange,
  onClose,
  creative,
  graphics,
  onCreativeChange,
}) => {
  const preset = PLATFORM_PRESETS.find((item) => item.id === initialPlatform) ?? PLATFORM_PRESETS[0];
  const [platform, setPlatform] = useState(initialPlatform);
  const [resolution, setResolution] = useState<VideoExportOptions['resolution']>(preset.resolution);
  const [frameRate, setFrameRate] = useState<VideoExportOptions['frameRate']>(preset.frameRate);
  const [format, setFormat] = useState<VideoExportOptions['format']>(preset.format);
  const [codec, setCodec] = useState<DeliveryCodec>(preset.codec);
  const [encoder, setEncoder] = useState<EncoderChoice>(creative?.encoder ?? 'auto');
  const [availableEncoders, setAvailableEncoders] = useState<string[]>([]);
  const [hostPlatform, setHostPlatform] = useState('linux');
  const [quality, setQuality] = useState(initialQuality);
  const [queueLabel, setQueueLabel] = useState<string | null>(null);
  const [aspect, setAspect] = useState<AutoReframeAspect>(preset.aspect ?? autoReframe);
  const [phase, setPhase] = useState<Phase>('idle');
  const [percent, setPercent] = useState(0);
  const [timeSec, setTimeSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const setPhaseTracked = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    const bridge = getPlatform();
    if (!bridge.listVideoEncoders) return;
    let cancelled = false;
    void bridge.listVideoEncoders().then((names) => {
      if (!cancelled) setAvailableEncoders(Array.isArray(names) ? names : []);
    }).catch(() => undefined);
    void bridge.getPlatform().then((name) => {
      if (!cancelled && name) setHostPlatform(name);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const bridge = getPlatform();
    if (!bridge.onExportEvent) return;
    return bridge.onExportEvent((event) => {
      if (event.jobId !== jobIdRef.current) return;
      if (event.type === 'progress' && typeof event.percent === 'number') {
        setPercent(event.percent);
        if (typeof event.timeSec === 'number') setTimeSec(event.timeSec);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      const id = jobIdRef.current;
      if (phaseRef.current === 'rendering' && id) {
        void getPlatform().cancelVideoExport(id);
      }
    };
  }, []);

  const clipPlan = useMemo(() => timelineClipsForExport(clips, tracks), [clips, tracks]);

  const preview = useMemo(() => {
    const previewSource = sourcePath && sourcePath.length > 0 ? sourcePath : '/editpro-preview-source.mp4';
    const previewOutput = previewSource === '/editpro-preview-output.mp4'
      ? '/editpro-preview-output-alt.mp4'
      : '/editpro-preview-output.mp4';
    const job: ExportJob = {
      jobId: 'preview00-0000-4000-a000-000000000001',
      sourcePath: previewSource,
      outputPath: previewOutput,
      trimStart,
      trimEnd,
      playbackRate,
      volume,
      muted,
      videoTrackMuted: isTrackMuted(tracks, 'v1'),
      audioTrackMuted: isTrackMuted(tracks, 'a1'),
      lumetri,
      audio,
      autoReframe: aspect,
      transition,
      clips: clipPlan.clips,
      ...(programKeyframes.length > 0 ? { keyframes: programKeyframes } : {}),
      options: { resolution, frameRate, format, quality, codec, encoder, availableEncoders, platform: hostPlatform },
      ...(creative ? { creative } : {}),
      ...(graphics && (graphics.shapes.length > 0 || graphics.texts.length > 0) ? { graphics } : {}),
    };
    try {
      return { plan: buildExportPlan(job), error: null as string | null };
    } catch (err) {
      return { plan: null, error: unwrapIpcError(err) };
    }
  }, [
    sourcePath, trimStart, trimEnd, playbackRate, volume, muted, tracks,
    lumetri, audio, aspect, transition, clipPlan.clips, programKeyframes, resolution, frameRate, format, quality,
    codec, encoder, availableEncoders, hostPlatform, creative, graphics,
  ]);

  const warnings = useMemo(() => {
    const list = [...(preview.plan?.warnings ?? [])];
    if (clipPlan.skippedUnreadable > 0) {
      list.push(
        `${clipPlan.skippedUnreadable} timeline clip${clipPlan.skippedUnreadable === 1 ? '' : 's'} without a disk path will not be included. The export uses the trimmed source video.`
      );
    }
    return list;
  }, [preview.plan, clipPlan.skippedUnreadable]);

  const applyPlatform = (next: VideoExportOptions['platform']) => {
    setPlatform(next);
    const match = PLATFORM_PRESETS.find((item) => item.id === next);
    if (!match || next === 'custom') return;
    setResolution(match.resolution);
    setFrameRate(match.frameRate);
    setFormat(match.format);
    setCodec(match.codec);
    if (match.aspect) setAspect(match.aspect);
  };

  const handleExport = async () => {
    setError(null);
    setNotice(null);
    if (preview.error || !preview.plan) {
      setPhaseTracked('error');
      setError(preview.error ?? 'These export settings cannot be encoded.');
      return;
    }
    const bridge = getPlatform();
    if (bridge.exportEngine() === 'none' || !bridge.startVideoExport || !bridge.saveVideo) {
      setPhaseTracked('error');
      setError(bridge.featureStatus('ffmpeg-export').detail);
      return;
    }
    const defaultName = suggestExportFilename(file?.name ?? 'editpro.mp4', { resolution, frameRate, format });
    const chosen = await bridge.saveVideo(defaultName);
    if (!chosen) return;

    let resolvedSource = sourcePath;
    if (!resolvedSource && file) {
      resolvedSource = resolveSourcePath(file, bridge);
    }
    if (!resolvedSource && file) {
      try {
        const bytes = await file.arrayBuffer();
        resolvedSource = await bridge.materializeVideoSource(file.name, bytes);
      } catch (err) {
        setPhaseTracked('error');
        setError(unwrapIpcError(err));
        return;
      }
    }
    if (!resolvedSource) {
      setPhaseTracked('error');
      setError('Open a video from disk before exporting.');
      return;
    }

    const jobId = newJobId();
    jobIdRef.current = jobId;
    const job: ExportJob = {
      jobId,
      sourcePath: resolvedSource,
      outputPath: chosen,
      trimStart,
      trimEnd,
      playbackRate,
      volume,
      muted,
      videoTrackMuted: isTrackMuted(tracks, 'v1'),
      audioTrackMuted: isTrackMuted(tracks, 'a1'),
      lumetri,
      audio,
      autoReframe: aspect,
      transition,
      clips: clipPlan.clips,
      ...(programKeyframes.length > 0 ? { keyframes: programKeyframes } : {}),
      options: { resolution, frameRate, format, quality, codec, encoder, availableEncoders, platform: hostPlatform },
      ...(creative ? { creative } : {}),
      ...(graphics && (graphics.shapes.length > 0 || graphics.texts.length > 0) ? { graphics } : {}),
    };

    setPhaseTracked('rendering');
    setPercent(0);
    setTimeSec(0);
    try {
      const result = await bridge.startVideoExport(job);
      if (jobIdRef.current !== jobId) return;
      if (result.status === 'done') {
        setPhaseTracked('done');
        setPercent(100);
        setOutputPath(result.outputPath);
        setNotice(result.message ?? null);
      } else if (result.status === 'cancelled') {
        setPhaseTracked('cancelled');
      } else {
        setPhaseTracked('error');
        setError(result.message ?? 'Export failed.');
      }
    } catch (err) {
      if (jobIdRef.current !== jobId) return;
      setPhaseTracked('error');
      setError(unwrapIpcError(err));
    }
  };

  const addToQueue = () => {
    if (!creative || !onCreativeChange) return;
    const outputName = suggestExportFilename(file?.name ?? 'editpro.mp4', { resolution, frameRate, format });
    onCreativeChange({
      ...creative,
      encoder,
      renderQueue: [
        ...creative.renderQueue,
        { id: newJobId(), presetId: platform, encoder, codec, quality, outputName },
      ],
    });
  };

  const renderQueued = async () => {
    if (!creative || creative.renderQueue.length === 0) return;
    const bridge = getPlatform();
    if (bridge.exportEngine() === 'none' || !bridge.startVideoExport || !bridge.saveVideo) {
      setPhaseTracked('error');
      setError(bridge.featureStatus('ffmpeg-export').detail);
      return;
    }
    if (!sourcePath) {
      setPhaseTracked('error');
      setError('Open a video from disk before exporting.');
      return;
    }
    setError(null);
    setNotice(null);
    setPhaseTracked('rendering');
    setPercent(0);
    let anchor: string | null = null;
    for (let index = 0; index < creative.renderQueue.length; index += 1) {
      const item = creative.renderQueue[index];
      const itemPreset = PLATFORM_PRESETS.find((entry) => entry.id === item.presetId) ?? PLATFORM_PRESETS[0];
      setQueueLabel(`Rendering ${index + 1} of ${creative.renderQueue.length}: ${item.outputName}`);
      let chosen: string | null;
      if (anchor) {
        chosen = siblingOutputPath(anchor, item.outputName);
      } else {
        chosen = await bridge.saveVideo(item.outputName);
      }
      if (!chosen) continue;
      anchor = anchor ?? chosen;
      const jobId = newJobId();
      jobIdRef.current = jobId;
      const queued: ExportJob = {
        jobId,
        sourcePath,
        outputPath: chosen,
        trimStart,
        trimEnd,
        playbackRate,
        volume,
        muted,
        videoTrackMuted: isTrackMuted(tracks, 'v1'),
        audioTrackMuted: isTrackMuted(tracks, 'a1'),
        lumetri,
        audio,
        autoReframe: itemPreset.aspect ?? aspect,
        transition,
        clips: clipPlan.clips,
        options: {
          resolution: itemPreset.resolution,
          frameRate: itemPreset.frameRate,
          format: itemPreset.format,
          quality: item.quality,
          codec: item.codec,
          encoder: item.encoder,
          availableEncoders,
          platform: hostPlatform,
        },
        creative,
      };
      try {
        const result = await bridge.startVideoExport(queued);
        if (jobIdRef.current !== jobId) return;
        if (result.status === 'cancelled') {
          setPhaseTracked('cancelled');
          setQueueLabel(null);
          return;
        }
        if (result.status === 'error') {
          setPhaseTracked('error');
          setError(result.message ?? 'Export failed.');
          setQueueLabel(null);
          return;
        }
      } catch (err) {
        if (jobIdRef.current !== jobId) return;
        setPhaseTracked('error');
        setError(unwrapIpcError(err));
        setQueueLabel(null);
        return;
      }
    }
    setQueueLabel(null);
    setPhaseTracked('done');
    setPercent(100);
    setNotice('Render queue finished.');
  };

  const handleCancel = () => {
    if (phase === 'rendering' && jobIdRef.current) {
      void getPlatform().cancelVideoExport(jobIdRef.current);
      return;
    }
    onClose();
  };

  const busy = phase === 'rendering';
  const locked = platform !== 'custom';
  const encoderPlan = selectVideoEncoder({
    choice: encoder,
    available: availableEncoders,
    format,
    codec,
    platform: hostPlatform,
  });
  const gpuChoices = availableEncoders.filter((name) =>
    (codec === 'hevc' ? name.startsWith('hevc_') : codec === 'h264' ? name.startsWith('h264_') : false));
  const codecLabel = encoderPlan.codec === 'libx265' || encoderPlan.codec.startsWith('hevc_')
    ? 'H.265'
    : encoderPlan.codec === 'prores_ks'
      ? 'ProRes'
      : encoderPlan.codec === 'libvpx-vp9'
        ? 'VP9'
        : 'H.264';

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Video export"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleCancel();
      }}
    >
      <div className="modal export-modal">
        <h2 className="modal-title">Export Video</h2>
        <div className="modal-body">
          <p className="export-lead">
            {getPlatform().featureStatus('ffmpeg-export').summary}
          </p>
          {getPlatform().kind !== 'electron' && (
            <p className="panel-hint export-runtime-note">{getPlatform().featureStatus('ffmpeg-export').detail}</p>
          )}

          <div className="form-row">
            <label className="form-label" htmlFor="export-platform">Preset</label>
            <select
              id="export-platform"
              className="form-select"
              value={platform}
              disabled={busy}
              onChange={(event) => applyPlatform(event.target.value as VideoExportOptions['platform'])}
            >
              {PLATFORM_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="export-resolution">Resolution</label>
            <select
              id="export-resolution"
              className="form-select"
              value={resolution}
              disabled={busy || locked}
              onChange={(event) => setResolution(event.target.value as VideoExportOptions['resolution'])}
            >
              <option value="4K">4K (3840×2160)</option>
              <option value="1080p">1080p (1920×1080)</option>
              <option value="720p">720p (1280×720)</option>
              <option value="480p">480p (854×480)</option>
            </select>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="export-fps">Frame rate</label>
            <select
              id="export-fps"
              className="form-select"
              value={frameRate}
              disabled={busy || locked}
              onChange={(event) => setFrameRate(Number(event.target.value) as VideoExportOptions['frameRate'])}
            >
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="export-format">Format</label>
            <select
              id="export-format"
              className="form-select"
              value={format}
              disabled={busy || locked}
              onChange={(event) => {
                const next = event.target.value as VideoExportOptions['format'];
                setFormat(next);
                setCodec(next === 'mov' ? 'prores' : next === 'webm' ? 'vp9' : 'h264');
              }}
            >
              <option value="mp4">MP4 (H.264 + AAC)</option>
              <option value="webm">WebM (VP9 + Opus)</option>
              <option value="mov">MOV (ProRes)</option>
            </select>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="export-aspect">Frame</label>
            <select
              id="export-aspect"
              className="form-select"
              value={aspect}
              disabled={busy}
              onChange={(event) => setAspect(event.target.value as AutoReframeAspect)}
            >
              {ASPECTS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="export-transition">Transition at In / Out</label>
            <select
              id="export-transition"
              className="form-select"
              value={transition}
              disabled={busy}
              onChange={(event) => onTransitionChange(event.target.value as VideoTransition)}
            >
              {TRANSITION_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="export-encoder">Encoder</label>
            <select
              id="export-encoder"
              className="form-select"
              aria-label="Encoder"
              value={encoder}
              disabled={busy || format !== 'mp4'}
              onChange={(event) => {
                const next = event.target.value as EncoderChoice;
                setEncoder(next);
                if (creative && onCreativeChange) onCreativeChange({ ...creative, encoder: next }, 'encoder');
              }}
            >
              <option value="auto">Auto (GPU when available)</option>
              <option value="software">Software</option>
              {gpuChoices.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <p className="export-encoder-note">{encoderStatusLabel(encoder, encoderPlan)}</p>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="export-quality">Quality: {quality}%</label>
            <input
              id="export-quality"
              type="range"
              min={40}
              max={100}
              value={quality}
              disabled={busy}
              onChange={(event) => setQuality(Number(event.target.value))}
              className="slider"
              aria-label="Export quality"
            />
          </div>

          {preview.plan && (
            <div className="info-box">
              <p>
                <strong>{preview.plan.width}×{preview.plan.height}</strong>
                {' · '}
                {codecLabel}{encoderPlan.hardware ? ' GPU' : ''}
                {' · '}
                {formatTime(preview.plan.outputDurationSec)}
                {preview.plan.audioCodec ? '' : ' · no audio'}
              </p>
            </div>
          )}

          {warnings.map((warning) => (
            <div key={warning} className="info-box">{warning}</div>
          ))}

          {busy && (
            <div className="export-progress-block">
              <div
                className="export-progress"
                role="progressbar"
                aria-label="Export progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percent)}
              >
                <div className="export-progress-fill" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
              </div>
              <p className="export-progress-label">
                {queueLabel ?? `Encoding ${Math.round(percent)}%`}
                {timeSec > 0 ? ` · ${formatTime(timeSec)}` : ''}
              </p>
            </div>
          )}

          {phase === 'done' && (
            <div className="info-box" role="status">
              Exported{outputPath ? ` to ${outputPath}` : ''}.
              {notice ? ` ${notice}` : ''}
            </div>
          )}

          {phase === 'cancelled' && (
            <div className="info-box" role="status">Export cancelled. No finished file was saved.</div>
          )}

          {(phase === 'error' || preview.error) && phase !== 'rendering' && (
            <div className="export-error" role="alert">{error ?? preview.error}</div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={handleCancel} type="button">
            {busy ? 'Cancel export' : 'Close'}
          </button>
          {phase === 'done' && outputPath && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => { void getPlatform().showItemInFolder(outputPath); }}
            >
              {getPlatform().capabilities.fileSystemPaths ? 'Show in folder' : 'Download again'}
            </button>
          )}
          {creative && onCreativeChange && phase !== 'done' && (
            <>
              <button className="btn-secondary" type="button" onClick={addToQueue} disabled={busy || !!preview.error}>
                Add to queue
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => { void renderQueued(); }}
                disabled={busy || !!preview.error || creative.renderQueue.length === 0}
              >
                Render queue ({creative.renderQueue.length})
              </button>
            </>
          )}
          {phase !== 'done' && (
            <button
              className="btn-primary"
              type="button"
              onClick={() => { void handleExport(); }}
              disabled={busy || !!preview.error}
            >
              {busy ? 'Encoding…' : 'Export'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoExportModal;
