import { capacitorPlatform, webPlatform } from './browserPlatform';
import { detectPlatformKind } from './engines';
import { electronPlatform } from './electronPlatform';
import type { PlatformBridge, PlatformKind } from './types';

export { APP_VERSION } from './version';
export { detectBrowserEncoders, detectPlatformKind, exportFallbackOrder, preferredExportEngine } from './engines';
export { describeFeature, EXPORT_UNAVAILABLE_DETAIL } from './messages';
export { rewriteFfmpegArgsForWasm } from './web/rewriteArgs';
export { downsampleTo16k } from './web/audioSamples';
export { resetBrowserPlatformForTests, setFilePickerForTests } from './browserPlatform';
export type {
  ExportEngine,
  FeatureStatus,
  NativeFeature,
  PlatformBridge,
  PlatformCapabilities,
  PlatformKind,
  TranscriptionRequest,
  TranscriptionResult,
} from './types';

/**
 * The host the React UI should call.
 * Electron wins whenever the preload bridge is present, including tests that
 * assign `window.editpro`. The object for each kind is stable across renders.
 */
export function getPlatform(): PlatformBridge {
  const kind = currentKind();
  if (kind === 'electron') return electronPlatform;
  if (kind === 'capacitor') return capacitorPlatform;
  return webPlatform;
}

export function currentKind(): PlatformKind {
  if (typeof window === 'undefined') return 'web';
  return detectPlatformKind(window);
}
