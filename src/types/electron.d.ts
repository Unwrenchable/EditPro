/**
 * Type declarations for the Electron IPC bridge exposed via preload.
 * Available in renderer as `window.editpro`.
 */
import type { RecoveryOffer } from '../utils/sessionStore';

export type EditProMenuChannel =
  | 'menu:openProject'
  | 'menu:openImage'
  | 'menu:openVideo'
  | 'menu:save'
  | 'menu:saveAs'
  | 'menu:export'
  | 'menu:undo'
  | 'menu:redo'
  | 'menu:resetAdjustments';

export interface EditProBridge {
  openImage(): Promise<string[] | null>;
  openVideo(): Promise<string | null>;
  openProject(): Promise<string | null>;
  saveProject(defaultName: string): Promise<string | null>;
  saveImage(defaultName: string): Promise<string | null>;
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
  onMenu(channel: EditProMenuChannel, listener: () => void): () => void;
}

declare global {
  interface Window {
    editpro?: EditProBridge;
  }
}
