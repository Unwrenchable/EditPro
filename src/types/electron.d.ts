/**
 * Type declarations for the Electron IPC bridge exposed via preload.
 * Available in renderer as `window.editpro`.
 */
export interface EditProBridge {
  openImage(): Promise<string[] | null>;
  openVideo(): Promise<string | null>;
  saveImage(defaultName: string): Promise<string | null>;
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
