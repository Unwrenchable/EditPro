export type EditorMode = 'photo' | 'video';

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
  brightness: number;   // -100 to 100
  contrast: number;     // -100 to 100
  saturation: number;   // -100 to 100
  temperature: number;  // -100 to 100
  highlights: number;   // -100 to 100
  shadows: number;      // -100 to 100
}

export interface ExportOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality: number; // 0.1 to 1.0
}
