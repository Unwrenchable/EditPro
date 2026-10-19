/**
 * In-process host for the browser and the Capacitor shell.
 * Capacitor uses the system file picker and share sheet; the browser uses
 * an input element and the Web Share API.
 */
import {
  applyPreferencePatch,
  remindLater,
  skipVersion,
  type AppPreferences,
  type PreferencePatch,
  type UpdateDialogState,
} from '../../electron/updates/policy';
import type {
  ClientErrorReport,
  DecodeInfo,
  EditProBridge,
  PlaybackScale,
  ProxyStartResult,
  VideoExportEvent,
  VideoExportResult,
} from '../types/electron';
import { loadBrowserPreferences, saveBrowserPreferences } from '../utils/preferences';
import type { RecoveryOffer } from '../utils/sessionStore';
import type { ExportJob } from '../utils/video/exportPlan';
import { APP_VERSION } from './version';
import { detectBrowserEncoders, preferredExportEngine } from './engines';
import { UPDATE_BROWSER_DETAIL, describeFeature } from './messages';
import type {
  ExportEngine,
  FeatureStatus,
  NativeFeature,
  PlatformBridge,
  PlatformCapabilities,
  PlatformKind,
  TranscriptionRequest,
  TranscriptionResult,
} from './types';
import { isNativeCancel, pickCapacitorFiles, shareCapacitorFile } from './capacitor/files';
import { isAbortError } from './web/abort';
import {
  blobToDataUrl,
  displayName,
  getBlob,
  readVirtualText,
  rememberBytes,
  rememberFile,
  rememberHandle,
  rememberOutput,
  resetBrowserStorage,
  takeHandle,
  writeVirtualText,
  type SaveHandle,
} from './web/blobStore';
import { downloadBlob, extensionForMime, replaceExtension } from './web/download';
import { runBrowserExport } from './web/runBrowserExport';
import { transcribeWithTransformers } from './web/transcribe';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff';
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo,.mkv,.mov,.m4v';
const PROJECT_ACCEPT = '.editpro,application/json';

type FilePicker = (accept: string, multiple: boolean) => Promise<File[] | null>;

let filePicker: FilePicker = pickFilesWithInput;
let nativeFilePicker: FilePicker | null = null;
let nativeShare: ((file: Blob, filename: string, title?: string) => Promise<boolean>) | null = null;

const jobs = new Map<string, AbortController>();

export function setFilePickerForTests(picker: FilePicker | null): void {
  filePicker = picker ?? pickFilesWithInput;
}

/** Tests inject the system picker without loading a device plugin. */
export function setNativeFileAccessForTests(
  picker: FilePicker | null,
  share: ((file: Blob, filename: string, title?: string) => Promise<boolean>) | null = null,
): void {
  nativeFilePicker = picker;
  nativeShare = share;
}

export function resetBrowserPlatformForTests(): void {
  resetBrowserStorage();
  filePicker = pickFilesWithInput;
  nativeFilePicker = null;
  nativeShare = null;
  for (const controller of jobs.values()) controller.abort();
  jobs.clear();
  webPlatform.resetEphemeral();
  capacitorPlatform.resetEphemeral();
}

function pickFilesWithInput(accept: string, multiple: boolean): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => {
      const selected = Array.from(input.files ?? []);
      resolve(selected.length > 0 ? selected : null);
    };
    input.click();
  });
}

function allowedExternal(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function downloadName(outputPath: string, blob: Blob): string {
  const raw = displayName(outputPath);
  return replaceExtension(raw, extensionForMime(blob.type || 'video/mp4'));
}

async function deliverBlob(outputPath: string, blob: Blob): Promise<void> {
  rememberOutput(outputPath, blob);
  const handle = takeHandle(outputPath);
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  downloadBlob(downloadName(outputPath, blob), blob);
}

export class BrowserPlatform implements PlatformBridge {
  readonly kind: 'web' | 'capacitor';
  private exportListeners = new Set<(event: VideoExportEvent) => void>();
  private updateListeners = new Set<(dialog: UpdateDialogState) => void>();
  private updateState: UpdateDialogState = { type: 'hidden' };
  private errors: ClientErrorReport[] = [];

  constructor(kind: 'web' | 'capacitor') {
    this.kind = kind;
  }

  resetEphemeral(): void {
    this.exportListeners.clear();
    this.updateListeners.clear();
    this.updateState = { type: 'hidden' };
    this.errors = [];
  }

  get electron(): EditProBridge | null {
    return null;
  }

  get capabilities(): PlatformCapabilities {
    const encoders = detectBrowserEncoders(typeof globalThis === 'undefined' ? {} : globalThis);
    const share = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    return {
      kind: this.kind,
      nativeFfmpeg: false,
      nativeProxy: false,
      nativeWhisper: false,
      hardwareDecode: false,
      fileSystemPaths: false,
      autoUpdate: false,
      webCodecs: encoders.webCodecs,
      mediaRecorder: encoders.mediaRecorder,
      ffmpegWasm: encoders.ffmpegWasm,
      transformersJs: encoders.mediaRecorder,
      share,
    };
  }

  featureStatus(feature: NativeFeature): FeatureStatus {
    return describeFeature(feature, this.capabilities);
  }

  exportEngine(): ExportEngine {
    return preferredExportEngine(this.capabilities);
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const status = this.featureStatus('whisper');
    if (!request.samples || request.samples.length === 0 || !status.available || status.engine !== 'transformers-js') {
      return { status: 'unavailable', text: '', engine: 'none', message: status.detail };
    }
    return transcribeWithTransformers(request.samples, request.sampleRate ?? 16000);
  }

  async shareFile(file: Blob, filename: string, title?: string): Promise<boolean> {
    if (this.kind === 'capacitor') {
      try {
        const share = nativeShare ?? shareCapacitorFile;
        return await share(file, filename, title);
      } catch (error) {
        if (isNativeCancel(error)) return false;
      }
    }
    const nav = navigator as Navigator & {
      share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
      canShare?: (data: { files?: File[] }) => boolean;
    };
    const shared = new File([file], filename, { type: file.type || 'application/octet-stream' });
    if (typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare({ files: [shared] }))) {
      try {
        await nav.share({ files: [shared], title: title ?? filename });
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return false;
      }
    }
    downloadBlob(filename, file);
    return false;
  }

  private chooseFiles(accept: string, multiple: boolean): Promise<File[] | null> {
    if (this.kind !== 'capacitor') return filePicker(accept, multiple);
    const pick = nativeFilePicker ?? pickCapacitorFiles;
    return pick(accept, multiple).catch((error: unknown) => {
      if (isNativeCancel(error)) return null;
      return filePicker(accept, multiple);
    });
  }

  async openImage(): Promise<string[] | null> {
    const files = await this.chooseFiles(IMAGE_ACCEPT, true);
    if (!files || files.length === 0) return null;
    return files.map((file) => rememberFile(file));
  }

  async openVideo(): Promise<string | null> {
    const files = await this.chooseFiles(VIDEO_ACCEPT, false);
    const file = files?.[0];
    return file ? rememberFile(file) : null;
  }

  async openProject(): Promise<string | null> {
    const files = await this.chooseFiles(PROJECT_ACCEPT, false);
    const file = files?.[0];
    return file ? rememberFile(file) : null;
  }

  async saveProject(defaultName: string): Promise<string | null> {
    return this.pickSavePath(defaultName);
  }

  async saveImage(defaultName: string): Promise<string | null> {
    return this.pickSavePath(defaultName);
  }

  async saveVideo(defaultName: string): Promise<string | null> {
    return this.pickSavePath(defaultName);
  }

  getPathForFile(): string {
    return '';
  }

  async materializeVideoSource(fileName: string, bytes: ArrayBuffer): Promise<string> {
    return rememberBytes(fileName, bytes);
  }

  async startVideoExport(request: ExportJob): Promise<VideoExportResult> {
    const source = getBlob(request.sourcePath);
    if (!source) {
      return {
        status: 'error',
        outputPath: request.outputPath,
        message:
          'Open the video in this browser before exporting. Desktop paths are not readable here; the desktop app passes them to ffmpeg.',
      };
    }
    const controller = new AbortController();
    jobs.set(request.jobId, controller);
    const emit = (event: VideoExportEvent) => {
      for (const listener of this.exportListeners) listener(event);
    };
    try {
      const result = await runBrowserExport({
        job: request,
        source,
        capabilities: this.capabilities,
        signal: controller.signal,
        onProgress: (percent, timeSec) => {
          emit({ jobId: request.jobId, type: 'progress', percent, timeSec });
        },
      });
      await deliverBlob(request.outputPath, result.blob);
      emit({ jobId: request.jobId, type: 'done', percent: 100, outputPath: request.outputPath, done: true });
      return { status: 'done', outputPath: request.outputPath, message: result.message };
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        emit({ jobId: request.jobId, type: 'cancelled' });
        return { status: 'cancelled', outputPath: request.outputPath, message: 'Export cancelled.' };
      }
      const message = error instanceof Error ? error.message : 'Export failed.';
      emit({ jobId: request.jobId, type: 'error', message });
      return { status: 'error', outputPath: request.outputPath, message };
    } finally {
      jobs.delete(request.jobId);
    }
  }

  async listVideoEncoders(): Promise<string[]> {
    const caps = this.capabilities;
    const names: string[] = [];
    if (caps.ffmpegWasm) names.push('libx264', 'libvpx-vp9');
    if (caps.webCodecs) names.push('webcodecs');
    if (caps.mediaRecorder) names.push('mediarecorder');
    return names;
  }

  async cancelVideoExport(jobId: string): Promise<boolean> {
    const controller = jobs.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  onExportEvent(listener: (event: VideoExportEvent) => void): () => void {
    this.exportListeners.add(listener);
    return () => this.exportListeners.delete(listener);
  }

  async showItemInFolder(filePath: string): Promise<boolean> {
    const blob = getBlob(filePath);
    if (!blob) return false;
    downloadBlob(downloadName(filePath, blob), blob);
    return true;
  }

  async readFileAsDataUrl(filePath: string): Promise<string> {
    const blob = getBlob(filePath);
    if (!blob) throw new Error('That file is no longer in this browser session. Open it again.');
    return blobToDataUrl(blob);
  }

  async writeDataUrlToFile(filePath: string, dataUrl: string): Promise<boolean> {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await deliverBlob(filePath, blob);
    return true;
  }

  async readTextFile(filePath: string): Promise<string> {
    const blob = getBlob(filePath);
    if (blob) return blob.text();
    const stored = readVirtualText(filePath);
    if (stored === null) throw new Error('That project is not in this browser session.');
    return stored;
  }

  async writeTextFile(filePath: string, contents: string): Promise<boolean> {
    writeVirtualText(filePath, contents);
    if (filePath.startsWith('download:') || filePath.startsWith('handle:')) {
      await deliverBlob(filePath, new Blob([contents], { type: 'application/json' }));
    }
    return true;
  }

  async readRecent(): Promise<string> {
    return localStorage.getItem('editpro.recent') ?? '[]';
  }

  async writeRecent(contents: string): Promise<boolean> {
    localStorage.setItem('editpro.recent', contents);
    return true;
  }

  async getRecovery(): Promise<RecoveryOffer | null> {
    return null;
  }

  async autosave(): Promise<boolean> {
    return true;
  }

  flushAutosave(): boolean {
    return true;
  }

  async noteSaved(): Promise<boolean> {
    return true;
  }

  async discardRecovery(): Promise<boolean> {
    return true;
  }

  async markCleanShutdown(): Promise<boolean> {
    return true;
  }

  async getDecodeInfo(): Promise<DecodeInfo> {
    const caps = this.capabilities;
    return {
      videoDecode: caps.webCodecs ? 'webcodecs' : 'browser',
      hardware: false,
      label: 'Browser playback. Proxies and GPU decode use the desktop ffmpeg. This tab plays the original.',
      platform: this.kind === 'capacitor' ? capacitorHost() : 'web',
    };
  }

  async startProxy(request: { sourcePath: string; scale: PlaybackScale }): Promise<ProxyStartResult> {
    const status = this.featureStatus('ffmpeg-proxy');
    return {
      jobId: `web-proxy-${request.scale}`,
      status: 'error',
      mediaUrl: null,
      width: 0,
      height: 0,
      fps: 0,
      durationSec: 0,
      message: status.detail,
    };
  }

  async cancelProxy(): Promise<boolean> {
    return false;
  }

  onProxyEvent(): () => void {
    return () => {};
  }

  async getVersion(): Promise<string> {
    return APP_VERSION;
  }

  async getPlatform(): Promise<string> {
    if (this.kind === 'capacitor') return capacitorHost();
    return 'web';
  }

  async openExternal(url: string): Promise<boolean> {
    const safe = allowedExternal(url);
    if (!safe) return false;
    window.open(safe, '_blank', 'noopener,noreferrer');
    return true;
  }

  onMenu(): () => void {
    return () => {};
  }

  async getPreferences(): Promise<AppPreferences> {
    return loadBrowserPreferences(localStorage);
  }

  async setPreferences(patch: PreferencePatch): Promise<AppPreferences> {
    const next = applyPreferencePatch(loadBrowserPreferences(localStorage), patch);
    saveBrowserPreferences(localStorage, next);
    return next;
  }

  async getUpdateState(): Promise<UpdateDialogState> {
    return this.updateState;
  }

  onUpdateState(listener: (dialog: UpdateDialogState) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  async checkForUpdates(): Promise<void> {
    this.emitUpdate({ type: 'error', message: UPDATE_BROWSER_DETAIL });
  }

  async downloadUpdate(): Promise<boolean> {
    return false;
  }

  async installUpdate(): Promise<boolean> {
    return false;
  }

  async skipUpdate(version: string): Promise<boolean> {
    const next = skipVersion(loadBrowserPreferences(localStorage), version);
    if (!next) return false;
    saveBrowserPreferences(localStorage, next);
    this.emitUpdate({ type: 'hidden' });
    return true;
  }

  async remindUpdateLater(): Promise<boolean> {
    const next = remindLater(loadBrowserPreferences(localStorage), Date.now());
    saveBrowserPreferences(localStorage, next);
    this.emitUpdate({ type: 'hidden' });
    return true;
  }

  async dismissUpdate(): Promise<boolean> {
    this.emitUpdate({ type: 'hidden' });
    return true;
  }

  async recordClientError(report: ClientErrorReport): Promise<boolean> {
    this.errors.push(report);
    if (this.errors.length > 20) this.errors.shift();
    try {
      localStorage.setItem('editpro.clientErrors', JSON.stringify(this.errors));
    } catch {
      // A full quota should not take the editor down.
    }
    return true;
  }

  private emitUpdate(dialog: UpdateDialogState): void {
    this.updateState = dialog;
    for (const listener of this.updateListeners) listener(dialog);
  }

  private async pickSavePath(defaultName: string): Promise<string | null> {
    const picker = (window as Window & {
      showSaveFilePicker?: (options: { suggestedName?: string }) => Promise<SaveHandle>;
    }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({ suggestedName: defaultName });
        return rememberHandle(handle);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return null;
        return `download:${defaultName}`;
      }
    }
    return `download:${defaultName}`;
  }
}

function capacitorHost(): string {
  const cap = (window as Window & { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  return cap?.getPlatform?.() ?? 'capacitor';
}

export const webPlatform = new BrowserPlatform('web');
export const capacitorPlatform = new BrowserPlatform('capacitor');

export function browserPlatformFor(kind: Extract<PlatformKind, 'web' | 'capacitor'>): BrowserPlatform {
  return kind === 'capacitor' ? capacitorPlatform : webPlatform;
}
