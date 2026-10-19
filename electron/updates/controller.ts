/**
 * Desktop support that stays in the main process: update checks, preferences,
 * and the opt-in crash log. IPC is accepted only after the caller verifies the sender.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { runUpdateCheck } from './check.js';
import { fetchLatestGitHubRelease } from './github.js';
import { probeSignature } from './installProfile.js';
import { CrashLog, clientErrorMessage } from './logger.js';
import {
  GITHUB_OWNER,
  GITHUB_REPO,
  LAUNCH_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
  applyPreferencePatch,
  classifyInstall,
  installSignalsFromEnv,
  isNewerVersion,
  normalizeVersion,
  notesToPlain,
  publicUpdateError,
  reduceUpdateDialog,
  releasePageUrl,
  remindLater,
  skipVersion,
  type AppPreferences,
  type AvailableUpdate,
  type UpdateDelivery,
  type UpdateDialogState,
  type UpdateEvent,
} from './policy.js';
import { readPreferencesFile, writePreferencesFile } from './preferences.js';

const require = createRequire(import.meta.url);

interface IpcEvent {
  sender: Electron.WebContents;
  senderFrame: Electron.WebFrameMain | null;
}

interface ProgressInfo {
  percent: number;
  transferred: number;
  total: number;
}

interface UpdaterReleaseInfo {
  version?: string;
  releaseName?: string | null;
  releaseNotes?: unknown;
}

interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  allowPrerelease: boolean;
  logger: { info: (message?: unknown) => void; warn: (message?: unknown) => void; error: (message?: unknown) => void } | null;
  setFeedURL(options: { provider: 'github'; owner: string; repo: string }): void;
  checkForUpdates(): Promise<{ isUpdateAvailable?: boolean; updateInfo?: UpdaterReleaseInfo } | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): void;
}

export interface DesktopSupport {
  checkForUpdates(manual?: boolean): Promise<void>;
  openLogFile(): Promise<void>;
  startScheduler(): void;
}

function execCommand(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 8_000, windowsHide: true, env }, (error, stdout) => {
      const status = (error as { status?: number } | null)?.status;
      resolve({
        code: typeof status === 'number' ? status : error ? 1 : 0,
        stdout: stdout?.toString() ?? '',
      });
    });
  });
}

export function createDesktopSupport(options: {
  getWindow: () => BrowserWindow | null;
  userData: string;
  version: string;
  isPackaged: boolean;
  assertTrusted: (event: IpcEvent) => void;
}): DesktopSupport {
  const preferencePath = path.join(options.userData, 'preferences.json');
  const log = new CrashLog(path.join(options.userData, 'logs', 'editpro.log'), readPreferencesFile(preferencePath).crashLogging);
  let dialogState: UpdateDialogState = { type: 'hidden' };
  let delivery: UpdateDelivery | null = null;
  let updater: AutoUpdaterLike | null = null;
  let downloading = false;
  let chain: Promise<void> = Promise.resolve();
  let disposed = false;

  function publish(next: UpdateDialogState): void {
    dialogState = next;
    const win = options.getWindow();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('updates:state', next);
  }

  function apply(event: UpdateEvent): void {
    publish(reduceUpdateDialog(dialogState, event));
  }

  function readPrefs(): AppPreferences {
    return readPreferencesFile(preferencePath);
  }

  function writePrefs(preferences: AppPreferences): AppPreferences {
    writePreferencesFile(preferencePath, preferences);
    const wasEnabled = log.isEnabled;
    log.setEnabled(preferences.crashLogging);
    if (preferences.crashLogging && !wasEnabled) {
      log.write('info', 'Crash logging is on. EditPro records errors in this file on this computer.');
    }
    return preferences;
  }

  function loadUpdater(): AutoUpdaterLike {
    if (updater) return updater;
    const mod = require('electron-updater') as { autoUpdater: AutoUpdaterLike };
    updater = mod.autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowPrerelease = false;
    updater.logger = {
      info: () => undefined,
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
    };
    updater.setFeedURL({ provider: 'github', owner: GITHUB_OWNER, repo: GITHUB_REPO });
    updater.on('download-progress', (info) => {
      if (downloading) {
        apply({
          type: 'progress',
          percent: info.percent,
          transferred: info.transferred,
          total: info.total,
        });
      }
    });
    return updater;
  }

  async function checkWithElectronUpdater(): Promise<AvailableUpdate | null> {
    const result = await loadUpdater().checkForUpdates();
    if (!result?.isUpdateAvailable || !result.updateInfo) return null;
    const version = normalizeVersion(result.updateInfo.version ?? '');
    if (!version || !isNewerVersion(version, options.version)) return null;
    const releaseName = result.updateInfo.releaseName?.trim();
    return {
      version,
      releaseName: releaseName ? releaseName.slice(0, 200) : `EditPro ${version}`,
      notes: notesToPlain(result.updateInfo.releaseNotes),
      releaseUrl: releasePageUrl(version),
      canAutoInstall: true,
    };
  }

  async function resolveDelivery(): Promise<UpdateDelivery> {
    if (delivery) return delivery;
    const signals = installSignalsFromEnv(process.env);
    let signed = false;
    if (
      options.isPackaged &&
      !signals.portable &&
      !signals.appImage &&
      (process.platform === 'darwin' || process.platform === 'win32')
    ) {
      try {
        signed = await probeSignature({
          platform: process.platform,
          exePath: app.getPath('exe'),
          execFile: execCommand,
        });
      } catch {
        signed = false;
      }
    }
    delivery = classifyInstall({
      platform: process.platform,
      packaged: options.isPackaged,
      portable: signals.portable,
      appImage: signals.appImage,
      signed,
    });
    return delivery;
  }

  async function checkNow(manual: boolean): Promise<void> {
    if (disposed || downloading) return;
    if (!manual && dialogState.type === 'available') return;
    const preferences = readPrefs();
    if (!manual && !preferences.automaticUpdateChecks) return;
    if (manual) publish({ type: 'checking' });
    const event = await runUpdateCheck(
      {
        manual,
        now: Date.now(),
        currentVersion: options.version,
        delivery: await resolveDelivery(),
        preferences,
      },
      {
        electronUpdater: async () => {
          try {
            return await checkWithElectronUpdater();
          } catch (error) {
            log.write('error', 'electron-updater could not check for updates; using the GitHub Releases API.');
            console.error('EditPro electron-updater check failed', error);
            throw error;
          }
        },
        github: () => fetchLatestGitHubRelease({ currentVersion: options.version }),
      },
    );
    if (event.type === 'error') log.write('error', `update check failed: ${event.message}`);
    apply(event);
  }

  function enqueue(manual: boolean): Promise<void> {
    const run = chain.then(() => checkNow(manual));
    chain = run.catch((error) => {
      const message = publicUpdateError(error, 'check');
      log.write('error', `update check failed: ${message}`);
      apply({ type: 'error', manual, message, notify: manual });
    });
    return chain;
  }

  async function openLogFile(): Promise<void> {
    if (!log.exists()) {
      const parent = options.getWindow();
      const detail = log.isEnabled
        ? 'Crash logging is on. This file will appear after EditPro records an error.'
        : 'Crash logging is off. Turn it on in Settings to save errors in a log file on this computer.';
      const messageBox = { type: 'info' as const, title: 'EditPro Log', message: 'No log file yet', detail };
      if (parent && !parent.isDestroyed()) await dialog.showMessageBox(parent, messageBox);
      else await dialog.showMessageBox(messageBox);
      return;
    }
    const opened = await shell.openPath(log.filePath);
    if (!opened) return;
    const parent = options.getWindow();
    const messageBox = {
      type: 'warning' as const,
      title: 'EditPro Log',
      message: 'Could not open the log file',
      detail: opened,
    };
    if (parent && !parent.isDestroyed()) await dialog.showMessageBox(parent, messageBox);
    else await dialog.showMessageBox(messageBox);
  }

  ipcMain.handle('prefs:get', (event) => {
    options.assertTrusted(event);
    return readPrefs();
  });

  ipcMain.handle('prefs:set', (event, patch: unknown) => {
    options.assertTrusted(event);
    return writePrefs(applyPreferencePatch(readPrefs(), patch));
  });

  ipcMain.handle('updates:getState', (event) => {
    options.assertTrusted(event);
    return dialogState;
  });

  ipcMain.handle('updates:check', (event) => {
    options.assertTrusted(event);
    return enqueue(true);
  });

  ipcMain.handle('updates:download', async (event) => {
    options.assertTrusted(event);
    if (dialogState.type !== 'available' || !dialogState.update.canAutoInstall || downloading) {
      throw new Error('This update has to be downloaded from the website.');
    }
    if (dialogState.downloaded) return true;
    const version = dialogState.update.version;
    downloading = true;
    publish({ ...dialogState, error: null, progress: { percent: 0, transferred: 0, total: 0 } });
    try {
      await loadUpdater().downloadUpdate();
      downloading = false;
      if (dialogState.type === 'available' && dialogState.update.version === version) {
        apply({ type: 'downloaded', version });
      }
      return true;
    } catch (error) {
      downloading = false;
      const message = publicUpdateError(error, 'download');
      log.write('error', `update download failed: ${message}`);
      apply({ type: 'download-error', message });
      throw new Error(message);
    }
  });

  ipcMain.handle('updates:install', (event) => {
    options.assertTrusted(event);
    if (dialogState.type !== 'available' || !dialogState.downloaded) {
      throw new Error('The update is not ready to install.');
    }
    try {
      loadUpdater().quitAndInstall(true, true);
      return true;
    } catch (error) {
      const message = publicUpdateError(error, 'install');
      log.write('error', `update install failed: ${message}`);
      apply({ type: 'download-error', message });
      throw new Error(message);
    }
  });

  ipcMain.handle('updates:skip', (event, version: unknown) => {
    options.assertTrusted(event);
    if (dialogState.type !== 'available' || typeof version !== 'string') {
      throw new Error('That version is not the update being offered.');
    }
    if (normalizeVersion(version) !== dialogState.update.version) {
      throw new Error('That version is not the update being offered.');
    }
    const next = skipVersion(readPrefs(), dialogState.update.version);
    if (!next) throw new Error('That version is not the update being offered.');
    writePrefs(next);
    apply({ type: 'dismissed' });
    return true;
  });

  ipcMain.handle('updates:remind', (event) => {
    options.assertTrusted(event);
    writePrefs(remindLater(readPrefs(), Date.now()));
    apply({ type: 'dismissed' });
    return true;
  });

  ipcMain.handle('updates:dismiss', (event) => {
    options.assertTrusted(event);
    apply({ type: 'dismissed' });
    return true;
  });

  ipcMain.handle('logs:record', (event, report: unknown) => {
    options.assertTrusted(event);
    const message = clientErrorMessage(report);
    if (!message) return false;
    log.write('error', message);
    return log.isEnabled;
  });

  process.on('uncaughtExceptionMonitor', (error) => {
    log.write('error', `uncaughtException: ${error.stack || error.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    log.write('error', `unhandledRejection: ${error.stack || error.message}`);
    throw error;
  });
  app.on('render-process-gone', (_event, _contents, details) => {
    if (details.reason === 'clean-exit') return;
    log.write('error', `render-process-gone: ${details.reason} (exit ${details.exitCode})`);
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    log.write('error', `child-process-gone: ${details.type} ${details.reason} (exit ${details.exitCode})`);
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('unresponsive', () => {
      log.write('error', 'renderer unresponsive');
    });
  });

  let stopTimer = (): void => undefined;

  return {
    checkForUpdates: (manual = true) => enqueue(manual),
    openLogFile,
    startScheduler() {
      const kick = setTimeout(() => {
        void enqueue(false);
      }, LAUNCH_CHECK_DELAY_MS);
      const timer = setInterval(() => {
        void enqueue(false);
      }, UPDATE_CHECK_INTERVAL_MS);
      stopTimer = () => {
        clearTimeout(kick);
        clearInterval(timer);
      };
      app.on('will-quit', () => {
        disposed = true;
        stopTimer();
      });
    },
  };
}
