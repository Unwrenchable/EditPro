/**
 * Desktop host. Every call reads `window.editpro` so tests can install a
 * partial bridge before render. Missing methods no-op instead of throwing,
 * matching the optional chaining the UI used to do itself.
 */
import {
  applyPreferencePatch,
  type AppPreferences,
  type PreferencePatch,
  type UpdateDialogState,
} from '../../electron/updates/policy';
import type {
  AiCaptionCue,
  AiEvent,
  AiStatus,
  AiTimeRange,
  ClientErrorReport,
  DecodeInfo,
  EditProBridge,
  EditProMenuChannel,
  PlaybackScale,
  ProxyCacheStatus,
  ProxyClassification,
  ProxyPlaybackEvent,
  ProxyStartResult,
  VideoExportEvent,
  VideoExportResult,
} from '../types/electron';
import { loadBrowserPreferences, saveBrowserPreferences } from '../utils/preferences';
import type { RecoveryOffer } from '../utils/sessionStore';
import type { ExportJob } from '../utils/video/exportPlan';
import { preferredExportEngine } from './engines';
import { describeFeature } from './messages';
import type {
  ExportEngine,
  FeatureStatus,
  NativeFeature,
  PlatformBridge,
  PlatformCapabilities,
  TranscriptionResult,
} from './types';

function emptyCache(): ProxyCacheStatus {
  return { usedBytes: 0, maxBytes: 0, auto: false, items: 0, partials: 0, entries: [] };
}

function emptyClassification(): ProxyClassification {
  return {
    required: false,
    scale: 'full',
    reason: 'Proxy classification is unavailable.',
    width: 0,
    height: 0,
    durationSec: 0,
    videoCodec: '',
    fileBytes: 0,
  };
}

function emptyAi(platform: string): AiStatus {
  return {
    platform,
    arch: '',
    whisperCli: false,
    models: [],
    matte: { id: 'matte', label: 'Background matte', bytes: 0, ready: false },
  };
}

function live(): EditProBridge | null {
  if (typeof window === 'undefined') return null;
  return window.editpro ?? null;
}

function storage(): Storage {
  return window.localStorage;
}

export function electronCapabilities(bridge: EditProBridge | null | undefined): PlatformCapabilities {
  return {
    kind: 'electron',
    nativeFfmpeg: typeof bridge?.startVideoExport === 'function',
    nativeProxy: typeof bridge?.startProxy === 'function',
    nativeWhisper: false,
    hardwareDecode: typeof bridge?.getDecodeInfo === 'function',
    fileSystemPaths: typeof bridge?.getPathForFile === 'function',
    autoUpdate: typeof bridge?.checkForUpdates === 'function',
    webCodecs: false,
    mediaRecorder: false,
    ffmpegWasm: false,
    transformersJs: false,
    share: false,
  };
}

export const electronPlatform: PlatformBridge = {
  kind: 'electron',
  get electron() {
    return live();
  },
  get capabilities() {
    return electronCapabilities(live());
  },
  featureStatus(feature: NativeFeature): FeatureStatus {
    return describeFeature(feature, this.capabilities);
  },
  exportEngine(): ExportEngine {
    return preferredExportEngine(this.capabilities);
  },
  async transcribe(): Promise<TranscriptionResult> {
    const status = describeFeature('whisper', this.capabilities);
    return {
      status: 'unavailable',
      text: '',
      engine: 'none',
      message: status.detail,
    };
  },
  async shareFile(): Promise<boolean> {
    return false;
  },
  openImage: () => live()?.openImage() ?? Promise.resolve(null),
  openVideo: () => live()?.openVideo() ?? Promise.resolve(null),
  openProject: () => live()?.openProject() ?? Promise.resolve(null),
  saveProject: (defaultName: string) => live()?.saveProject(defaultName) ?? Promise.resolve(null),
  saveImage: (defaultName: string) => live()?.saveImage(defaultName) ?? Promise.resolve(null),
  saveVideo: (defaultName: string) => live()?.saveVideo(defaultName) ?? Promise.resolve(null),
  getPathForFile(file: File): string {
    try {
      return live()?.getPathForFile(file) ?? '';
    } catch {
      return '';
    }
  },
  materializeVideoSource: (fileName: string, bytes: ArrayBuffer) =>
    live()?.materializeVideoSource(fileName, bytes) ?? Promise.reject(new Error('The desktop bridge cannot store this video.')),
  startVideoExport: (request: ExportJob): Promise<VideoExportResult> =>
    live()?.startVideoExport(request) ?? Promise.reject(new Error('The desktop bridge cannot export video.')),
  listVideoEncoders: () => live()?.listVideoEncoders?.() ?? Promise.resolve([]),
  cancelVideoExport: (jobId: string) => live()?.cancelVideoExport(jobId) ?? Promise.resolve(false),
  onExportEvent(listener: (event: VideoExportEvent) => void): () => void {
    return live()?.onExportEvent(listener) ?? (() => {});
  },
  showItemInFolder: (filePath: string) => live()?.showItemInFolder(filePath) ?? Promise.resolve(false),
  readFileAsDataUrl: (filePath: string) =>
    live()?.readFileAsDataUrl(filePath) ?? Promise.reject(new Error('The desktop bridge cannot read that file.')),
  writeDataUrlToFile: (filePath: string, dataUrl: string) =>
    live()?.writeDataUrlToFile(filePath, dataUrl) ?? Promise.resolve(false),
  readTextFile: (filePath: string) =>
    live()?.readTextFile(filePath) ?? Promise.reject(new Error('The desktop bridge cannot read that file.')),
  writeTextFile: (filePath: string, contents: string) =>
    live()?.writeTextFile(filePath, contents) ?? Promise.resolve(false),
  readRecent: () => live()?.readRecent() ?? Promise.resolve('[]'),
  writeRecent: (contents: string) => live()?.writeRecent(contents) ?? Promise.resolve(false),
  getRecovery: (): Promise<RecoveryOffer | null> => live()?.getRecovery() ?? Promise.resolve(null),
  autosave: (contents: string, projectPath: string | null) =>
    live()?.autosave(contents, projectPath) ?? Promise.resolve(false),
  flushAutosave(contents: string, projectPath: string | null): boolean {
    return live()?.flushAutosave(contents, projectPath) ?? false;
  },
  noteSaved: (projectPath: string) => live()?.noteSaved(projectPath) ?? Promise.resolve(false),
  discardRecovery: () => live()?.discardRecovery() ?? Promise.resolve(false),
  markCleanShutdown: () => live()?.markCleanShutdown() ?? Promise.resolve(false),
  getDecodeInfo: (): Promise<DecodeInfo> =>
    live()?.getDecodeInfo() ?? Promise.resolve({
      videoDecode: 'unavailable',
      hardware: false,
      label: 'Hardware decode unavailable',
      platform: 'electron',
    }),
  startProxy: (request: { sourcePath: string; scale: PlaybackScale }): Promise<ProxyStartResult> =>
    live()?.startProxy(request) ?? Promise.reject(new Error('The desktop bridge cannot build a proxy.')),
  cancelProxy: (jobId: string) => live()?.cancelProxy(jobId) ?? Promise.resolve(false),
  onProxyEvent(listener: (event: ProxyPlaybackEvent) => void): () => void {
    return live()?.onProxyEvent(listener) ?? (() => {});
  },
  classifyProxy: (sourcePath: string) => live()?.classifyProxy(sourcePath) ?? Promise.resolve(emptyClassification()),
  getProxyCache: () => live()?.getProxyCache() ?? Promise.resolve(emptyCache()),
  setProxyCachePolicy: (patch: { maxBytes?: number; auto?: boolean }) =>
    live()?.setProxyCachePolicy(patch) ?? Promise.resolve(emptyCache()),
  cleanupProxyCache: () => live()?.cleanupProxyCache() ?? Promise.resolve(emptyCache()),
  relinkProxyCache: (paths: string[]) =>
    live()?.relinkProxyCache(paths) ?? Promise.resolve({ moved: 0, skipped: paths.length, status: emptyCache() }),
  aiStatus: () => live()?.aiStatus() ?? Promise.resolve(emptyAi('electron')),
  aiDownload: (request: { kind: 'model' | 'cli' | 'matte'; modelId?: string }) =>
    live()?.aiDownload(request) ?? Promise.resolve({ ready: false }),
  aiCancel: (jobId: string) => live()?.aiCancel(jobId) ?? Promise.resolve(false),
  aiDetectSilence: (request: { sourcePath: string; noiseDb: number; minDuration: number; padding: number }) =>
    live()?.aiDetectSilence(request) ?? Promise.reject(new Error('Offline AI is unavailable in this desktop session.')),
  aiDetectScenes: (request: { sourcePath: string; threshold: number }) =>
    live()?.aiDetectScenes(request) ?? Promise.reject(new Error('Offline AI is unavailable in this desktop session.')),
  aiTranscribe: (request: { sourcePath: string; modelId: string; language?: string }) =>
    live()?.aiTranscribe(request) ?? Promise.reject(new Error('Offline AI is unavailable in this desktop session.')),
  aiSaveCaptions: (request: { cues: AiCaptionCue[]; format: 'srt' | 'vtt' }) =>
    live()?.aiSaveCaptions(request) ?? Promise.resolve({ outputPath: null }),
  aiBurnCaptions: (request: { sourcePath: string; cues: AiCaptionCue[] }) =>
    live()?.aiBurnCaptions(request) ?? Promise.resolve({ outputPath: null }),
  aiRenderCut: (request: { sourcePath: string; ranges: AiTimeRange[] }) =>
    live()?.aiRenderCut(request) ?? Promise.resolve({ outputPath: null }),
  aiRemoveBackground: (request: { sourcePath: string; mode: 'transparent' | 'color'; color: string }) =>
    live()?.aiRemoveBackground(request) ?? Promise.resolve({ outputPath: null }),
  onAiEvent(listener: (event: AiEvent) => void): () => void {
    return live()?.onAiEvent(listener) ?? (() => {});
  },
  getVersion: () => live()?.getVersion() ?? Promise.resolve('1.0.0'),
  getPlatform: () => live()?.getPlatform?.() ?? Promise.resolve('linux'),
  openExternal: (url: string) => live()?.openExternal(url) ?? Promise.resolve(false),
  onMenu(channel: EditProMenuChannel, listener: () => void): () => void {
    return live()?.onMenu(channel, listener) ?? (() => {});
  },
  async getPreferences(): Promise<AppPreferences> {
    const bridge = live();
    if (bridge?.getPreferences) return bridge.getPreferences();
    return loadBrowserPreferences(storage());
  },
  async setPreferences(patch: PreferencePatch): Promise<AppPreferences> {
    const bridge = live();
    if (bridge?.setPreferences) return bridge.setPreferences(patch);
    const next = applyPreferencePatch(loadBrowserPreferences(storage()), patch);
    saveBrowserPreferences(storage(), next);
    return next;
  },
  getUpdateState: (): Promise<UpdateDialogState> => live()?.getUpdateState?.() ?? Promise.resolve({ type: 'hidden' }),
  onUpdateState(listener: (dialog: UpdateDialogState) => void): () => void {
    return live()?.onUpdateState(listener) ?? (() => {});
  },
  checkForUpdates: () => live()?.checkForUpdates?.() ?? Promise.resolve(),
  downloadUpdate: () => live()?.downloadUpdate?.() ?? Promise.resolve(false),
  installUpdate: () => live()?.installUpdate?.() ?? Promise.resolve(false),
  skipUpdate: (version: string) => live()?.skipUpdate?.(version) ?? Promise.resolve(false),
  remindUpdateLater: () => live()?.remindUpdateLater?.() ?? Promise.resolve(false),
  dismissUpdate: () => live()?.dismissUpdate?.() ?? Promise.resolve(false),
  recordClientError: (report: ClientErrorReport) => live()?.recordClientError?.(report) ?? Promise.resolve(false),
};
