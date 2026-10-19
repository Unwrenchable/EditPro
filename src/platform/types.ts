/**
 * Runtime contract for the React editor.
 * Desktop windows fulfill it with the Electron preload (`window.editpro`).
 * Browser and Capacitor sessions fulfill it in-process.
 */
import type {
  ClientErrorReport,
  DecodeInfo,
  EditProBridge,
  EditProMenuChannel,
  PlaybackScale,
  ProxyPlaybackEvent,
  ProxyStartResult,
  VideoExportEvent,
  VideoExportResult,
} from '../types/electron';
import type { AppPreferences, PreferencePatch, UpdateDialogState } from '../../electron/updates/policy';
import type { RecoveryOffer } from '../utils/sessionStore';
import type { ExportJob } from '../utils/video/exportPlan';

export type PlatformKind = 'electron' | 'web' | 'capacitor';

export type ExportEngine = 'native-ffmpeg' | 'ffmpeg-wasm' | 'webcodecs' | 'media-recorder' | 'none';

export type NativeFeature =
  | 'ffmpeg-export'
  | 'ffmpeg-proxy'
  | 'hardware-decode'
  | 'whisper'
  | 'auto-update';

export interface FeatureStatus {
  feature: NativeFeature;
  available: boolean;
  engine: string;
  /** Short line for a panel or welcome note. */
  summary: string;
  /** Explanation shown when the feature is blocked or degraded. */
  detail: string;
}

export interface PlatformCapabilities {
  kind: PlatformKind;
  /** Spawn the bundled ffmpeg binary. */
  nativeFfmpeg: boolean;
  /** Build playback proxies with that binary. */
  nativeProxy: boolean;
  /** Local Whisper binary. This desktop build does not ship one. */
  nativeWhisper: boolean;
  hardwareDecode: boolean;
  fileSystemPaths: boolean;
  autoUpdate: boolean;
  webCodecs: boolean;
  mediaRecorder: boolean;
  /** ffmpeg.wasm can be loaded (real browser worker + WebAssembly). */
  ffmpegWasm: boolean;
  /** transformers.js can be loaded for on-device Whisper-tiny. */
  transformersJs: boolean;
  share: boolean;
}

export interface TranscriptionRequest {
  /** 16 kHz mono PCM. Null asks for the status message without running a model. */
  samples: Float32Array | null;
  sampleRate?: number;
}

export interface TranscriptionResult {
  status: 'done' | 'unavailable' | 'error';
  text: string;
  engine: 'whisper' | 'transformers-js' | 'none';
  message: string;
}

/**
 * Everything the React UI needs from the host.
 * Electron methods match the preload bridge so desktop behavior stays on IPC.
 */
export interface PlatformBridge extends EditProBridge {
  readonly kind: PlatformKind;
  /** Live preload bridge. Null in the browser and in Capacitor. */
  readonly electron: EditProBridge | null;
  readonly capabilities: PlatformCapabilities;
  featureStatus(feature: NativeFeature): FeatureStatus;
  exportEngine(): ExportEngine;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  /** Share sheet on mobile, Web Share API, or a download. */
  shareFile(file: Blob, filename: string, title?: string): Promise<boolean>;
}

export type {
  AppPreferences,
  ClientErrorReport,
  DecodeInfo,
  EditProMenuChannel,
  ExportJob,
  PlaybackScale,
  PreferencePatch,
  ProxyPlaybackEvent,
  ProxyStartResult,
  RecoveryOffer,
  UpdateDialogState,
  VideoExportEvent,
  VideoExportResult,
};
