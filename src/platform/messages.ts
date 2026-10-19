import { detectBrowserEncoders, engineLabel, exportFallbackOrder } from './engines';
import type { FeatureStatus, NativeFeature, PlatformCapabilities } from './types';

/** Shown when the page cannot encode at all. The export dialog asserts this copy. */
export const EXPORT_UNAVAILABLE_DETAIL =
  'Video export runs in the EditPro desktop app, which bundles ffmpeg. This browser cannot write a video file because WebCodecs, MediaRecorder, and ffmpeg.wasm are unavailable. Start it with npm run dev:electron.';

export const PROXY_UNAVAILABLE_DETAIL =
  'Low-resolution proxies are built by the desktop ffmpeg so the timeline stays smooth. This browser plays the original file. Hardware GPU decode is a desktop feature; preview here uses the browser media engine.';

export const WHISPER_BROWSER_DETAIL =
  'The first transcription downloads the Whisper-tiny weights into this browser and runs them with transformers.js. Later runs stay on this device. EditPro does not upload the audio. The desktop app does not bundle a Whisper binary in this build.';

export const WHISPER_UNAVAILABLE_DETAIL =
  'Speech transcription needs transformers.js in the browser, or a local Whisper model beside the desktop app. Neither is available in this session, so no audio was sent anywhere.';

export const UPDATE_BROWSER_DETAIL =
  'Browser and mobile builds do not install desktop updates. Refresh this page for a new web build, or download an installer from the EditPro releases page.';

export function describeFeature(feature: NativeFeature, caps: PlatformCapabilities): FeatureStatus {
  switch (feature) {
    case 'ffmpeg-export':
      return describeExport(caps);
    case 'ffmpeg-proxy':
      return caps.nativeProxy
        ? available(feature, 'native-ffmpeg', 'Playback proxies are rendered by the desktop ffmpeg. Export still uses the original file.', 'Proxy generation does not replace the camera original.')
        : blocked(feature, 'none', 'Proxy files are a desktop ffmpeg feature.', PROXY_UNAVAILABLE_DETAIL);
    case 'hardware-decode':
      return caps.hardwareDecode
        ? available(feature, 'electron', 'Hardware video decode is enabled in this desktop window.', 'The decoder label comes from the Electron media pipeline.')
        : blocked(feature, caps.webCodecs ? 'webcodecs' : 'browser', 'GPU decode runs in the desktop app.', PROXY_UNAVAILABLE_DETAIL);
    case 'whisper':
      return describeWhisper(caps);
    case 'auto-update':
      return caps.autoUpdate
        ? available(feature, 'electron-updater', 'Signed desktop builds can download and restart from GitHub Releases.', 'Unsigned builds open the release page instead of installing in place.')
        : blocked(feature, 'none', 'Automatic install is part of the desktop app.', UPDATE_BROWSER_DETAIL);
    default:
      return blocked(feature, 'none', 'This feature is not available in this session.', 'Open the desktop app for the native tool.');
  }
}

function describeExport(caps: PlatformCapabilities): FeatureStatus {
  const order = exportFallbackOrder(caps);
  const first = order[0] ?? 'none';
  if (first === 'native-ffmpeg') {
    return available(
      'ffmpeg-export',
      'native-ffmpeg',
      'Encodes with the bundled ffmpeg binary: trim, playback speed, Lumetri color, Essential Sound, auto reframe, and the selected transition.',
      'Export uses the desktop ffmpeg. Browser engines are not used in this window.',
    );
  }
  if (order.length === 0) {
    return blocked(
      'ffmpeg-export',
      'none',
      'Video export runs in the EditPro desktop app, which bundles ffmpeg.',
      EXPORT_UNAVAILABLE_DETAIL,
    );
  }
  const chain = order.map((engine) => engineLabel(engine)).join(', then ');
  return available(
    'ffmpeg-export',
    first,
    `This browser encodes with ${chain}. The desktop ffmpeg remains the full filter graph when those engines cannot run it.`,
    'WebCodecs and MediaRecorder keep the trimmed picture. ffmpeg.wasm runs the same export plan as the desktop app when its core loads from /ffmpeg or from jsDelivr. Multicam clips that are still desktop paths are left out, and the dialog says so. Nothing is uploaded.',
  );
}

function describeWhisper(caps: PlatformCapabilities): FeatureStatus {
  if (caps.nativeWhisper) {
    return available(
      'whisper',
      'whisper',
      'Transcription uses a local Whisper model in the desktop app.',
      'Audio stays on this computer. Nothing is uploaded.',
    );
  }
  if (caps.transformersJs) {
    return available(
      'whisper',
      'transformers-js',
      'This browser transcribes on-device with transformers.js (Whisper-tiny).',
      WHISPER_BROWSER_DETAIL,
    );
  }
  return blocked(
    'whisper',
    'none',
    'Offline speech transcription is not available in this session.',
    WHISPER_UNAVAILABLE_DETAIL,
  );
}

function available(feature: NativeFeature, engine: string, summary: string, detail: string): FeatureStatus {
  return { feature, available: true, engine, summary, detail };
}

function blocked(feature: NativeFeature, engine: string, summary: string, detail: string): FeatureStatus {
  return { feature, available: false, engine, summary, detail };
}

/** Browser capabilities from the current page, with native flags forced off. */
export function browserEncoderFlags(): ReturnType<typeof detectBrowserEncoders> {
  const scope = typeof globalThis === 'undefined' ? {} : globalThis;
  return detectBrowserEncoders(scope);
}
