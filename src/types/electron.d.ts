/**
 * Type declarations for the Electron IPC bridge exposed via preload.
 * Available in renderer as `window.editpro`.
 */
import type { ExportJob } from '../../electron/export/plan';
import type { AppPreferences, PreferencePatch, UpdateDialogState } from '../../electron/updates/policy';
import type { RecoveryOffer } from '../utils/sessionStore';

export interface VideoExportEvent {
  jobId: string;
  type: 'progress' | 'done' | 'cancelled' | 'error';
  percent?: number;
  timeSec?: number;
  fps?: number | null;
  done?: boolean;
  outputPath?: string;
  message?: string;
}

export interface VideoExportResult {
  status: 'done' | 'cancelled' | 'error';
  outputPath: string;
  message?: string;
}

export type PlaybackScale = 'full' | 'half' | 'quarter';

export interface ProxyPlaybackEvent {
  jobId: string;
  sourcePath: string;
  scale: PlaybackScale;
  type: 'progress' | 'done' | 'cancelled' | 'error';
  percent?: number;
  mediaUrl?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
  message?: string;
}

export interface ProxyStartResult {
  jobId: string;
  status: 'ready' | 'started' | 'cancelled' | 'error';
  mediaUrl: string | null;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  message?: string;
}

export interface ProxyClassification {
  required: boolean;
  scale: PlaybackScale;
  reason: string;
  width: number;
  height: number;
  durationSec: number;
  videoCodec: string;
  fileBytes: number;
}

export interface ProxyCacheEntry {
  id: string;
  bytes: number;
  lastUsedMs: number;
  partial: boolean;
  sourceName: string | null;
  scale: PlaybackScale | null;
}

export interface ProxyCacheStatus {
  usedBytes: number;
  maxBytes: number;
  auto: boolean;
  items: number;
  partials: number;
  entries: ProxyCacheEntry[];
}

export interface DecodeInfo {
  videoDecode: string;
  hardware: boolean;
  label: string;
  platform: string;
}

export type EditProMenuChannel =
  | 'menu:openProject'
  | 'menu:openImage'
  | 'menu:openVideo'
  | 'menu:save'
  | 'menu:saveAs'
  | 'menu:export'
  | 'menu:undo'
  | 'menu:redo'
  | 'menu:resetAdjustments'
  | 'menu:settings'
  | 'menu:about';

export interface ClientErrorReport {
  message: string;
  stack?: string;
  source?: string;
}

export interface AiEvent {
  jobId: string;
  type: 'progress' | 'done' | 'cancelled' | 'error';
  percent?: number;
  message?: string;
}

export interface AiTimeRange {
  start: number;
  end: number;
}

export interface AiTranscriptWord {
  id: string;
  text: string;
  start: number;
  end: number;
}

export interface AiCaptionCue {
  id: string;
  start: number;
  end: number;
  text: string;
  words: AiTranscriptWord[];
}

export interface AiModelStatus {
  id: string;
  label: string;
  bytes: number;
  ready: boolean;
}

export interface AiStatus {
  platform: string;
  arch: string;
  whisperCli: boolean;
  models: AiModelStatus[];
}

export interface AiSceneHit {
  time: number;
  score: number;
}

export interface EditProBridge {
  openImage(): Promise<string[] | null>;
  openVideo(): Promise<string | null>;
  openProject(): Promise<string | null>;
  saveProject(defaultName: string): Promise<string | null>;
  saveImage(defaultName: string): Promise<string | null>;
  saveVideo(defaultName: string): Promise<string | null>;
  getPathForFile(file: File): string;
  materializeVideoSource(fileName: string, bytes: ArrayBuffer): Promise<string>;
  startVideoExport(request: ExportJob): Promise<VideoExportResult>;
  listVideoEncoders?(): Promise<string[]>;
  cancelVideoExport(jobId: string): Promise<boolean>;
  onExportEvent(listener: (event: VideoExportEvent) => void): () => void;
  showItemInFolder(filePath: string): Promise<boolean>;
  readFileAsDataUrl(filePath: string): Promise<string>;
  writeDataUrlToFile(filePath: string, dataUrl: string): Promise<boolean>;
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(filePath: string, contents: string): Promise<boolean>;
  readRecent(): Promise<string>;
  writeRecent(contents: string): Promise<boolean>;
  getRecovery(): Promise<RecoveryOffer | null>;
  autosave(contents: string, projectPath: string | null): Promise<boolean>;
  flushAutosave(contents: string, projectPath: string | null): boolean;
  noteSaved(projectPath: string): Promise<boolean>;
  discardRecovery(): Promise<boolean>;
  markCleanShutdown(): Promise<boolean>;
  getDecodeInfo(): Promise<DecodeInfo>;
  startProxy(request: { sourcePath: string; scale: PlaybackScale }): Promise<ProxyStartResult>;
  cancelProxy(jobId: string): Promise<boolean>;
  onProxyEvent(listener: (event: ProxyPlaybackEvent) => void): () => void;
  classifyProxy(sourcePath: string): Promise<ProxyClassification>;
  getProxyCache(): Promise<ProxyCacheStatus>;
  setProxyCachePolicy(patch: { maxBytes?: number; auto?: boolean }): Promise<ProxyCacheStatus>;
  cleanupProxyCache(): Promise<ProxyCacheStatus>;
  relinkProxyCache(paths: string[]): Promise<{ moved: number; skipped: number; status: ProxyCacheStatus }>;
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  openExternal(url: string): Promise<boolean>;
  onMenu(channel: EditProMenuChannel, listener: () => void): () => void;
  getPreferences(): Promise<AppPreferences>;
  setPreferences(patch: PreferencePatch): Promise<AppPreferences>;
  getUpdateState(): Promise<UpdateDialogState>;
  onUpdateState(listener: (dialog: UpdateDialogState) => void): () => void;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<boolean>;
  installUpdate(): Promise<boolean>;
  skipUpdate(version: string): Promise<boolean>;
  remindUpdateLater(): Promise<boolean>;
  dismissUpdate(): Promise<boolean>;
  recordClientError(report: ClientErrorReport): Promise<boolean>;
  aiStatus(): Promise<AiStatus>;
  aiDownload(request: { kind: 'model' | 'cli'; modelId?: string }): Promise<{ ready: boolean }>;
  aiCancel(jobId: string): Promise<boolean>;
  aiDetectScenes(request: { sourcePath: string; threshold: number }): Promise<{ hits: AiSceneHit[] }>;
  aiTranscribe(request: { sourcePath: string; modelId: string; language?: string }): Promise<{ cues: AiCaptionCue[] }>;
  aiSaveCaptions(request: { cues: AiCaptionCue[]; format: 'srt' | 'vtt' }): Promise<{ outputPath: string | null }>;
  aiBurnCaptions(request: { sourcePath: string; cues: AiCaptionCue[] }): Promise<{ outputPath: string | null }>;
  aiRenderCut(request: { sourcePath: string; ranges: AiTimeRange[] }): Promise<{ outputPath: string | null }>;
  onAiEvent(listener: (event: AiEvent) => void): () => void;
}

declare global {
  interface Window {
    editpro?: EditProBridge;
  }
}
