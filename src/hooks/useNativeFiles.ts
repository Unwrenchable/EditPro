/**
 * File open/save through the platform bridge.
 * Electron dialogs and the browser file input are both behind that bridge.
 */
import { useCallback } from 'react';
import { getPlatform } from '../platform';

function fileName(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

export function useNativeFiles() {
  const isElectron = getPlatform().kind === 'electron';

  const openImages = useCallback(async (): Promise<{ name: string; dataUrl: string }[]> => {
    const platform = getPlatform();
    const paths = await platform.openImage();
    if (!paths || paths.length === 0) return [];
    return Promise.all(
      paths.map(async (filePath) => ({
        name: fileName(filePath),
        dataUrl: await platform.readFileAsDataUrl(filePath),
      })),
    );
  }, []);

  const openVideo = useCallback(async (): Promise<{ name: string; dataUrl: string } | null> => {
    const platform = getPlatform();
    const filePath = await platform.openVideo();
    if (!filePath) return null;
    return { name: fileName(filePath), dataUrl: await platform.readFileAsDataUrl(filePath) };
  }, []);

  const saveFile = useCallback(async (dataUrl: string, defaultName: string): Promise<void> => {
    const platform = getPlatform();
    const filePath = await platform.saveImage(defaultName);
    if (!filePath) return;
    await platform.writeDataUrlToFile(filePath, dataUrl);
  }, []);

  return { openImages, openVideo, saveFile, isElectron };
}
