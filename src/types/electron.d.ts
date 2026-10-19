/**
 * Type declarations for the Electron IPC bridge exposed via preload.
 * Available in renderer as `window.editpro`.
 */
import type { ExportJob } from '../../electron/export/plan';

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

export interface EditProBridge {
  openImage(): Promise<string[] | null>;
  openVideo(): Promise<string | null>;
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
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  onMenu(
    channel: 'menu:openImage' | 'menu:openVideo' | 'menu:export' | 'menu:resetAdjustments',
    listener: () => void
  ): () => void;
}

declare global {
  interface Window {
    editpro?: EditProBridge;
  }
}
