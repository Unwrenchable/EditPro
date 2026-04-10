import React, { useRef, useCallback } from 'react';
import { useMagicMovie } from '../../hooks/useMagicMovie';
import { MAGIC_STYLE_META, GENERATION_STEPS } from '../../utils/magicMovieAI';
import type { MagicMovieStyle, MagicMoviePlan } from '../../types';

// ── Sub-components ────────────────────────────────────────────────────────────

interface StyleCardProps {
  style: MagicMovieStyle;
  selected: boolean;
  onSelect: (s: MagicMovieStyle) => void;
}

const StyleCard: React.FC<StyleCardProps> = ({ style, selected, onSelect }) => {
  const meta = MAGIC_STYLE_META[style];
  const handleClick = useCallback(() => onSelect(style), [style, onSelect]);
  return (
    <button
      className={`mm-style-card ${selected ? 'selected' : ''}`}
      onClick={handleClick}
      aria-pressed={selected}
      title={meta.tagline}
      style={{ '--mm-accent': meta.accentColor } as React.CSSProperties}
    >
      <span className="mm-style-emoji" aria-hidden="true">{meta.emoji}</span>
      <span className="mm-style-label">{meta.label}</span>
      <span className="mm-style-tagline">{meta.tagline}</span>
    </button>
  );
};

// ─── Color swatch preview ────────────────────────────────────────────────────

interface LumetriSwatchProps {
  plan: MagicMoviePlan;
}

const LumetriSwatch: React.FC<LumetriSwatchProps> = ({ plan }) => {
  const meta = MAGIC_STYLE_META[plan.style];
  const { lumetri } = plan;

  // Simple heuristic bars for visual indication
  const warmth = Math.round(50 + lumetri.temperature * 0.5);        // 0–100 px
  const punch = Math.round(50 + lumetri.contrast * 0.35);            // 0–100 px
  const pop = Math.round(50 + (lumetri.saturation + lumetri.vibrance) * 0.25); // 0–100 px

  return (
    <div className="mm-swatch" style={{ '--mm-accent': meta.accentColor } as React.CSSProperties}>
      <div className="mm-swatch-title">Color Profile</div>
      <div className="mm-swatch-row">
        <span className="mm-swatch-bar-label">Warmth</span>
        <div className="mm-swatch-track">
          <div
            className="mm-swatch-fill"
            style={{ width: `${Math.max(2, Math.min(100, warmth))}%` }}
            role="presentation"
          />
        </div>
        <span className="mm-swatch-val">{lumetri.temperature > 0 ? '+' : ''}{lumetri.temperature}</span>
      </div>
      <div className="mm-swatch-row">
        <span className="mm-swatch-bar-label">Punch</span>
        <div className="mm-swatch-track">
          <div
            className="mm-swatch-fill"
            style={{ width: `${Math.max(2, Math.min(100, punch))}%` }}
            role="presentation"
          />
        </div>
        <span className="mm-swatch-val">{lumetri.contrast > 0 ? '+' : ''}{lumetri.contrast}</span>
      </div>
      <div className="mm-swatch-row">
        <span className="mm-swatch-bar-label">Vibrancy</span>
        <div className="mm-swatch-track">
          <div
            className="mm-swatch-fill"
            style={{ width: `${Math.max(2, Math.min(100, pop))}%` }}
            role="presentation"
          />
        </div>
        <span className="mm-swatch-val">{lumetri.saturation > 0 ? '+' : ''}{lumetri.saturation}</span>
      </div>
    </div>
  );
};

// ─── Scene list preview ───────────────────────────────────────────────────────

const COLOR_DOT: Record<string, string> = {
  red: '#e84a4a',
  yellow: '#e8c84a',
  green: '#4ae87a',
  blue: '#4a9ee8',
};

interface SceneListProps {
  plan: MagicMoviePlan;
}

const SceneList: React.FC<SceneListProps> = ({ plan }) => (
  <div className="mm-scenes">
    <div className="mm-scenes-title">Scene Structure</div>
    {plan.scenes.map((scene, i) => (
      <div className="mm-scene-row" key={i}>
        <span
          className="mm-scene-dot"
          style={{ background: COLOR_DOT[scene.color] }}
          aria-hidden="true"
        />
        <div className="mm-scene-info">
          <span className="mm-scene-label">{scene.label}</span>
          <span className="mm-scene-desc">{scene.description}</span>
        </div>
        <span className="mm-scene-pct">
          {Math.round(scene.startPct * 100)}–{Math.round(scene.endPct * 100)}%
        </span>
      </div>
    ))}
  </div>
);

// ─── Plan preview ─────────────────────────────────────────────────────────────

interface PlanPreviewProps {
  plan: MagicMoviePlan;
  file: File | null;
  onApply: () => void;
  onRegenerate: () => void;
  onFileSelect: (f: File) => void;
}

const PlanPreview: React.FC<PlanPreviewProps> = ({
  plan,
  file,
  onApply,
  onRegenerate,
  onFileSelect,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const meta = MAGIC_STYLE_META[plan.style];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFileSelect(f);
  };

  return (
    <div className="mm-plan-preview">
      <div className="mm-plan-header" style={{ '--mm-accent': meta.accentColor } as React.CSSProperties}>
        <span className="mm-plan-emoji" aria-hidden="true">{meta.emoji}</span>
        <div>
          <div className="mm-plan-title">{plan.title}</div>
          <div className="mm-plan-desc">{plan.description}</div>
        </div>
      </div>

      <div className="mm-plan-body">
        <LumetriSwatch plan={plan} />
        <SceneList plan={plan} />

        <div className="mm-settings-row">
          <div className="mm-setting-chip">
            <span className="mm-setting-icon">🎞️</span>
            {plan.autoReframe} aspect ratio
          </div>
          <div className="mm-setting-chip">
            <span className="mm-setting-icon">🎧</span>
            {plan.audio.category.charAt(0).toUpperCase() + plan.audio.category.slice(1)} audio
          </div>
          {plan.audio.autoDuck && (
            <div className="mm-setting-chip">
              <span className="mm-setting-icon">🔇</span>
              Auto-duck music
            </div>
          )}
        </div>
      </div>

      {/* Video file picker */}
      <div className="mm-file-area">
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.webm,.ogg,.mov,.avi,.mkv,.m4v,.flv,.wmv"
          className="hidden-input"
          onChange={handleFileChange}
          aria-label="Select video file for Magic Movie"
        />
        {file ? (
          <div className="mm-file-selected">
            <span className="mm-file-icon" aria-hidden="true">🎬</span>
            <span className="mm-file-name">{file.name}</span>
            <button
              className="mm-file-change"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change video file"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            className="mm-pick-file-btn"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Select a video file to apply this Magic Movie plan to"
          >
            <span aria-hidden="true">📂</span> Select a video to apply this to
          </button>
        )}
      </div>

      <div className="mm-plan-actions">
        <button
          className="btn-secondary"
          onClick={onRegenerate}
          aria-label="Regenerate Magic Movie plan"
        >
          ↺ Regenerate
        </button>
        <button
          className="mm-apply-btn"
          onClick={onApply}
          disabled={!file}
          aria-label={file ? 'Apply Magic Movie to video' : 'Select a video file first'}
          title={file ? undefined : 'Select a video file first'}
        >
          ✨ Apply Magic Movie
        </button>
      </div>
    </div>
  );
};

// ─── Generation progress ──────────────────────────────────────────────────────

interface GeneratingViewProps {
  step: number;
}

const GeneratingView: React.FC<GeneratingViewProps> = ({ step }) => (
  <div className="mm-generating" aria-live="polite" aria-label="Generating Magic Movie plan">
    <div className="mm-gen-spinner" aria-hidden="true">✦</div>
    <div className="mm-gen-steps">
      {GENERATION_STEPS.map((label, i) => (
        <div
          key={i}
          className={`mm-gen-step ${i < step ? 'done' : i === step ? 'active' : 'pending'}`}
        >
          <span className="mm-gen-step-icon" aria-hidden="true">
            {i < step ? '✓' : i === step ? '◉' : '○'}
          </span>
          {label}
        </div>
      ))}
    </div>
  </div>
);

// ─── Main MagicMovieView ──────────────────────────────────────────────────────

interface MagicMovieViewProps {
  onApply: (file: File, plan: MagicMoviePlan) => void;
}

const STYLES_ORDER: MagicMovieStyle[] = [
  'cinematic', 'travel', 'action', 'documentary',
  'wedding', 'social', 'dramatic', 'vintage',
];

const MagicMovieView: React.FC<MagicMovieViewProps> = ({ onApply }) => {
  const magic = useMagicMovie();
  const { state } = magic;
  const [file, setFile] = React.useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = useCallback(() => {
    if (!state.prompt.trim()) return;
    magic.generate();
  }, [magic, state.prompt]);

  const handleApply = useCallback(() => {
    if (file && state.plan) {
      magic.markApplied();
      onApply(file, state.plan);
    }
  }, [file, state.plan, magic, onApply]);

  const handleRegenerate = useCallback(() => {
    magic.reset();
  }, [magic]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  if (state.status === 'generating') {
    return (
      <div className="mm-view">
        <GeneratingView step={state.generationStep} />
      </div>
    );
  }

  if (state.status === 'ready' && state.plan) {
    return (
      <div className="mm-view">
        <PlanPreview
          plan={state.plan}
          file={file}
          onApply={handleApply}
          onRegenerate={handleRegenerate}
          onFileSelect={setFile}
        />
      </div>
    );
  }

  // ── Idle / prompt entry ──────────────────────────────────────────────────
  return (
    <div className="mm-view">
      <div className="mm-hero">
        <div className="mm-hero-icon" aria-hidden="true">✦</div>
        <h1 className="mm-hero-title">Magic Movie</h1>
        <div className="mm-hero-subtitle">
          Describe your vision — AI will craft the color grade, scene structure and audio
          settings to bring it to life.
        </div>
      </div>

      <div className="mm-prompt-area">
        <label className="mm-prompt-label" htmlFor="mm-prompt-input">
          What's your vision?
        </label>
        <textarea
          id="mm-prompt-input"
          className="mm-prompt-input"
          placeholder={
            'e.g. "Epic cinematic travel video through the mountains" or\n' +
            '"Fast-paced sports highlight reel with punchy color"'
          }
          value={state.prompt}
          onChange={(e) => magic.setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={4}
          aria-label="Describe your Magic Movie vision"
          maxLength={300}
        />
        <div className="mm-prompt-hint">
          Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to generate
          <span className="mm-prompt-counter">{state.prompt.length}/300</span>
        </div>
      </div>

      <div className="mm-styles-section">
        <div className="mm-styles-label">
          Choose a style <span className="mm-styles-label-hint">(or let AI detect it from your prompt)</span>
        </div>
        <div className="mm-styles-grid">
          {STYLES_ORDER.map((s) => (
            <StyleCard
              key={s}
              style={s}
              selected={state.style === s}
              onSelect={(picked) =>
                magic.setStyle(state.style === picked ? null : picked)
              }
            />
          ))}
        </div>
      </div>

      {/* Optional early file pick */}
      <div className="mm-file-area mm-file-area--early">
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.webm,.ogg,.mov,.avi,.mkv,.m4v,.flv,.wmv"
          className="hidden-input"
          onChange={handleFileChange}
          aria-label="Select video file (optional — can also be done after generating)"
        />
        {file ? (
          <div className="mm-file-selected">
            <span className="mm-file-icon" aria-hidden="true">🎬</span>
            <span className="mm-file-name">{file.name}</span>
            <button
              className="mm-file-change"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change video file"
            >
              Change
            </button>
          </div>
        ) : (
          <button
            className="mm-pick-file-btn"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Optionally select a video file before generating"
          >
            <span aria-hidden="true">📂</span> Select video (optional)
          </button>
        )}
      </div>

      <div className="mm-generate-row">
        <button
          className="mm-generate-btn"
          onClick={handleGenerate}
          disabled={!state.prompt.trim()}
          aria-label="Generate Magic Movie plan"
          title={state.prompt.trim() ? undefined : 'Enter a description first'}
        >
          ✨ Generate Magic Movie
        </button>
      </div>
    </div>
  );
};

export default MagicMovieView;
