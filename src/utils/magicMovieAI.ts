import type {
  MagicMovieStyle,
  MagicMoviePlan,
  MagicMovieScene,
  LumetriColor,
  AudioTrackSettings,
  AutoReframeAspect,
} from '../types';
import { DEFAULT_LUMETRI, DEFAULT_AUDIO } from './videoUtils';

// ── Style metadata (display info) ────────────────────────────────────────────

export interface MagicStyleMeta {
  label: string;
  emoji: string;
  tagline: string;
  keywords: string[];
  accentColor: string;
}

export const MAGIC_STYLE_META: Record<MagicMovieStyle, MagicStyleMeta> = {
  cinematic: {
    label: 'Cinematic',
    emoji: '🎬',
    tagline: 'Hollywood-grade drama with teal-orange grade',
    keywords: ['cinematic', 'movie', 'film', 'epic', 'sora', 'hollywood', 'blockbuster', 'theatrical'],
    accentColor: '#e8a44a',
  },
  travel: {
    label: 'Travel',
    emoji: '✈️',
    tagline: 'Vibrant, warm and full of wanderlust',
    keywords: ['travel', 'adventure', 'vacation', 'explore', 'journey', 'trip', 'destination', 'world'],
    accentColor: '#4abbe8',
  },
  action: {
    label: 'Action',
    emoji: '⚡',
    tagline: 'High-energy, punchy and adrenaline-fuelled',
    keywords: ['action', 'sport', 'sports', 'fast', 'extreme', 'highlight', 'gaming', 'energy', 'hype'],
    accentColor: '#e84a4a',
  },
  documentary: {
    label: 'Documentary',
    emoji: '🎙️',
    tagline: 'Natural, honest storytelling with real feel',
    keywords: ['documentary', 'real', 'story', 'interview', 'natural', 'journalist', 'news', 'authentic'],
    accentColor: '#8888aa',
  },
  wedding: {
    label: 'Wedding',
    emoji: '💍',
    tagline: 'Soft, romantic and timeless beauty',
    keywords: ['wedding', 'love', 'romantic', 'romance', 'ceremony', 'celebration', 'bride', 'marriage'],
    accentColor: '#e8b4c8',
  },
  social: {
    label: 'Social',
    emoji: '📱',
    tagline: 'Punchy, vertical-first and scroll-stopping',
    keywords: ['instagram', 'tiktok', 'social', 'reels', 'short', 'viral', 'content', 'creator'],
    accentColor: '#a44ae8',
  },
  dramatic: {
    label: 'Dramatic',
    emoji: '🌑',
    tagline: 'Moody, high-contrast and intensely atmospheric',
    keywords: ['dramatic', 'intense', 'dark', 'suspense', 'thriller', 'moody', 'noir', 'mystery'],
    accentColor: '#4444aa',
  },
  vintage: {
    label: 'Vintage',
    emoji: '📽️',
    tagline: 'Warm, faded and soaked in nostalgia',
    keywords: ['vintage', 'retro', 'old', 'classic', 'nostalgic', 'film grain', 'analog', 'memories'],
    accentColor: '#c8944a',
  },
};

// ── Style presets ─────────────────────────────────────────────────────────────

function makeLumetri(overrides: Partial<LumetriColor>): LumetriColor {
  return { ...DEFAULT_LUMETRI, ...overrides };
}

const STYLE_PRESETS: Record<MagicMovieStyle, {
  lumetri: LumetriColor;
  audio: AudioTrackSettings;
  autoReframe: AutoReframeAspect;
  playbackRate: number;
}> = {
  cinematic: {
    lumetri: makeLumetri({
      exposure: 0.2,
      contrast: 30,
      highlights: -35,
      shadows: 15,
      whites: -10,
      blacks: -20,
      temperature: 6,
      tint: 2,
      saturation: -18,
      vibrance: 12,
      wheels: {
        shadows: { x: -0.15, y: 0.08, luminance: 0 },
        midtones: { x: 0, y: 0, luminance: 0 },
        highlights: { x: 0.1, y: -0.06, luminance: 5 },
      },
    }),
    audio: { ...DEFAULT_AUDIO, category: 'music', autoDuck: true, loudness: -6 },
    autoReframe: '16:9',
    playbackRate: 1,
  },

  travel: {
    lumetri: makeLumetri({
      exposure: 0.3,
      contrast: 20,
      highlights: -15,
      shadows: 20,
      whites: 5,
      temperature: 22,
      tint: 3,
      saturation: 25,
      vibrance: 35,
    }),
    audio: { ...DEFAULT_AUDIO, category: 'music', autoDuck: true, loudness: -4 },
    autoReframe: '16:9',
    playbackRate: 1,
  },

  action: {
    lumetri: makeLumetri({
      exposure: 0.1,
      contrast: 42,
      highlights: -25,
      shadows: -15,
      blacks: -25,
      temperature: -12,
      saturation: 32,
      vibrance: 22,
    }),
    audio: { ...DEFAULT_AUDIO, category: 'music', loudness: -3, lowCut: true },
    autoReframe: '16:9',
    playbackRate: 1,
  },

  documentary: {
    lumetri: makeLumetri({
      exposure: 0,
      contrast: 10,
      highlights: -8,
      shadows: 8,
      temperature: 8,
      saturation: -5,
      vibrance: 10,
    }),
    audio: { ...DEFAULT_AUDIO, category: 'dialogue', noiseReduction: 40, clarity: 50, deReverb: 30 },
    autoReframe: '16:9',
    playbackRate: 1,
  },

  wedding: {
    lumetri: makeLumetri({
      exposure: 0.5,
      contrast: -12,
      highlights: -25,
      shadows: 30,
      whites: 12,
      blacks: 10,
      temperature: 15,
      tint: 6,
      saturation: -12,
      vibrance: 22,
    }),
    audio: { ...DEFAULT_AUDIO, category: 'music', autoDuck: true, loudness: -8 },
    autoReframe: '16:9',
    playbackRate: 1,
  },

  social: {
    lumetri: makeLumetri({
      exposure: 0.25,
      contrast: 28,
      highlights: -10,
      shadows: 15,
      temperature: 10,
      saturation: 38,
      vibrance: 42,
    }),
    audio: { ...DEFAULT_AUDIO, category: 'music', loudness: -2 },
    autoReframe: '9:16',
    playbackRate: 1,
  },

  dramatic: {
    lumetri: makeLumetri({
      exposure: -0.35,
      contrast: 52,
      highlights: -42,
      shadows: -25,
      blacks: -35,
      temperature: -8,
      tint: -5,
      saturation: -32,
      vibrance: -12,
      wheels: {
        shadows: { x: -0.08, y: 0.12, luminance: -10 },
        midtones: { x: 0, y: 0, luminance: 0 },
        highlights: { x: 0.05, y: -0.05, luminance: 0 },
      },
    }),
    audio: { ...DEFAULT_AUDIO, category: 'music', autoDuck: false, loudness: -5 },
    autoReframe: '16:9',
    playbackRate: 1,
  },

  vintage: {
    lumetri: makeLumetri({
      exposure: -0.2,
      contrast: -18,
      highlights: 22,
      shadows: 32,
      whites: -8,
      blacks: 18,
      temperature: 28,
      tint: 12,
      saturation: -22,
      vibrance: -8,
    }),
    audio: { ...DEFAULT_AUDIO, category: 'music', autoDuck: true, loudness: -7 },
    autoReframe: '16:9',
    playbackRate: 1,
  },
};

// ── Scene blueprints per style ────────────────────────────────────────────────

const SCENE_BLUEPRINTS: Record<MagicMovieStyle, Omit<MagicMovieScene, 'startPct' | 'endPct'>[]> = {
  cinematic: [
    { label: 'Opening', description: 'Establish the world — wide, sweeping shots', color: 'blue' },
    { label: 'Build-up', description: 'Rising tension and character introduction', color: 'yellow' },
    { label: 'Climax', description: 'Peak dramatic moment — hold nothing back', color: 'red' },
    { label: 'Resolution', description: 'The aftermath — let the emotion breathe', color: 'green' },
    { label: 'Closing', description: 'Final frame — leave the audience wanting more', color: 'blue' },
  ],
  travel: [
    { label: 'Arrival', description: 'First impressions of the destination', color: 'blue' },
    { label: 'Exploration', description: 'Wander, discover, take it all in', color: 'green' },
    { label: 'Highlights', description: 'The unmissable moments', color: 'yellow' },
    { label: 'Golden Hour', description: 'Magic light, perfect atmosphere', color: 'yellow' },
    { label: 'Departure', description: 'Last looks — bittersweet and beautiful', color: 'blue' },
  ],
  action: [
    { label: 'Hype Intro', description: 'Set the pace — loud, fast, electric', color: 'red' },
    { label: 'First Run', description: 'Opening sequence of moves', color: 'yellow' },
    { label: 'Peak Action', description: 'The best clips at full intensity', color: 'red' },
    { label: 'Slow-Mo', description: 'Freeze the best moment in time', color: 'blue' },
    { label: 'Epic Finish', description: 'Go out with a bang', color: 'red' },
  ],
  documentary: [
    { label: 'Introduction', description: 'Who, what, where — set the context', color: 'blue' },
    { label: 'First Subject', description: 'Main interview or subject focus', color: 'green' },
    { label: 'Second Subject', description: 'Counterpoint or supporting view', color: 'yellow' },
    { label: 'Resolution', description: 'Findings, conclusions, impact', color: 'green' },
    { label: 'Credits', description: 'Closing thoughts and credits roll', color: 'blue' },
  ],
  wedding: [
    { label: 'Getting Ready', description: 'Preparations, candid moments of joy', color: 'yellow' },
    { label: 'Ceremony', description: 'The vows — raw, real and beautiful', color: 'blue' },
    { label: 'First Dance', description: 'Just the two of you', color: 'yellow' },
    { label: 'Celebration', description: 'Toasts, tears, laughter and dancing', color: 'green' },
    { label: 'Send-Off', description: 'The perfect farewell', color: 'blue' },
  ],
  social: [
    { label: 'Hook', description: 'Stop the scroll — 3 seconds to captivate', color: 'red' },
    { label: 'Story Beat 1', description: 'Establish your message or personality', color: 'yellow' },
    { label: 'Story Beat 2', description: 'Build interest, add value or humor', color: 'green' },
    { label: 'Call to Action', description: 'Like, follow, share — drive engagement', color: 'red' },
  ],
  dramatic: [
    { label: 'Establishing', description: 'Dark, brooding opening — set the mood', color: 'blue' },
    { label: 'Tension Build', description: 'Something is wrong — escalate slowly', color: 'yellow' },
    { label: 'Revelation', description: 'The truth comes to light', color: 'red' },
    { label: 'Climax', description: 'Everything explodes — peak intensity', color: 'red' },
    { label: 'Aftermath', description: 'Silence after the storm', color: 'blue' },
  ],
  vintage: [
    { label: 'Opening', description: 'Fade in from black — time begins', color: 'yellow' },
    { label: 'Memory 1', description: 'The first cherished moment', color: 'yellow' },
    { label: 'Memory 2', description: 'Another treasured memory', color: 'green' },
    { label: 'Reflection', description: 'Pausing to remember and feel', color: 'yellow' },
    { label: 'Fade Out', description: 'Time fades — the feeling remains', color: 'blue' },
  ],
};

// ── Title generation ──────────────────────────────────────────────────────────

function generateTitle(prompt: string, style: MagicMovieStyle): string {
  const trimmed = prompt.trim();
  if (!trimmed) return `${MAGIC_STYLE_META[style].label} Magic Movie`;

  // Capitalise first letter, truncate if too long
  const base = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return base.length > 50 ? base.slice(0, 47) + '…' : base;
}

// ── Keyword-based style detection ─────────────────────────────────────────────

export function detectStyle(prompt: string): MagicMovieStyle {
  const lower = prompt.toLowerCase();
  let bestStyle: MagicMovieStyle = 'cinematic';
  let bestScore = 0;

  for (const [style, meta] of Object.entries(MAGIC_STYLE_META) as [MagicMovieStyle, MagicStyleMeta][]) {
    const score = meta.keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestStyle = style;
    }
  }
  return bestStyle;
}

// ── Plan generation ───────────────────────────────────────────────────────────

/**
 * Generates a complete MagicMoviePlan from a user prompt and an optional forced style.
 * When `forcedStyle` is omitted the style is auto-detected from the prompt text.
 */
export function generatePlan(prompt: string, forcedStyle?: MagicMovieStyle): MagicMoviePlan {
  const style = forcedStyle ?? detectStyle(prompt);
  const preset = STYLE_PRESETS[style];
  const blueprints = SCENE_BLUEPRINTS[style];
  const meta = MAGIC_STYLE_META[style];

  // Distribute scene boundaries evenly across 0–1
  const sceneCount = blueprints.length;
  const scenes: MagicMovieScene[] = blueprints.map((bp, i) => ({
    ...bp,
    startPct: i / sceneCount,
    endPct: (i + 1) / sceneCount,
  }));

  const title = generateTitle(prompt, style);
  const description = prompt.trim()
    ? `${meta.tagline}. Crafted from: "${prompt.trim()}"`
    : meta.tagline;

  return {
    title,
    style,
    description,
    lumetri: preset.lumetri,
    audio: preset.audio,
    autoReframe: preset.autoReframe,
    scenes,
    playbackRate: preset.playbackRate,
  };
}

// ── Generation steps (for animated progress UX) ───────────────────────────────

export const GENERATION_STEPS: string[] = [
  'Analysing your vision…',
  'Detecting mood and style…',
  'Crafting your colour palette…',
  'Building scene structure…',
  'Tuning audio settings…',
  'Composing your Magic Movie…',
];
