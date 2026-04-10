export type EditorMode = 'photo' | 'video' | 'magic';

// ── Magic Movie ──────────────────────────────────────────────────────────────

export type MagicMovieStyle =
  | 'cinematic'
  | 'travel'
  | 'action'
  | 'documentary'
  | 'wedding'
  | 'social'
  | 'dramatic'
  | 'vintage';

export interface MagicMovieScene {
  label: string;
  /** fraction of total video duration where this scene starts (0–1) */
  startPct: number;
  /** fraction of total video duration where this scene ends (0–1) */
  endPct: number;
  description: string;
  color: 'red' | 'yellow' | 'green' | 'blue';
}

export interface MagicMoviePlan {
  title: string;
  style: MagicMovieStyle;
  description: string;
  lumetri: LumetriColor;
  audio: AudioTrackSettings;
  autoReframe: AutoReframeAspect;
  scenes: MagicMovieScene[];
  playbackRate: number;
}

export interface MagicMovieState {
  prompt: string;
  style: MagicMovieStyle | null;
  status: 'idle' | 'generating' | 'ready' | 'applied';
  generationStep: number;
  plan: MagicMoviePlan | null;
  error: string | null;
}

// ── Lumetri Color ───────────────────────────────────────────────────────────

export interface LumetriCurves {
  masterShadow: number;      // -100..100
  masterMidtone: number;     // -100..100
  masterHighlight: number;   // -100..100
  redShadow: number;
  redMidtone: number;
  redHighlight: number;
  greenShadow: number;
  greenMidtone: number;
  greenHighlight: number;
  blueShadow: number;
  blueMidtone: number;
  blueHighlight: number;
}

export interface ColorWheelAdjust {
  x: number;         // -1..1 (horizontal hue axis)
  y: number;         // -1..1 (vertical hue axis)
  luminance: number; // -100..100
}

export interface LumetriColorWheels {
  shadows: ColorWheelAdjust;
  midtones: ColorWheelAdjust;
  highlights: ColorWheelAdjust;
}

/** Full Lumetri Color state — maps 1-to-1 to Premiere Pro's Lumetri Color panel */
export interface LumetriColor {
  exposure: number;     // -5..5 (EV stops)
  contrast: number;     // -100..100
  highlights: number;   // -100..100
  shadows: number;      // -100..100
  whites: number;       // -100..100
  blacks: number;       // -100..100
  temperature: number;  // -100..100 (cool → warm)
  tint: number;         // -100..100 (green → magenta)
  saturation: number;   // -100..100 (0 = unchanged)
  vibrance: number;     // -100..100
  curves: LumetriCurves;
  wheels: LumetriColorWheels;
}

// ── Essential Sound ─────────────────────────────────────────────────────────

export type AudioCategory = 'dialogue' | 'music' | 'sfx' | 'ambience';

export interface AudioTrackSettings {
  category: AudioCategory;
  noiseReduction: number; // 0-100
  clarity: number;        // 0-100 (dialogue clarity / high-shelf boost)
  deReverb: number;       // 0-100
  loudness: number;       // -20..0 (target loudness offset in dB)
  autoDuck: boolean;      // auto-duck music under dialogue
  lowCut: boolean;        // remove low-end rumble (<80 Hz)
}

// ── Timeline markers ────────────────────────────────────────────────────────

export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  color: 'red' | 'yellow' | 'green' | 'blue';
}

// ── Multi-Track Timeline ────────────────────────────────────────────────────

export type TrackType = 'video' | 'audio';

export interface TimelineTrack {
  id: string;
  type: TrackType;
  name: string;
  muted: boolean;
  locked: boolean;
}

export interface TimelineClip {
  id: string;
  src: string;
  trackId: string;
  startTime: number;
  endTime: number;
  inPoint: number;
  outPoint: number;
}

// ── Audio Clips ─────────────────────────────────────────────────────────────

export interface AudioClip {
  id: string;
  src: string;
  trackId: string;
  startTime: number;
  endTime: number;
}

// ── Auto Reframe & Export ───────────────────────────────────────────────────

export type AutoReframeAspect = '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | 'original';

export interface VideoExportOptions {
  platform: 'youtube' | 'tiktok' | 'vimeo' | 'twitter' | 'custom';
  resolution: '4K' | '1080p' | '720p' | '480p';
  frameRate: 24 | 30 | 60;
  format: 'mp4' | 'webm' | 'mov';
  quality: number; // 0-100
}

// ── Photo ───────────────────────────────────────────────────────────────────

export interface PhotoAdjustments {
  brightness: number;      // -100 to 100
  contrast: number;        // -100 to 100
  saturation: number;      // -100 to 100
  exposure: number;        // -100 to 100
  highlights: number;      // -100 to 100
  shadows: number;         // -100 to 100
  sharpness: number;       // 0 to 100
  temperature: number;     // -100 to 100 (cool to warm)
  tint: number;            // -100 to 100
  // Extended professional controls
  whites: number;          // -100 to 100
  blacks: number;          // -100 to 100
  vibrance: number;        // -100 to 100
  hue: number;             // -180 to 180
  noiseReduction: number;  // 0 to 100
  clarity: number;         // -100 to 100
  texture: number;         // -100 to 100
  dehaze: number;          // -100 to 100
  vignette: number;        // -100 to 100
  grain: number;           // 0 to 100
  fade: number;            // 0 to 100
}

export type PhotoFilterName =
  | 'none'
  | 'grayscale'
  | 'sepia'
  | 'vivid'
  | 'cool'
  | 'warm'
  | 'fade'
  | 'dramatic'
  | 'matte';

export interface PhotoFilter {
  name: PhotoFilterName;
  label: string;
  css: string;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoEditorState {
  file: File | null;
  imageUrl: string | null;
  adjustments: PhotoAdjustments;
  filter: PhotoFilterName;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
  isCropping: boolean;
}

export interface VideoEditorState {
  file: File | null;
  videoUrl: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  trimStart: number;
  trimEnd: number;
  playbackRate: number;
  volume: number;
  isMuted: boolean;
  /** Lumetri Color — replaces the old flat brightness/contrast/saturation/etc. */
  lumetri: LumetriColor;
  /** Essential Sound panel settings */
  audio: AudioTrackSettings;
  /** Timeline markers (sorted by time) */
  markers: TimelineMarker[];
  /** Auto Reframe output aspect ratio */
  autoReframe: AutoReframeAspect;
  /** Timeline zoom level (0.5 – 8) */
  timelineZoom: number;
  /** Multi-track timeline tracks */
  tracks: TimelineTrack[];
  /** Multi-track timeline clips */
  clips: TimelineClip[];
}

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality: number; // 0.1 to 1.0
}
