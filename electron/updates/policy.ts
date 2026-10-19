/**
 * Update decisions that do not touch the network, the filesystem, or Electron.
 * The renderer may import this module. Keep it free of Node built-ins.
 */

export const GITHUB_OWNER = 'Unwrenchable';
export const GITHUB_REPO = 'EditPro';

/** While EditPro is open, look for a release on this cadence. */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Wait for the window before the first automatic check. */
export const LAUNCH_CHECK_DELAY_MS = 5_000;

export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const VERSION_RE = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;
const RELEASE_PATH = `/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const MAX_NOTES = 4_000;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export type UpdateDelivery = 'electron-updater' | 'github-release';

export interface InstallFacts {
  platform: string;
  packaged: boolean;
  portable: boolean;
  appImage: boolean;
  signed: boolean;
}

export interface AvailableUpdate {
  version: string;
  releaseName: string;
  notes: string;
  releaseUrl: string;
  canAutoInstall: boolean;
}

export interface AppPreferences {
  automaticUpdateChecks: boolean;
  skippedVersion: string | null;
  snoozeUntil: number | null;
  crashLogging: boolean;
  onboardingComplete: boolean;
}

export interface PreferencePatch {
  automaticUpdateChecks?: boolean;
  crashLogging?: boolean;
  onboardingComplete?: boolean;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
}

export type UpdateDialogState =
  | { type: 'hidden' }
  | { type: 'checking' }
  | { type: 'up-to-date'; version: string }
  | { type: 'error'; message: string }
  | {
      type: 'available';
      source: 'manual' | 'automatic';
      update: AvailableUpdate;
      downloaded: boolean;
      progress: UpdateProgress | null;
      error: string | null;
    };

export type UpdateEvent =
  | { type: 'idle'; manual: boolean }
  | { type: 'up-to-date'; manual: boolean; version: string; notify: boolean }
  | { type: 'available'; manual: boolean; update: AvailableUpdate; notify: boolean }
  | { type: 'error'; manual: boolean; message: string; notify: boolean }
  | { type: 'progress'; percent: number; transferred: number; total: number }
  | { type: 'downloaded'; version: string }
  | { type: 'download-error'; message: string }
  | { type: 'dismissed' };

export const DEFAULT_PREFERENCES: AppPreferences = {
  automaticUpdateChecks: true,
  skippedVersion: null,
  snoozeUntil: null,
  crashLogging: false,
  onboardingComplete: false,
};

export function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null;
  const match = VERSION_RE.exec(input.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.').filter((part) => part.length > 0) : [],
  };
}

export function formatVersion(version: ParsedVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease.length > 0 ? `${core}-${version.prerelease.join('.')}` : core;
}

export function normalizeVersion(input: string): string | null {
  const parsed = parseVersion(input);
  return parsed ? formatVersion(parsed) : null;
}

/** Negative when `left` is older, positive when it is newer, null when either side is not a version. */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const l = a.prerelease[i];
    const r = b.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff;
      continue;
    }
    if (lNum !== rNum) return lNum ? -1 : 1;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(latest: string, current: string): boolean {
  const diff = compareVersions(latest, current);
  return diff != null && diff > 0;
}

export function installSignalsFromEnv(env: Record<string, string | undefined>): {
  portable: boolean;
  appImage: boolean;
} {
  return {
    portable: Boolean(env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_DIR),
    appImage: typeof env.APPIMAGE === 'string' && env.APPIMAGE.length > 0,
  };
}

/**
 * electron-updater can install a signed macOS zip and a signed Windows NSIS build.
 * Unsigned builds, portable exes, AppImages, and other Linux packages open the
 * GitHub release instead of trying to replace the running app.
 */
export function classifyInstall(facts: InstallFacts): UpdateDelivery {
  if (!facts.packaged || facts.portable || facts.appImage) return 'github-release';
  if (facts.platform !== 'darwin' && facts.platform !== 'win32') return 'github-release';
  if (!facts.signed) return 'github-release';
  return 'electron-updater';
}

export function isEditProReleaseUrl(input: string): boolean {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2048) return false;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  if (parsed.hostname !== 'github.com') return false;
  return parsed.pathname === RELEASE_PATH || parsed.pathname.startsWith(`${RELEASE_PATH}/`);
}

export function releasePageUrl(version: string, candidate?: unknown): string {
  const normalized = normalizeVersion(version);
  if (!normalized) throw new Error('Invalid release version');
  const fallback = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${normalized}`;
  if (typeof candidate === 'string' && isEditProReleaseUrl(candidate)) return new URL(candidate).href;
  return fallback;
}

export function plainReleaseNotes(input: string): string {
  const withoutMarkup = input
    .replace(/\r\n/g, '\n')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '');
  const decoded = withoutMarkup
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const trimmed = decoded.replace(/\n{3,}/g, '\n\n').trim();
  if (trimmed.length <= MAX_NOTES) return trimmed;
  return `${trimmed.slice(0, MAX_NOTES - 1).trimEnd()}…`;
}

export function notesToPlain(notes: unknown): string {
  if (typeof notes === 'string') return plainReleaseNotes(notes);
  if (!Array.isArray(notes)) return '';
  const parts = notes.map((entry) => {
    if (!entry || typeof entry !== 'object') return '';
    const note = (entry as { note?: unknown }).note;
    return typeof note === 'string' ? note : '';
  });
  return plainReleaseNotes(parts.filter((part) => part.trim().length > 0).join('\n\n'));
}

export function updateFromGitHubRelease(
  payload: unknown,
  currentVersion: string,
  canAutoInstall = false,
): AvailableUpdate | null {
  if (!payload || typeof payload !== 'object') return null;
  const release = payload as Record<string, unknown>;
  if (release.draft === true || release.prerelease === true) return null;
  if (typeof release.tag_name !== 'string') return null;
  const version = normalizeVersion(release.tag_name);
  if (!version || !isNewerVersion(version, currentVersion)) return null;
  const releaseName =
    typeof release.name === 'string' && release.name.trim().length > 0
      ? release.name.trim().slice(0, 200)
      : `EditPro ${version}`;
  return {
    version,
    releaseName,
    notes: notesToPlain(typeof release.body === 'string' ? release.body : ''),
    releaseUrl: releasePageUrl(version, release.html_url),
    canAutoInstall,
  };
}

export function shouldNotify(input: {
  manual: boolean;
  version: string;
  skippedVersion: string | null;
  snoozeUntil: number | null;
  now: number;
}): boolean {
  if (input.manual) return true;
  if (input.snoozeUntil != null && input.now < input.snoozeUntil) return false;
  if (input.skippedVersion != null && input.skippedVersion === input.version) return false;
  return true;
}

export function sanitizePreferences(input: unknown): AppPreferences {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const skipped = typeof record.skippedVersion === 'string' ? normalizeVersion(record.skippedVersion) : null;
  const snooze =
    typeof record.snoozeUntil === 'number' && Number.isFinite(record.snoozeUntil) ? record.snoozeUntil : null;
  return {
    automaticUpdateChecks:
      record.automaticUpdateChecks === undefined ? true : record.automaticUpdateChecks === true,
    skippedVersion: skipped,
    snoozeUntil: snooze,
    crashLogging: record.crashLogging === true,
    onboardingComplete: record.onboardingComplete === true,
  };
}

const PATCH_KEYS = ['automaticUpdateChecks', 'crashLogging', 'onboardingComplete'] as const;

export function applyPreferencePatch(current: AppPreferences, patch: unknown): AppPreferences {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid preferences');
  const record = patch as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!PATCH_KEYS.includes(key as (typeof PATCH_KEYS)[number])) {
      throw new Error('Invalid preferences');
    }
  }
  const next: AppPreferences = { ...current };
  for (const key of PATCH_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (typeof value !== 'boolean') throw new Error('Invalid preferences');
    next[key] = value;
  }
  return next;
}

export function skipVersion(current: AppPreferences, version: string): AppPreferences | null {
  const normalized = normalizeVersion(version);
  if (!normalized) return null;
  return { ...current, skippedVersion: normalized };
}

export function remindLater(
  current: AppPreferences,
  now: number,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
): AppPreferences {
  return { ...current, snoozeUntil: now + intervalMs };
}

export function publicUpdateError(error: unknown, action: 'check' | 'download' | 'install'): string {
  const fallback = {
    check: 'Could not check for updates. Try again in a few minutes.',
    download: 'The download did not finish. You can retry, or download the release from the website.',
    install: 'EditPro could not restart into the update. Download the release from the website instead.',
  }[action];
  const raw = error instanceof Error ? error.message : '';
  let clean = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    clean += code <= 0x1f || code === 0x7f ? ' ' : raw[i];
  }
  clean = clean.replace(/ +/g, ' ').trim();
  if (!clean || clean.length > 180 || /[\\/]/.test(clean) || /token|secret|bearer|ghp_/i.test(clean)) {
    return fallback;
  }
  return clean;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function finiteByteCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

export function reduceUpdateDialog(current: UpdateDialogState, event: UpdateEvent): UpdateDialogState {
  switch (event.type) {
    case 'idle':
    case 'dismissed':
      return current.type === 'checking' || event.type === 'dismissed' ? { type: 'hidden' } : current;
    case 'up-to-date':
      if (!event.notify) return current.type === 'checking' ? { type: 'hidden' } : current;
      return { type: 'up-to-date', version: event.version };
    case 'error':
      if (!event.notify) return current.type === 'checking' ? { type: 'hidden' } : current;
      return { type: 'error', message: event.message };
    case 'available': {
      if (!event.notify) return current.type === 'checking' ? { type: 'hidden' } : current;
      const same =
        current.type === 'available' && current.update.version === event.update.version;
      return {
        type: 'available',
        source: event.manual ? 'manual' : 'automatic',
        update: event.update,
        downloaded: same ? current.downloaded : false,
        progress: same ? current.progress : null,
        error: null,
      };
    }
    case 'progress':
      if (current.type !== 'available' || current.downloaded) return current;
      return {
        ...current,
        error: null,
        progress: {
          percent: clampPercent(event.percent),
          transferred: finiteByteCount(event.transferred),
          total: finiteByteCount(event.total),
        },
      };
    case 'downloaded':
      if (current.type !== 'available' || current.update.version !== event.version) return current;
      return { ...current, downloaded: true, progress: null, error: null };
    case 'download-error':
      if (current.type !== 'available') return { type: 'error', message: event.message };
      return { ...current, progress: null, downloaded: false, error: event.message };
    default:
      return current;
  }
}

function isProgress(value: unknown): value is UpdateProgress {
  if (!value || typeof value !== 'object') return false;
  const progress = value as Record<string, unknown>;
  return (
    typeof progress.percent === 'number' &&
    progress.percent >= 0 &&
    progress.percent <= 100 &&
    typeof progress.transferred === 'number' &&
    typeof progress.total === 'number'
  );
}

function isAvailableUpdate(value: unknown): value is AvailableUpdate {
  if (!value || typeof value !== 'object') return false;
  const update = value as Record<string, unknown>;
  return (
    typeof update.version === 'string' &&
    parseVersion(update.version) != null &&
    typeof update.releaseName === 'string' &&
    update.releaseName.length > 0 &&
    update.releaseName.length <= 200 &&
    typeof update.notes === 'string' &&
    update.notes.length <= MAX_NOTES + 1 &&
    typeof update.releaseUrl === 'string' &&
    isEditProReleaseUrl(update.releaseUrl) &&
    typeof update.canAutoInstall === 'boolean'
  );
}

export function isUpdateDialogState(value: unknown): value is UpdateDialogState {
  if (!value || typeof value !== 'object') return false;
  const dialog = value as Record<string, unknown>;
  if (dialog.type === 'hidden' || dialog.type === 'checking') return true;
  if (dialog.type === 'up-to-date') {
    return typeof dialog.version === 'string' && parseVersion(dialog.version) != null;
  }
  if (dialog.type === 'error') {
    return typeof dialog.message === 'string' && dialog.message.length > 0 && dialog.message.length <= 500;
  }
  if (dialog.type !== 'available') return false;
  if (dialog.source !== 'manual' && dialog.source !== 'automatic') return false;
  if (typeof dialog.downloaded !== 'boolean') return false;
  if (dialog.progress != null && !isProgress(dialog.progress)) return false;
  if (dialog.error != null && (typeof dialog.error !== 'string' || dialog.error.length === 0 || dialog.error.length > 500)) {
    return false;
  }
  return isAvailableUpdate(dialog.update);
}
