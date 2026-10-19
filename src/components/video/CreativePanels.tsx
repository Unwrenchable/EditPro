import React, { useRef } from 'react';
import type { TimelineClip, TimelineTrack, VideoTransition } from '../../types';
import {
  TITLE_FONTS,
  TRANSITION_LIBRARY,
  createTitleFromPreset,
  type HdrTransfer,
  measureLoudness,
  normalizeLinearGain,
  parseCube,
  placeTransition,
  type ClipAudioEdit,
  type ClipTransitionKind,
  type CreativeState,
  type TitleClip,
} from '../../utils/video/creative';
import ColorWheel from './ColorWheel';
import CurveEditor from './CurveEditor';

interface CreativePanelsProps {
  creative: CreativeState;
  disabled: boolean;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  currentTime: number;
  duration: number;
  videoUrl: string | null;
  transition: VideoTransition;
  onTransitionChange: (transition: VideoTransition) => void;
  onCreativeChange: (creative: CreativeState, coalesceKey?: string) => void;
  onSetTrackMuted: (trackId: string, muted: boolean) => void;
  part: 'audio' | 'picture' | 'grade';
}

const LEGACY_TRANSITION: Partial<Record<ClipTransitionKind, VideoTransition>> = {
  'cross-dissolve': 'dissolve',
  'dip-to-black': 'dip-to-black',
  'wipe-left': 'wipe',
  'slide-left': 'slide',
};

function nearestCut(clips: readonly TimelineClip[], time: number): { outgoing: TimelineClip; incoming: TimelineClip } | null {
  const ordered = [...clips].sort((a, b) => a.startTime - b.startTime);
  let best: { outgoing: TimelineClip; incoming: TimelineClip; distance: number } | null = null;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const outgoing = ordered[index];
    const incoming = ordered[index + 1];
    if (outgoing.trackId !== incoming.trackId) continue;
    if (incoming.startTime - outgoing.endTime > 0.25) continue;
    const distance = Math.abs(outgoing.endTime - time);
    if (!best || distance < best.distance) best = { outgoing, incoming, distance };
  }
  return best;
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000).toString(36)}`;
}

const CreativePanels: React.FC<CreativePanelsProps> = ({
  creative,
  disabled,
  tracks,
  clips,
  currentTime,
  duration,
  videoUrl,
  transition,
  onTransitionChange,
  onCreativeChange,
  onSetTrackMuted,
  part,
}) => {
  const lutInput = useRef<HTMLInputElement>(null);
  const patch = (next: CreativeState, key?: string) => onCreativeChange(next, key);
  const selectedTitle = creative.titles[creative.titles.length - 1] ?? null;

  const updateTitle = (id: string, partial: Partial<TitleClip>, key?: string) => {
    patch({
      ...creative,
      titles: creative.titles.map((title) => (title.id === id ? { ...title, ...partial, preset: partial.preset ?? 'custom' } : title)),
    }, key);
  };

  const applyLibrary = (kind: ClipTransitionKind) => {
    const cut = nearestCut(clips, currentTime);
    if (cut) {
      const placed = placeTransition(clips, cut.outgoing.id, cut.incoming.id, kind);
      if (placed) {
        const without = creative.transitions.filter((item) =>
          !(item.outgoingClipId === placed.outgoingClipId && item.incomingClipId === placed.incomingClipId));
        patch({ ...creative, transitions: [...without, { ...placed, id: newId('xfade') }] });
        return;
      }
    }
    const legacy = LEGACY_TRANSITION[kind];
    if (legacy) onTransitionChange(legacy);
  };

  const measure = async () => {
    if (!videoUrl) return;
    try {
      const response = await fetch(videoUrl);
      const bytes = await response.arrayBuffer();
      const context = new AudioContext();
      const audio = await context.decodeAudioData(bytes.slice(0));
      const reading = measureLoudness(audio.getChannelData(0), audio.sampleRate);
      await context.close();
      patch({ ...creative, loudness: { ...creative.loudness, measuredLufs: reading.integrated } });
    } catch {
      patch({ ...creative, loudness: { ...creative.loudness, measuredLufs: null } });
    }
  };

  const importLut = async (file: File) => {
    const text = await file.text();
    const lut = parseCube(text);
    if (!lut) return;
    patch({ ...creative, lut: { ...lut, title: file.name.replace(/\.cube$/i, '') || lut.title } });
  };

  const makeup = normalizeLinearGain(creative.loudness);

  const writeClipAudio = (clipId: string, partial: Partial<ClipAudioEdit>, key: string) => {
    const current = creative.clipAudio.find((item) => item.clipId === clipId)
      ?? { clipId, volume: 1, fadeIn: 0, fadeOut: 0, keyframes: [] };
    const next = { ...current, ...partial };
    patch({
      ...creative,
      clipAudio: [...creative.clipAudio.filter((item) => item.clipId !== clipId), next],
    }, key);
  };

  return (
    <div className="creative-panels">
      {part === 'audio' && (
      <>
      <p className="section-subtitle">Mixer</p>
      <label className="slider-row">
        <div className="slider-header">
          <span className="slider-label">Clip volume</span>
          <span className="slider-value">{Math.round(creative.programAudio.volume * 100)}%</span>
        </div>
        <input
          className="slider"
          type="range"
          min={0}
          max={2}
          step={0.01}
          aria-label="Clip volume"
          disabled={disabled}
          value={creative.programAudio.volume}
          onChange={(event) => patch({
            ...creative,
            programAudio: { ...creative.programAudio, volume: Number(event.target.value) },
          }, 'program-volume')}
        />
      </label>
      <div className="creative-inline">
        <label>
          Fade in
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            aria-label="Audio fade in"
            disabled={disabled}
            value={creative.programAudio.fadeIn}
            onChange={(event) => patch({
              ...creative,
              programAudio: { ...creative.programAudio, fadeIn: Number(event.target.value) },
            }, 'fade-in')}
          />
        </label>
        <label>
          Fade out
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            aria-label="Audio fade out"
            disabled={disabled}
            value={creative.programAudio.fadeOut}
            onChange={(event) => patch({
              ...creative,
              programAudio: { ...creative.programAudio, fadeOut: Number(event.target.value) },
            }, 'fade-out')}
          />
        </label>
      </div>
      <button
        type="button"
        className="tl-tool-btn"
        disabled={disabled}
        onClick={() => {
          const local = Math.max(0, currentTime);
          const keyframes = [
            ...creative.programAudio.keyframes.filter((key) => Math.abs(key.time - local) > 0.05),
            { id: newId('kf'), time: Number(local.toFixed(3)), gain: 1 },
          ];
          patch({ ...creative, programAudio: { ...creative.programAudio, keyframes } });
        }}
      >
        Add volume keyframe
      </button>
      {creative.programAudio.keyframes.length > 0 && (
        <ul className="keyframe-list">
          {creative.programAudio.keyframes.map((key) => (
            <li key={key.id}>
              <span>{key.time.toFixed(2)}s</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                aria-label={`Volume keyframe at ${key.time.toFixed(2)} seconds`}
                value={key.gain}
                disabled={disabled}
                onChange={(event) => patch({
                  ...creative,
                  programAudio: {
                    ...creative.programAudio,
                    keyframes: creative.programAudio.keyframes.map((item) =>
                      item.id === key.id ? { ...item, gain: Number(event.target.value) } : item),
                  },
                }, `kf:${key.id}`)}
              />
            </li>
          ))}
        </ul>
      )}
      {clips.length > 0 && (
        <>
          <p className="section-subtitle">Timeline clip volume</p>
          {clips.map((clip, index) => {
            const audio = creative.clipAudio.find((item) => item.clipId === clip.id);
            const volume = audio?.volume ?? 1;
            return (
              <label key={clip.id} className="slider-row">
                <div className="slider-header">
                  <span className="slider-label">Clip {index + 1}</span>
                  <span className="slider-value">{Math.round(volume * 100)}%</span>
                </div>
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={2}
                  step={0.01}
                  aria-label={`Timeline clip ${index + 1} volume`}
                  disabled={disabled}
                  value={volume}
                  onChange={(event) => writeClipAudio(clip.id, { volume: Number(event.target.value) }, `clip-volume:${clip.id}`)}
                />
              </label>
            );
          })}
        </>
      )}
      <div className="mixer-tracks">
        {tracks.map((track) => {
          const mix = creative.trackMix.find((item) => item.trackId === track.id) ?? { trackId: track.id, volume: 1, solo: false };
          const write = (partial: Partial<typeof mix>, key: string) => {
            const next = { ...mix, ...partial };
            const others = creative.trackMix.filter((item) => item.trackId !== track.id);
            patch({ ...creative, trackMix: [...others, next] }, key);
          };
          return (
            <div key={track.id} className="mixer-row">
              <span>{track.name}</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                aria-label={`${track.name} volume`}
                value={mix.volume}
                disabled={disabled}
                onChange={(event) => write({ volume: Number(event.target.value) }, `mix:${track.id}`)}
              />
              <button
                type="button"
                className={`tl-hd-btn${track.muted ? ' active' : ''}`}
                aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                aria-pressed={track.muted}
                onClick={() => onSetTrackMuted(track.id, !track.muted)}
              >
                M
              </button>
              <button
                type="button"
                className={`tl-hd-btn${mix.solo ? ' active' : ''}`}
                aria-label={mix.solo ? `Unsolo ${track.name}` : `Solo ${track.name}`}
                aria-pressed={mix.solo}
                onClick={() => write({ solo: !mix.solo }, `solo:${track.id}`)}
              >
                S
              </button>
            </div>
          );
        })}
      </div>

      <p className="section-subtitle">Loudness</p>
      <p className="panel-hint" style={{ textAlign: 'left' }}>
        {creative.loudness.measuredLufs === null
          ? 'Integrated loudness has not been measured.'
          : `Integrated ${creative.loudness.measuredLufs.toFixed(1)} LUFS`}
        {creative.loudness.normalizeOnExport && creative.loudness.measuredLufs !== null
          ? ` · makeup ${makeup.toFixed(2)}× toward ${creative.loudness.targetLufs} LUFS`
          : ''}
      </p>
      <div className="creative-inline">
        <button type="button" className="tl-tool-btn" disabled={disabled || !videoUrl} onClick={() => { void measure(); }}>
          Measure LUFS
        </button>
        <label>
          Target
          <input
            type="number"
            aria-label="Loudness target"
            min={-36}
            max={-5}
            step={1}
            disabled={disabled}
            value={creative.loudness.targetLufs}
            onChange={(event) => patch({
              ...creative,
              loudness: { ...creative.loudness, targetLufs: Number(event.target.value) },
            }, 'lufs-target')}
          />
        </label>
      </div>
      <label className="toggle-row">
        <span className="slider-label">Normalize on export</span>
        <input
          type="checkbox"
          aria-label="Normalize on export"
          disabled={disabled}
          checked={creative.loudness.normalizeOnExport}
          onChange={(event) => patch({
            ...creative,
            loudness: { ...creative.loudness, normalizeOnExport: event.target.checked },
          })}
        />
      </label>

      </>
      )}
      {part === 'picture' && (
      <>
      <p className="section-subtitle">Titles</p>
      <div className="effects-grid">
        {(['lower-third', 'center-title', 'fade-credit', 'pop-in'] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            className="effect-btn"
            disabled={disabled}
            onClick={() => {
              const title = createTitleFromPreset(preset, currentTime, Math.min(4, Math.max(1, duration || 4)));
              patch({ ...creative, titles: [...creative.titles, { ...title, id: newId('title') }] });
            }}
          >
            {preset.replace('-', ' ')}
          </button>
        ))}
      </div>
      {selectedTitle && (
        <div className="title-editor">
          <label>
            Text
            <input
              aria-label="Title text"
              value={selectedTitle.text}
              disabled={disabled}
              onChange={(event) => updateTitle(selectedTitle.id, { text: event.target.value }, 'title-text')}
            />
          </label>
          <label>
            Font
            <select
              aria-label="Title font"
              value={TITLE_FONTS.find((font) => font.css === selectedTitle.fontFamily)?.css ?? TITLE_FONTS[0].css}
              disabled={disabled}
              onChange={(event) => updateTitle(selectedTitle.id, { fontFamily: event.target.value })}
            >
              {TITLE_FONTS.map((font) => (
                <option key={font.id} value={font.css}>{font.label}</option>
              ))}
            </select>
          </label>
          <label>
            Color
            <input aria-label="Title color" type="color" value={selectedTitle.color} disabled={disabled} onChange={(event) => updateTitle(selectedTitle.id, { color: event.target.value }, 'title-color')} />
          </label>
          <label>
            Stroke
            <input aria-label="Title stroke color" type="color" value={selectedTitle.strokeColor} disabled={disabled} onChange={(event) => updateTitle(selectedTitle.id, { strokeColor: event.target.value }, 'title-stroke')} />
          </label>
          <label>
            Shadow
            <input aria-label="Title shadow color" type="color" value={selectedTitle.shadowColor} disabled={disabled} onChange={(event) => updateTitle(selectedTitle.id, { shadowColor: event.target.value }, 'title-shadow')} />
          </label>
          <label className="slider-row">
            <span className="slider-label">Stroke width</span>
            <input className="slider" type="range" min={0} max={2} step={0.05} aria-label="Title stroke width" value={selectedTitle.strokeWidth} disabled={disabled} onChange={(event) => updateTitle(selectedTitle.id, { strokeWidth: Number(event.target.value) }, 'title-stroke-width')} />
          </label>
          <label className="slider-row">
            <span className="slider-label">Shadow blur</span>
            <input className="slider" type="range" min={0} max={2} step={0.05} aria-label="Title shadow blur" value={selectedTitle.shadowBlur} disabled={disabled} onChange={(event) => updateTitle(selectedTitle.id, { shadowBlur: Number(event.target.value) }, 'title-shadow-blur')} />
          </label>
          <label className="slider-row">
            <span className="slider-label">Size</span>
            <input className="slider" type="range" min={2} max={20} step={0.5} aria-label="Title size" value={selectedTitle.fontSize} disabled={disabled} onChange={(event) => updateTitle(selectedTitle.id, { fontSize: Number(event.target.value) }, 'title-size')} />
          </label>
          <label className="slider-row">
            <span className="slider-label">Horizontal</span>
            <input className="slider" type="range" min={0} max={1} step={0.01} aria-label="Title horizontal position" value={selectedTitle.x} disabled={disabled} onChange={(event) => updateTitle(selectedTitle.id, { x: Number(event.target.value) }, 'title-x')} />
          </label>
          <label className="slider-row">
            <span className="slider-label">Vertical</span>
            <input className="slider" type="range" min={0} max={1} step={0.01} aria-label="Title vertical position" value={selectedTitle.y} disabled={disabled} onChange={(event) => updateTitle(selectedTitle.id, { y: Number(event.target.value) }, 'title-y')} />
          </label>
          <button type="button" className="tl-tool-btn" onClick={() => patch({ ...creative, titles: creative.titles.filter((title) => title.id !== selectedTitle.id) })}>
            Remove title
          </button>
        </div>
      )}

      <p className="section-subtitle">Transitions</p>
      <p className="panel-hint" style={{ textAlign: 'left' }}>
        Drag a transition onto the cut between two clips. Click applies it to the cut nearest the playhead.
        {transition !== 'cut' ? ` Program edges use ${transition}.` : ''}
      </p>
      <div className="effects-grid">
        {TRANSITION_LIBRARY.map((item) => (
          <button
            key={item.id}
            type="button"
            className="effect-btn"
            draggable={!disabled}
            disabled={disabled}
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-editpro-transition', item.id);
              event.dataTransfer.setData('text/plain', item.id);
            }}
            onClick={() => applyLibrary(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      </>
      )}
      {part === 'grade' && (
      <>
      <p className="section-subtitle">Lift / Gamma / Gain</p>
      <div className="color-wheel-row">
        {([
          { id: 'lift', neutral: 0, min: -1, max: 1 },
          { id: 'gamma', neutral: 1, min: 0.2, max: 3 },
          { id: 'gain', neutral: 1, min: 0, max: 4 },
        ] as const).map((wheel) => (
          <ColorWheel
            key={wheel.id}
            label={wheel.id}
            rgb={creative.liftGammaGain[wheel.id]}
            neutral={wheel.neutral}
            min={wheel.min}
            max={wheel.max}
            disabled={disabled}
            onChange={(rgb) => patch({
              ...creative,
              liftGammaGain: { ...creative.liftGammaGain, [wheel.id]: rgb },
            }, `lgg-wheel:${wheel.id}`)}
          />
        ))}
      </div>
      {(['lift', 'gamma', 'gain'] as const).map((wheel) => (
        <fieldset key={wheel} className="lgg-wheel">
          <legend>{wheel}</legend>
          {(['r', 'g', 'b'] as const).map((channel) => (
            <label key={channel} className="slider-row">
              <span className="slider-label">{channel.toUpperCase()}</span>
              <input
                className="slider"
                type="range"
                aria-label={`${wheel} ${channel}`}
                min={wheel === 'lift' ? -1 : wheel === 'gamma' ? 0.2 : 0}
                max={wheel === 'lift' ? 1 : wheel === 'gamma' ? 3 : 4}
                step={0.01}
                disabled={disabled}
                value={creative.liftGammaGain[wheel][channel]}
                onChange={(event) => patch({
                  ...creative,
                  liftGammaGain: {
                    ...creative.liftGammaGain,
                    [wheel]: { ...creative.liftGammaGain[wheel], [channel]: Number(event.target.value) },
                  },
                }, `lgg:${wheel}.${channel}`)}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <button
        type="button"
        className="reset-btn"
        disabled={disabled}
        onClick={() => patch({
          ...creative,
          liftGammaGain: { lift: { r: 0, g: 0, b: 0 }, gamma: { r: 1, g: 1, b: 1 }, gain: { r: 1, g: 1, b: 1 } },
          lut: null,
          lutStrength: 1,
        })}
      >
        Reset wheels and LUT
      </button>

      <p className="section-subtitle">RGB / Luma curves</p>
      <CurveEditor
        curves={creative.curves}
        disabled={disabled}
        onChange={(curves, key) => patch({ ...creative, curves }, key)}
      />

      <p className="section-subtitle">HDR</p>
      <label className="tl-kf-ease">
        Transfer
        <select
          aria-label="HDR transfer"
          disabled={disabled}
          value={creative.hdr.transfer}
          onChange={(event) => patch({
            ...creative,
            hdr: { ...creative.hdr, transfer: event.target.value as HdrTransfer },
          })}
        >
          <option value="sdr">SDR</option>
          <option value="pq">PQ (HDR10)</option>
          <option value="hlg">HLG</option>
        </select>
      </label>
      <label className="toggle-row">
        <span className="slider-label">Tone-map preview</span>
        <input
          type="checkbox"
          aria-label="Tone-map preview"
          disabled={disabled || creative.hdr.transfer === 'sdr'}
          checked={creative.hdr.toneMapPreview}
          onChange={(event) => patch({
            ...creative,
            hdr: { ...creative.hdr, toneMapPreview: event.target.checked },
          })}
        />
      </label>
      <p className="panel-hint" style={{ textAlign: 'left' }}>
        PQ and HLG write BT.2020 transfer metadata on export. Tone-map preview only changes the monitor.
      </p>

      <p className="section-subtitle">Cube LUT</p>
      <input
        ref={lutInput}
        type="file"
        accept=".cube,text/plain"
        className="hidden-input"
        aria-label="Import cube LUT"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importLut(file);
          event.target.value = '';
        }}
      />
      <button type="button" className="tl-tool-btn" disabled={disabled} onClick={() => lutInput.current?.click()}>
        Import .cube
      </button>
      {creative.lut && (
        <>
          <p className="panel-hint" style={{ textAlign: 'left' }}>
            {creative.lut.title} · {creative.lut.size}³
          </p>
          <label className="slider-row">
            <span className="slider-label">LUT strength</span>
            <input
              className="slider"
              type="range"
              aria-label="LUT strength"
              min={0}
              max={1}
              step={0.01}
              disabled={disabled}
              value={creative.lutStrength}
              onChange={(event) => patch({ ...creative, lutStrength: Number(event.target.value) }, 'lut-strength')}
            />
          </label>
        </>
      )}
      </>
      )}
    </div>
  );
};

export default CreativePanels;
