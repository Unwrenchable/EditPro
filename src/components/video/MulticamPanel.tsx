import React, { useEffect, useRef, useState } from 'react';
import type { TimelineClip } from '../../types';
import type { ProxyCacheStatus } from '../../types/electron';
import { isTextEditingTarget } from '../../utils/editorShortcuts';
import { fileMediaPath } from '../../utils/mediaFiles';
import {
  activeAngle,
  addMulticamAngles,
  applySyncOffsets,
  energyEnvelope,
  mediaBaseName,
  multicamToClips,
  refineCuts,
  sourceTimeAt,
  switchAngle,
  syncAngleOffsets,
  type AudioTake,
  type MulticamSequence,
} from '../../utils/video/multicam';
import { planMediaRelink, type MediaRelinkCandidate } from '../../utils/video/proxyPolicy';

interface MulticamPanelProps {
  sequence: MulticamSequence | null;
  currentTime: number;
  isPlaying: boolean;
  duration: number;
  frameRate: number;
  mediaPath: string | null;
  mediaName: string | null;
  mediaMissing: boolean;
  programUrl: string | null;
  advice: string | null;
  onChange: (sequence: MulticamSequence | null) => void;
  onCommit: (clips: TimelineClip[]) => void;
  onRelinkFile: (file: File) => void;
}

const LIMITS = [5, 10, 20, 50, 100];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

async function decodeTake(file: File): Promise<AudioTake> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    return { samples: audio.getChannelData(0), sampleRate: audio.sampleRate };
  } finally {
    await context.close();
  }
}

const MulticamPanel: React.FC<MulticamPanelProps> = ({
  sequence,
  currentTime,
  isPlaying,
  duration,
  frameRate,
  mediaPath,
  mediaName,
  mediaMissing,
  programUrl,
  advice,
  onChange,
  onCommit,
  onRelinkFile,
}) => {
  const angleInput = useRef<HTMLInputElement>(null);
  const relinkInput = useRef<HTMLInputElement>(null);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const [filesById, setFilesById] = useState<Record<string, File>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [live, setLive] = useState(true);
  const [mode, setMode] = useState<'gap' | 'onset'>('gap');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cache, setCache] = useState<ProxyCacheStatus | null>(null);
  const [relinkNote, setRelinkNote] = useState<string | null>(null);

  const refreshCache = async () => {
    const bridge = window.editpro;
    if (!bridge?.getProxyCache) return;
    try {
      setCache(await bridge.getProxyCache());
    } catch {
      setCache(null);
    }
  };

  useEffect(() => {
    void refreshCache();
  }, []);

  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  useEffect(() => () => {
    for (const url of Object.values(urlsRef.current)) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
  }, []);

  const active = sequence ? activeAngle(sequence, currentTime) : null;

  useEffect(() => {
    if (!sequence) return;
    for (const angle of sequence.angles) {
      const element = videos.current.get(angle.id);
      if (!element) continue;
      const target = sourceTimeAt(angle, currentTime);
      if (Number.isFinite(element.duration) && element.duration > 0 && Math.abs(element.currentTime - target) > 0.12) {
        try {
          element.currentTime = Math.min(target, Math.max(0, element.duration - 0.04));
        } catch {
          // The element is not ready to seek yet.
        }
      }
      element.muted = angle.id !== active?.id;
      if (isPlaying && element.paused) void element.play().catch(() => undefined);
      if (!isPlaying && !element.paused) element.pause();
    }
  }, [sequence, currentTime, isPlaying, active?.id]);

  useEffect(() => {
    if (!live || !sequence || sequence.angles.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (isTextEditingTarget(event.target)) return;
      if (!/^[1-9]$/.test(event.key)) return;
      const angle = sequence.angles[Number(event.key) - 1];
      if (!angle) return;
      event.preventDefault();
      onChange(switchAngle(sequence, currentTime, angle.id, frameRate));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live, sequence, currentTime, frameRate, onChange]);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming: { id: string; name: string; src: string }[] = [];
    const nextFiles = { ...filesById };
    const nextUrls = { ...urls };
    for (const file of Array.from(list)) {
      const src = window.editpro?.getPathForFile(file) || fileMediaPath(file) || file.name;
      const id = `cam_${mediaBaseName(src).replace(/[^\w.-]+/g, '_')}_${file.size.toString(36)}`;
      if (incoming.some((angle) => angle.src === src)) continue;
      incoming.push({ id, name: file.name, src });
      nextFiles[id] = file;
      if (nextUrls[id]) URL.revokeObjectURL(nextUrls[id]);
      nextUrls[id] = URL.createObjectURL(file);
    }
    setFilesById(nextFiles);
    setUrls(nextUrls);
    onChange(addMulticamAngles(sequence, incoming));
  };

  const addProgram = () => {
    if (!mediaPath && !mediaName) return;
    const src = mediaPath || mediaName || 'program';
    onChange(addMulticamAngles(sequence, [{ id: 'program', name: mediaName || mediaBaseName(src), src }]));
  };

  const sync = async () => {
    if (!sequence || sequence.angles.length < 2) return;
    const reference = sequence.angles.find((angle) => angle.id === sequence.referenceId) ?? sequence.angles[0];
    const referenceFile = filesById[reference.id];
    if (!referenceFile) {
      setStatus('Add the camera files in this session before syncing. Saved paths are kept for the timeline.');
      return;
    }
    setBusy(true);
    setStatus('Correlating camera audio…');
    try {
      const referenceTake = await decodeTake(referenceFile);
      const others: (AudioTake & { id: string })[] = [];
      for (const angle of sequence.angles) {
        if (angle.id === reference.id) continue;
        const file = filesById[angle.id];
        if (!file) continue;
        others.push({ id: angle.id, ...(await decodeTake(file)) });
      }
      if (others.length === 0) {
        setStatus('Each angle needs its file loaded in this session to sync.');
        return;
      }
      const offsets = syncAngleOffsets({ id: reference.id, ...referenceTake }, others);
      onChange(applySyncOffsets(sequence, offsets));
      const weak = offsets.filter((offset) => offset.confidence < 0.35);
      setStatus(weak.length > 0 ? 'Sync applied. A low score means those angles may still need a manual nudge.' : 'Angles synced to the reference audio.');
    } catch {
      setStatus('EditPro could not read audio from one of the angles.');
    } finally {
      setBusy(false);
    }
  };

  const refine = async () => {
    if (!sequence) return;
    const reference = sequence.angles.find((angle) => angle.id === sequence.referenceId) ?? sequence.angles[0];
    const file = reference ? filesById[reference.id] : undefined;
    setBusy(true);
    try {
      if (!file) {
        onChange(refineCuts(sequence, { sampleRate: frameRate, values: [] }, { frameRate, mode }));
        setStatus('Cuts snapped to frames. Load the reference audio to chase pauses.');
        return;
      }
      const take = await decodeTake(file);
      onChange(refineCuts(sequence, energyEnvelope(take.samples, take.sampleRate), { frameRate, mode, windowSec: 0.45 }));
      setStatus(mode === 'gap' ? 'Cuts moved toward the quietest nearby point.' : 'Cuts moved toward the nearest audio onset.');
    } catch {
      setStatus('Cut refinement could not read the reference audio.');
    } finally {
      setBusy(false);
    }
  };

  const chooseRelink = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list);
    const needs = [
      ...(mediaMissing && mediaName ? [{ id: 'program', name: mediaName, size: null, durationSec: duration > 0 ? duration : null }] : []),
      ...(sequence?.angles ?? []).filter((angle) => !filesById[angle.id]).map((angle) => ({
        id: angle.id,
        name: mediaBaseName(angle.src),
        size: null,
        durationSec: null,
      })),
    ];
    const candidates: (MediaRelinkCandidate & { file: File })[] = files.map((file, index) => ({
      id: `pick_${index}`,
      name: file.name,
      size: file.size,
      durationSec: null,
      file,
    }));
    const matches = planMediaRelink(needs, candidates);
    if (matches.length === 0) {
      setRelinkNote('No file name matched the offline media.');
      return;
    }
    const program = matches.find((match) => match.needId === 'program');
    if (program) {
      const file = candidates.find((candidate) => candidate.id === program.candidateId)?.file;
      if (file) onRelinkFile(file);
    }
    const nextFiles = { ...filesById };
    const nextUrls = { ...urls };
    for (const match of matches) {
      if (match.needId === 'program') continue;
      const file = candidates.find((candidate) => candidate.id === match.candidateId)?.file;
      if (!file) continue;
      nextFiles[match.needId] = file;
      if (nextUrls[match.needId]) URL.revokeObjectURL(nextUrls[match.needId]);
      nextUrls[match.needId] = URL.createObjectURL(file);
    }
    setFilesById(nextFiles);
    setUrls(nextUrls);
    setRelinkNote(matches.map((match) => `${match.needId}: ${match.reason}`).join(' · '));
    const bridge = window.editpro;
    if (bridge?.relinkProxyCache) {
      const paths = files.map((file) => bridge.getPathForFile(file)).filter((item) => item.length > 0);
      if (paths.length > 0) {
        void bridge.relinkProxyCache(paths).then((result) => {
          setCache(result.status);
          setRelinkNote((prev) => `${prev ?? ''} Proxy cache relinked ${result.moved}.`.trim());
        }).catch(() => undefined);
      }
    }
  };

  const setLimit = (gigabytes: number) => {
    void window.editpro?.setProxyCachePolicy?.({ maxBytes: gigabytes * 1024 * 1024 * 1024 })?.then(setCache).catch(() => undefined);
  };

  return (
    <section className="multicam-panel" aria-label="Multicam">
      <div className="multicam-heading">
        <h2>Multicam</h2>
        <label className="multicam-live">
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
            aria-label="Live angle switching"
          />
          Live switching
        </label>
      </div>
      <p className="panel-hint">Sync lines the angles up by audio. Keys 1–9 cut to that angle while you play.</p>
      <div className="creative-inline">
        <button type="button" className="tl-tool-btn" onClick={addProgram} disabled={!mediaPath && !mediaName}>
          Add program
        </button>
        <button type="button" className="tl-tool-btn" onClick={() => angleInput.current?.click()}>
          Add angles
        </button>
        <button type="button" className="tl-tool-btn" onClick={() => void sync()} disabled={busy || (sequence?.angles.length ?? 0) < 2}>
          Sync audio
        </button>
        <button type="button" className="tl-tool-btn" onClick={() => void refine()} disabled={busy || (sequence?.cuts.length ?? 0) < 2}>
          Refine cuts
        </button>
        <label>
          Refine to
          <select aria-label="Cut refinement mode" value={mode} onChange={(event) => setMode(event.target.value as 'gap' | 'onset')}>
            <option value="gap">Pause</option>
            <option value="onset">Onset</option>
          </select>
        </label>
        <button
          type="button"
          className="tl-tool-btn"
          disabled={!sequence || sequence.cuts.length === 0}
          onClick={() => sequence && onCommit(multicamToClips(sequence, duration || currentTime, 'v-multicam'))}
        >
          Commit cuts
        </button>
        <button type="button" className="tl-tool-btn" disabled={!sequence} onClick={() => onChange(null)}>
          Clear
        </button>
      </div>
      <input
        ref={angleInput}
        type="file"
        accept="video/*,audio/*"
        multiple
        className="hidden-input"
        aria-label="Add multicam angles"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {sequence && sequence.angles.length > 0 && (
        <div className="multicam-bank">
          {sequence.angles.map((angle, index) => {
            const selected = active?.id === angle.id;
            const preview = urls[angle.id] || (angle.id === 'program' ? programUrl : null);
            return (
              <button
                key={angle.id}
                type="button"
                className={`multicam-angle${selected ? ' is-active' : ''}`}
                aria-pressed={selected}
                aria-label={`Switch to ${angle.name}`}
                onClick={() => onChange(switchAngle(sequence, currentTime, angle.id, frameRate))}
              >
                <span className="multicam-key">{index + 1}</span>
                {preview && (
                  <video
                    ref={(node) => {
                      if (node) videos.current.set(angle.id, node);
                      else videos.current.delete(angle.id);
                    }}
                    src={preview}
                    muted
                    playsInline
                    preload="auto"
                    aria-hidden="true"
                  />
                )}
                <span className="multicam-name">{angle.name}</span>
                <span className="multicam-meta">
                  {angle.id === sequence.referenceId ? 'Reference' : `${angle.syncOffset >= 0 ? '+' : ''}${angle.syncOffset.toFixed(3)}s`}
                  {angle.id !== sequence.referenceId && angle.confidence < 0.35 ? ' · low' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {sequence && sequence.cuts.length > 1 && (
        <ol className="multicam-cuts">
          {sequence.cuts.map((cut) => (
            <li key={cut.id}>
              {cut.time.toFixed(2)}s → {sequence.angles.find((angle) => angle.id === cut.angleId)?.name ?? cut.angleId}
            </li>
          ))}
        </ol>
      )}
      {status && <p className="playback-meta">{status}</p>}

      <div className="multicam-cache">
        <h3>Proxy cache</h3>
        <p className="panel-hint">{advice ?? 'Auto proxy follows frame size, codec, duration, and file size. Export stays on the original.'}</p>
        <p className="playback-meta">
          {cache
            ? `${formatBytes(cache.usedBytes)} of ${formatBytes(cache.maxBytes)} · ${cache.items} proxies · ${cache.partials} partial`
            : 'Cache tools run in the desktop app.'}
        </p>
        <div className="creative-inline">
          {LIMITS.map((gigabytes) => (
            <button key={gigabytes} type="button" className="tl-tool-btn" onClick={() => setLimit(gigabytes)} aria-label={`Limit proxy cache to ${gigabytes} gigabytes`}>
              {gigabytes} GB
            </button>
          ))}
          <button
            type="button"
            className="tl-tool-btn"
            onClick={() => {
              void window.editpro?.setProxyCachePolicy?.({ auto: !(cache?.auto ?? true) }).then(setCache).catch(() => undefined);
            }}
          >
            Auto proxy {cache?.auto === false ? 'off' : 'on'}
          </button>
          <button type="button" className="tl-tool-btn" onClick={() => void window.editpro?.cleanupProxyCache?.().then(setCache).catch(() => undefined)}>
            Clean up
          </button>
          <button type="button" className="tl-tool-btn" onClick={() => relinkInput.current?.click()}>
            Relink
          </button>
        </div>
        <input
          ref={relinkInput}
          type="file"
          accept="video/*,audio/*"
          multiple
          className="hidden-input"
          aria-label="Relink offline media"
          onChange={(event) => {
            chooseRelink(event.target.files);
            event.target.value = '';
          }}
        />
        {relinkNote && <p className="playback-meta">{relinkNote}</p>}
        {cache && cache.entries.length > 0 && (
          <ul className="multicam-cuts">
            {cache.entries.slice(0, 6).map((entry) => (
              <li key={entry.id}>
                {entry.sourceName ?? 'Proxy'} · {entry.scale ?? 'partial'} · {formatBytes(entry.bytes)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default MulticamPanel;
