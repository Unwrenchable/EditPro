import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function projectRoot(): string {
  return root;
}

function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return { ...env, ...extra };
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
}

/**
 * Launch the production renderer.
 * EDITPRO_EXECUTABLE points at an electron-builder binary (app.isPackaged).
 * Without it, the repo's Electron binary loads dist/ via EDITPRO_LOAD_DIST.
 */
export async function launchEditPro(extraSwitches: string[] = []): Promise<LaunchedApp> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'editpro-e2e-'));
  fs.writeFileSync(
    path.join(userData, 'preferences.json'),
    JSON.stringify({
      automaticUpdateChecks: false,
      skippedVersion: null,
      snoozeUntil: null,
      crashLogging: false,
      onboardingComplete: false,
    }),
  );
  const switches = ['--no-sandbox', '--disable-dev-shm-usage', `--user-data-dir=${userData}`, ...extraSwitches];
  const packaged = process.env.EDITPRO_EXECUTABLE;
  const executablePath = packaged && packaged.length > 0 ? packaged : (require('electron') as string);
  const args = packaged
    ? switches
    : [path.join(root, 'dist-electron', 'main.js'), ...switches];
  if (!packaged) {
    const renderer = path.join(root, 'dist', 'index.html');
    const main = path.join(root, 'dist-electron', 'main.js');
    if (!fs.existsSync(renderer) || !fs.existsSync(main)) {
      throw new Error('Build the app first with npm run build:electron');
    }
  }
  const app = await electron.launch({
    executablePath,
    args,
    env: childEnv(packaged ? {} : { NODE_ENV: 'production', EDITPRO_LOAD_DIST: '1' }),
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, userData };
}

export interface MediaFixture {
  file: string;
  durationSec: number;
  frameRate: number;
}

/** Short color-bar clip the import → timeline → play → export smoke can finish quickly. */
export async function writeMediaFixture(directory: string): Promise<MediaFixture> {
  const ffmpeg = require('ffmpeg-static') as string;
  const file = path.join(directory, 'bars.mp4');
  const durationSec = 4;
  const frameRate = 30;
  fs.mkdirSync(directory, { recursive: true });
  await execFileAsync(ffmpeg, [
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc=size=320x240:rate=${frameRate}:duration=${durationSec}`,
    '-f', 'lavfi',
    '-i', `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'veryfast',
    '-c:a', 'aac',
    '-shortest',
    file,
  ], { timeout: 60_000 });
  return { file, durationSec, frameRate };
}
