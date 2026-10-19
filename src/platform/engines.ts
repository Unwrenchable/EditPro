import type { ExportEngine, PlatformKind } from './types';

export interface EncoderCaps {
  nativeFfmpeg: boolean;
  ffmpegWasm: boolean;
  webCodecs: boolean;
  mediaRecorder: boolean;
}

export interface EncoderGlobals {
  VideoEncoder?: unknown;
  MediaRecorder?: unknown;
  WebAssembly?: unknown;
  Worker?: unknown;
}

export interface KindGlobals {
  editpro?: unknown;
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
}

/** Desktop ffmpeg first, then the browser engines in fidelity order. */
export function exportFallbackOrder(caps: EncoderCaps): ExportEngine[] {
  const order: ExportEngine[] = [];
  if (caps.nativeFfmpeg) order.push('native-ffmpeg');
  if (caps.ffmpegWasm) order.push('ffmpeg-wasm');
  if (caps.webCodecs) order.push('webcodecs');
  if (caps.mediaRecorder) order.push('media-recorder');
  return order;
}

export function preferredExportEngine(caps: EncoderCaps): ExportEngine {
  return exportFallbackOrder(caps)[0] ?? 'none';
}

/**
 * jsdom and other non-browsers leave every flag false so tests stay on the
 * "desktop ffmpeg" message. A real tab sets at least MediaRecorder.
 * ffmpeg.wasm is only offered there: it needs a worker, and a worker without
 * a media element is not a useful export host.
 */
export function detectBrowserEncoders(scope: EncoderGlobals): Omit<EncoderCaps, 'nativeFfmpeg'> {
  const mediaRecorder = typeof scope.MediaRecorder === 'function';
  const webCodecs = typeof scope.VideoEncoder === 'function';
  const ffmpegWasm =
    mediaRecorder &&
    typeof scope.WebAssembly === 'object' &&
    scope.WebAssembly !== null &&
    typeof scope.Worker === 'function';
  return { mediaRecorder, webCodecs, ffmpegWasm };
}

export function detectPlatformKind(scope: KindGlobals | undefined): PlatformKind {
  if (scope?.editpro) return 'electron';
  if (scope?.Capacitor?.isNativePlatform?.()) return 'capacitor';
  return 'web';
}

export function engineLabel(engine: ExportEngine): string {
  switch (engine) {
    case 'native-ffmpeg':
      return 'the bundled ffmpeg';
    case 'ffmpeg-wasm':
      return 'ffmpeg.wasm';
    case 'webcodecs':
      return 'WebCodecs';
    case 'media-recorder':
      return 'MediaRecorder';
    default:
      return 'no encoder';
  }
}
