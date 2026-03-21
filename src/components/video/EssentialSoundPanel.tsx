import React from 'react';
import type { AudioTrackSettings, AudioCategory } from '../../types';

interface SliderRowProps {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void; disabled?: boolean; unit?: string;
}
const SliderRow: React.FC<SliderRowProps> = ({ label, value, min, max, onChange, disabled, unit }) => (
  <div className="slider-row">
    <div className="slider-header">
      <span className="slider-label">{label}</span>
      <span className="slider-value">{value > 0 ? `+${value}` : value}{unit ?? ''}</span>
    </div>
    <input type="range" min={min} max={max} value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="slider" aria-label={label} disabled={disabled} />
  </div>
);

interface ToggleRowProps {
  label: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean; description?: string;
}
const ToggleRow: React.FC<ToggleRowProps> = ({ label, checked, onChange, disabled, description }) => (
  <div className="toggle-row">
    <div className="toggle-info">
      <span className="slider-label">{label}</span>
      {description && <span className="toggle-desc">{description}</span>}
    </div>
    <label className={`toggle-switch${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="toggle-thumb" />
    </label>
  </div>
);

interface EssentialSoundPanelProps {
  audio: AudioTrackSettings;
  disabled: boolean;
  onChange: (key: keyof AudioTrackSettings, value: number | boolean | AudioCategory) => void;
}

const CATEGORIES: { id: AudioCategory; label: string; icon: string }[] = [
  { id: 'dialogue', label: 'Dialogue', icon: '🎙' },
  { id: 'music',    label: 'Music',    icon: '🎵' },
  { id: 'sfx',      label: 'SFX',      icon: '💥' },
  { id: 'ambience', label: 'Ambience', icon: '🌊' },
];

const EssentialSoundPanel: React.FC<EssentialSoundPanelProps> = ({ audio, disabled, onChange }) => {
  const { category } = audio;

  return (
    <div>
      {/* Audio Type selector */}
      <div className="sound-categories">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            className={`sound-cat-btn${category === cat.id ? ' active' : ''}`}
            onClick={() => onChange('category', cat.id)}
            disabled={disabled}
          >
            <span className="sound-cat-icon">{cat.icon}</span>
            <span className="sound-cat-label">{cat.label}</span>
          </button>
        ))}
      </div>

      <div className="panel-body" style={{ paddingTop: 10 }}>
        {/* ── Repair ── */}
        <p className="section-subtitle">Repair</p>
        <SliderRow
          label="Noise Reduction" value={audio.noiseReduction} min={0} max={100}
          onChange={(v) => onChange('noiseReduction', v)} disabled={disabled}
        />
        {(category === 'dialogue' || category === 'sfx') && (
          <SliderRow
            label="De-Reverb" value={audio.deReverb} min={0} max={100}
            onChange={(v) => onChange('deReverb', v)} disabled={disabled}
          />
        )}
        {category === 'dialogue' && (
          <SliderRow
            label="Clarity (Enhance Speech)" value={audio.clarity} min={0} max={100}
            onChange={(v) => onChange('clarity', v)} disabled={disabled}
          />
        )}
        <ToggleRow
          label="Low Cut (remove rumble)" checked={audio.lowCut}
          onChange={(v) => onChange('lowCut', v)} disabled={disabled}
          description="Cuts frequencies below 80 Hz"
        />

        {/* ── Volume ── */}
        <p className="section-subtitle" style={{ marginTop: 12 }}>Volume</p>
        <SliderRow
          label="Loudness" value={audio.loudness} min={-20} max={0} unit=" dB"
          onChange={(v) => onChange('loudness', v)} disabled={disabled}
        />
        {category === 'music' && (
          <ToggleRow
            label="Auto-Duck" checked={audio.autoDuck}
            onChange={(v) => onChange('autoDuck', v)} disabled={disabled}
            description="Lower music when dialogue detected"
          />
        )}

        {/* Category hint */}
        <div className="info-box" style={{ marginTop: 12 }}>
          {{
            dialogue: <p>🎙 <strong>Dialogue:</strong> Noise reduction, de-reverb, and clarity enhance speech intelligibility. Loudness targets broadcast standard (−23 LUFS).</p>,
            music:    <p>🎵 <strong>Music:</strong> Auto-Duck lowers music volume during speaking sections. Noise reduction cleans background hiss.</p>,
            sfx:      <p>💥 <strong>SFX:</strong> Noise reduction and de-reverb clean environmental recordings. Apply loudness normalization before export.</p>,
            ambience: <p>🌊 <strong>Ambience:</strong> Noise reduction removes wind and HVAC noise. Low Cut removes sub-bass rumble.</p>,
          }[category]}
        </div>
      </div>
    </div>
  );
};

export default EssentialSoundPanel;
