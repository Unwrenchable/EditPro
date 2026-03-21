/**
 * Provides file open/save operations that use the native Electron dialogs
 * when running inside Electron, or fall back to browser <input type="file">
 * when running as a regular web app.
 */
import { useCallback } from 'react';

export function useNativeFiles() {
  const isElectron = !!window.editpro;

  /**
   * Open image file(s). Returns an array of data URLs.
   */
  const openImages = useCallback(async (): Promise<{ name: string; dataUrl: string }[]> => {
    if (isElectron && window.editpro) {
      const paths = await window.editpro.openImage();
      if (!paths || paths.length === 0) return [];
      const results = await Promise.all(
        paths.map(async (p) => {
          const dataUrl = await window.editpro!.readFileAsDataUrl(p);
          return { name: p.split(/[\\/]/).pop() ?? p, dataUrl };
        })
      );
      return results;
    }
    // Browser fallback — open file picker imperatively
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff';
      input.multiple = true;
      input.onchange = () => {
        const files = Array.from(input.files ?? []);
        Promise.all(
          files.map(
            (f) =>
              new Promise<{ name: string; dataUrl: string }>((res) => {
                const reader = new FileReader();
                reader.onload = () => res({ name: f.name, dataUrl: reader.result as string });
                reader.readAsDataURL(f);
              })
          )
        ).then(resolve);
      };
      input.click();
    });
  }, [isElectron]);

  /**
   * Open a single video file. Returns { name, dataUrl } or null.
   */
  const openVideo = useCallback(async (): Promise<{ name: string; dataUrl: string } | null> => {
    if (isElectron && window.editpro) {
      const filePath = await window.editpro.openVideo();
      if (!filePath) return null;
      const dataUrl = await window.editpro.readFileAsDataUrl(filePath);
      return { name: filePath.split(/[\\/]/).pop() ?? filePath, dataUrl };
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () =>
          resolve({ name: file.name, dataUrl: reader.result as string });
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }, [isElectron]);

  /**
   * Save a data URL to disk. Uses native dialog in Electron, triggers download in browser.
   */
  const saveFile = useCallback(
    async (dataUrl: string, defaultName: string): Promise<void> => {
      if (isElectron && window.editpro) {
        const filePath = await window.editpro.saveImage(defaultName);
        if (!filePath) return;
        await window.editpro.writeDataUrlToFile(filePath, dataUrl);
      } else {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = defaultName;
        link.click();
      }
    },
    [isElectron]
  );

  return { openImages, openVideo, saveFile, isElectron };
}
