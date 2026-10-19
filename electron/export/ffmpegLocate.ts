/**
 * Locate the ffmpeg binary shipped with ffmpeg-static.
 * Packaged builds must not execute a binary trapped inside app.asar, so
 * Windows/macOS/Linux packages copy it with electron-builder extraResources
 * and asarUnpack. See package.json "build.extraResources" and "asarUnpack".
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { resolveFfmpegBinary } from './plan.js';

export function loadFfmpegStaticPath(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require('ffmpeg-static') as string | null;
    return typeof resolved === 'string' && resolved.length > 0 ? resolved : null;
  } catch {
    return null;
  }
}

export function locateFfmpegBinary(options: {
  packaged: boolean;
  platform: string;
  resourcesPath: string;
}): string {
  return resolveFfmpegBinary({
    ...options,
    ffmpegStaticPath: loadFfmpegStaticPath(),
    exists: (candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    },
  });
}

export async function ensureFfmpegExecutable(filePath: string, platform: string): Promise<void> {
  if (platform === 'win32') return;
  try {
    await fs.promises.chmod(filePath, 0o755);
  } catch {
    // Spawn will report EACCES with a clearer message if this was required.
  }
}
