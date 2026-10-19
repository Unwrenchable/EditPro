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
}

declare global {
  interface Window {
    editpro?: EditProBridge;
  }
}
