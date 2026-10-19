/**
 * Resolve a user-picked File to a filesystem path ffmpeg can open.
 * Electron 32+ removes File.path in the renderer; the preload bridge uses
 * webUtils.getPathForFile. Older Electron builds still expose File.path.
 */
export function resolveSourcePath(
  file: File,
  bridge?: { getPathForFile?: (file: File) => string }
): string | null {
  try {
    const fromBridge = bridge?.getPathForFile?.(file);
    if (typeof fromBridge === 'string' && fromBridge.length > 0) return fromBridge;
  } catch {
    // Fall through to the legacy path property.
  }
  const legacy = (file as File & { path?: string }).path;
  if (typeof legacy === 'string' && legacy.length > 0) return legacy;
  return null;
}
