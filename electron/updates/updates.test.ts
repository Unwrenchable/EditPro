// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runUpdateCheck } from './check';
import { UpdateLookupError, fetchLatestGitHubRelease } from './github';
import { probeSignature } from './installProfile';
import { CrashLog, clientErrorMessage, formatLogEntry, nextLogContents } from './logger';
import {
  DEFAULT_PREFERENCES,
  applyPreferencePatch,
  classifyInstall,
  compareVersions,
  installSignalsFromEnv,
  isEditProReleaseUrl,
  isUpdateDialogState,
  plainReleaseNotes,
  publicUpdateError,
  reduceUpdateDialog,
  releasePageUrl,
  remindLater,
  sanitizePreferences,
  shouldNotify,
  skipVersion,
  updateFromGitHubRelease,
} from './policy';
import { readPreferencesFile, writePreferencesFile } from './preferences';

const release = {
  tag_name: 'v1.2.0',
  name: 'EditPro 1.2.0',
  body: '## Fixes\n\n- Steadier playback\n\n<script>alert(1)</script><b>Bold</b> [notes](https://example.com)',
  html_url: 'https://github.com/Unwrenchable/EditPro/releases/tag/v1.2.0',
  draft: false,
  prerelease: false,
};

describe('version comparison', () => {
  it('orders numeric segments and ignores a leading v', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
  });

  it('treats a release as newer than its prerelease', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
  });

  it('rejects versions that are not major.minor.patch', () => {
    expect(compareVersions('1.0', '1.0.0')).toBeNull();
    expect(compareVersions('../1.2.3', '1.0.0')).toBeNull();
  });
});

describe('install delivery', () => {
  it('uses electron-updater only for signed macOS and Windows installs', () => {
    expect(classifyInstall({ platform: 'darwin', packaged: true, portable: false, appImage: false, signed: true })).toBe(
      'electron-updater',
    );
    expect(classifyInstall({ platform: 'win32', packaged: true, portable: false, appImage: false, signed: true })).toBe(
      'electron-updater',
    );
  });

  it('falls back when the build is unsigned, unpackaged, portable, an AppImage, or not auto-installable', () => {
    const signedMac = { platform: 'darwin' as const, packaged: true, portable: false, appImage: false, signed: true };
    expect(classifyInstall({ ...signedMac, signed: false })).toBe('github-release');
    expect(classifyInstall({ ...signedMac, packaged: false })).toBe('github-release');
    expect(classifyInstall({ ...signedMac, platform: 'win32', portable: true })).toBe('github-release');
    expect(classifyInstall({ ...signedMac, platform: 'linux', appImage: true })).toBe('github-release');
    expect(classifyInstall({ platform: 'linux', packaged: true, portable: false, appImage: false, signed: true })).toBe(
      'github-release',
    );
  });

  it('reads portable and AppImage markers from the environment', () => {
    expect(installSignalsFromEnv({ PORTABLE_EXECUTABLE_FILE: 'C:\\EditPro.exe' })).toEqual({
      portable: true,
      appImage: false,
    });
    expect(installSignalsFromEnv({ APPIMAGE: '/tmp/EditPro.AppImage' })).toEqual({
      portable: false,
      appImage: true,
    });
    expect(installSignalsFromEnv({ APPIMAGE: '' })).toEqual({ portable: false, appImage: false });
  });
});

describe('GitHub release parsing', () => {
  it('turns a newer stable release into plain-text notes and a release page', () => {
    const update = updateFromGitHubRelease(release, '1.0.0', true);
    expect(update).toMatchObject({
      version: '1.2.0',
      releaseName: 'EditPro 1.2.0',
      releaseUrl: 'https://github.com/Unwrenchable/EditPro/releases/tag/v1.2.0',
      canAutoInstall: true,
    });
    expect(update?.notes).toContain('Steadier playback');
    expect(update?.notes).toContain('Bold');
    expect(update?.notes).not.toContain('<script>');
    expect(update?.notes).not.toContain('https://example.com');
  });

  it('ignores drafts, prereleases, and versions that are not newer', () => {
    expect(updateFromGitHubRelease({ ...release, draft: true }, '1.0.0')).toBeNull();
    expect(updateFromGitHubRelease({ ...release, prerelease: true }, '1.0.0')).toBeNull();
    expect(updateFromGitHubRelease(release, '1.2.0')).toBeNull();
    expect(updateFromGitHubRelease(release, '2.0.0')).toBeNull();
  });

  it('refuses release pages that are not this repository', () => {
    expect(isEditProReleaseUrl('https://github.com/Unwrenchable/EditPro/releases/tag/v1.2.0')).toBe(true);
    expect(isEditProReleaseUrl('https://github.com/other/EditPro/releases/tag/v1.2.0')).toBe(false);
    expect(isEditProReleaseUrl('http://github.com/Unwrenchable/EditPro/releases/tag/v1.2.0')).toBe(false);
    expect(isEditProReleaseUrl('https://github.com.evil.test/Unwrenchable/EditPro/releases')).toBe(false);
    expect(isEditProReleaseUrl('javascript:alert(1)')).toBe(false);
    const update = updateFromGitHubRelease(
      { ...release, html_url: 'https://evil.example/releases/tag/v1.2.0' },
      '1.0.0',
    );
    expect(update?.releaseUrl).toBe('https://github.com/Unwrenchable/EditPro/releases/tag/v1.2.0');
  });

  it('builds a safe tag url from the version', () => {
    expect(releasePageUrl('v1.2.3')).toBe('https://github.com/Unwrenchable/EditPro/releases/tag/v1.2.3');
    expect(() => releasePageUrl('not a version')).toThrow(/Invalid release version/);
  });
});

describe('release notes and errors', () => {
  it('caps very long notes', () => {
    const notes = plainReleaseNotes('a'.repeat(5_000));
    expect(notes.length).toBeLessThanOrEqual(4_000);
    expect(notes.endsWith('…')).toBe(true);
  });

  it('hides paths and secrets from update errors', () => {
    expect(publicUpdateError(new Error('C:\\Users\\sam\\EditPro.exe missing'), 'download')).toMatch(/did not finish/);
    expect(publicUpdateError(new Error('bad ghp_secret'), 'check')).toMatch(/Try again/);
    expect(publicUpdateError(new Error('GitHub rate limit reached. Try again later.'), 'check')).toBe(
      'GitHub rate limit reached. Try again later.',
    );
  });
});

describe('notification policy', () => {
  const update = updateFromGitHubRelease(release, '1.0.0')!;

  it('stays quiet for a skipped or snoozed version until the user asks or a newer one ships', () => {
    expect(shouldNotify({ manual: false, version: '1.2.0', skippedVersion: '1.2.0', snoozeUntil: null, now: 0 })).toBe(false);
    expect(shouldNotify({ manual: false, version: '1.3.0', skippedVersion: '1.2.0', snoozeUntil: 5_000, now: 1_000 })).toBe(false);
    expect(shouldNotify({ manual: true, version: '1.2.0', skippedVersion: '1.2.0', snoozeUntil: 5_000, now: 1_000 })).toBe(true);
    expect(shouldNotify({ manual: false, version: '1.3.0', skippedVersion: '1.2.0', snoozeUntil: 5_000, now: 5_000 })).toBe(true);
    expect(
      reduceUpdateDialog({ type: 'hidden' }, { type: 'available', manual: false, update, notify: false }),
    ).toEqual({ type: 'hidden' });
  });
});

describe('dialog reducer', () => {
  const update = updateFromGitHubRelease(release, '1.0.0', true)!;

  it('keeps an automatic miss from leaving a manual check stuck', () => {
    expect(reduceUpdateDialog({ type: 'checking' }, { type: 'idle', manual: false })).toEqual({ type: 'hidden' });
    expect(
      reduceUpdateDialog(
        { type: 'checking' },
        { type: 'up-to-date', manual: false, version: '1.0.0', notify: false },
      ),
    ).toEqual({ type: 'hidden' });
  });

  it('tracks download progress and then the restart state', () => {
    const available = reduceUpdateDialog(
      { type: 'hidden' },
      { type: 'available', manual: true, update, notify: true },
    );
    const progress = reduceUpdateDialog(available, { type: 'progress', percent: 41.2, transferred: 10, total: 40 });
    expect(progress).toMatchObject({ type: 'available', progress: { percent: 41, transferred: 10, total: 40 } });
    const done = reduceUpdateDialog(progress, { type: 'downloaded', version: '1.2.0' });
    expect(done).toMatchObject({ type: 'available', downloaded: true, progress: null });
    expect(reduceUpdateDialog(done, { type: 'progress', percent: 90, transferred: 1, total: 1 })).toBe(done);
  });

  it('rejects a dialog whose release link is not EditPro', () => {
    expect(isUpdateDialogState({ type: 'checking' })).toBe(true);
    expect(
      isUpdateDialogState({
        type: 'available',
        source: 'manual',
        downloaded: false,
        progress: null,
        error: null,
        update: { ...update, releaseUrl: 'https://example.com/release' },
      }),
    ).toBe(false);
  });
});

describe('preferences', () => {
  it('defaults automatic checks on and crash logging off', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({ automaticUpdateChecks: false, crashLogging: true, skippedVersion: 'v1.4.0' })).toMatchObject({
      automaticUpdateChecks: false,
      crashLogging: true,
      skippedVersion: '1.4.0',
      onboardingComplete: false,
    });
  });

  it('accepts the settings toggles and refuses other fields', () => {
    const next = applyPreferencePatch(DEFAULT_PREFERENCES, { onboardingComplete: true, crashLogging: true });
    expect(next.onboardingComplete).toBe(true);
    expect(next.crashLogging).toBe(true);
    expect(() => applyPreferencePatch(DEFAULT_PREFERENCES, { skippedVersion: '9.9.9' })).toThrow(/Invalid preferences/);
    expect(skipVersion(DEFAULT_PREFERENCES, 'v1.2.0')?.skippedVersion).toBe('1.2.0');
    expect(remindLater(DEFAULT_PREFERENCES, 1_000, 50).snoozeUntil).toBe(1_050);
  });

  it('round-trips the preference file and recovers from a corrupt one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editpro-prefs-'));
    const file = path.join(dir, 'preferences.json');
    writePreferencesFile(file, { ...DEFAULT_PREFERENCES, onboardingComplete: true });
    expect(readPreferencesFile(file).onboardingComplete).toBe(true);
    fs.writeFileSync(file, '{');
    expect(readPreferencesFile(file)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('crash log', () => {
  it('formats, rotates, and ignores empty renderer reports', () => {
    const entry = formatLogEntry(new Date('2026-10-19T12:00:00.000Z'), 'error', 'render-process-gone: crashed');
    expect(entry).toBe('[2026-10-19T12:00:00.000Z] ERROR render-process-gone: crashed\n');
    const rotated = nextLogContents(`${'old line\n'.repeat(8)}`, 'new line\n', 40, 16);
    expect(rotated.startsWith('… log truncated …\n')).toBe(true);
    expect(clientErrorMessage({ message: '  boom ', stack: 'Error: boom', source: 'app.tsx' })).toContain('boom');
    expect(clientErrorMessage({ message: '   ' })).toBeNull();
    expect(clientErrorMessage(null)).toBeNull();
  });

  it('writes only after the user opts in, and caps the write rate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editpro-log-'));
    const file = path.join(dir, 'logs', 'editpro.log');
    const log = new CrashLog(file, false, { maxPerMinute: 2 });
    log.write('error', 'hidden');
    expect(log.exists()).toBe(false);
    log.setEnabled(true);
    log.write('error', 'first');
    log.write('error', 'second');
    log.write('error', 'third');
    const body = fs.readFileSync(file, 'utf8');
    expect(body).toContain('first');
    expect(body).toContain('second');
    expect(body).not.toContain('third');
  });
});

describe('GitHub fallback client', () => {
  it('returns a manual update and does not follow a redirected host', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(release), { status: 200, headers: { 'content-type': 'application/json' } }));
    const update = await fetchLatestGitHubRelease({ currentVersion: '1.0.0', fetchImpl });
    expect(update?.canAutoInstall).toBe(false);
    expect(update?.version).toBe('1.2.0');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/repos/Unwrenchable/EditPro/releases/latest',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/vnd.github+json' }) }),
    );

    const redirected = vi.fn(async () => {
      const response = new Response('{}', { status: 200 });
      Object.defineProperty(response, 'url', { value: 'https://evil.example/latest' });
      return response;
    });
    await expect(fetchLatestGitHubRelease({ currentVersion: '1.0.0', fetchImpl: redirected })).rejects.toBeInstanceOf(
      UpdateLookupError,
    );
  });

  it('reports rate limits and network failures without the response body', async () => {
    const limited = vi.fn(async () => new Response('nope', { status: 403 }));
    await expect(fetchLatestGitHubRelease({ currentVersion: '1.0.0', fetchImpl: limited })).rejects.toThrow(/rate limit/);
    const offline = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1');
    });
    await expect(fetchLatestGitHubRelease({ currentVersion: '1.0.0', fetchImpl: offline })).rejects.toThrow(
      /Could not reach GitHub/,
    );
  });
});

describe('runUpdateCheck', () => {
  const prefs = { ...DEFAULT_PREFERENCES };
  const update = updateFromGitHubRelease(release, '1.0.0', true)!;

  it('does not probe when automatic checks are off', async () => {
    const electronUpdater = vi.fn();
    const github = vi.fn();
    const event = await runUpdateCheck(
      { manual: false, now: 0, currentVersion: '1.0.0', delivery: 'electron-updater', preferences: { ...prefs, automaticUpdateChecks: false } },
      { electronUpdater, github },
    );
    expect(event).toEqual({ type: 'idle', manual: false });
    expect(electronUpdater).not.toHaveBeenCalled();
    expect(github).not.toHaveBeenCalled();
  });

  it('keeps electron-updater when it can install, and falls back without auto-install when it throws', async () => {
    const github = vi.fn(async () => update);
    const installed = await runUpdateCheck(
      { manual: true, now: 0, currentVersion: '1.0.0', delivery: 'electron-updater', preferences: prefs },
      { electronUpdater: async () => update, github },
    );
    expect(installed).toMatchObject({ type: 'available', update: { canAutoInstall: true } });
    expect(github).not.toHaveBeenCalled();

    const fallback = await runUpdateCheck(
      { manual: false, now: 0, currentVersion: '1.0.0', delivery: 'electron-updater', preferences: prefs },
      { electronUpdater: async () => { throw new Error('unsigned'); }, github },
    );
    expect(fallback).toMatchObject({ type: 'available', notify: true, update: { canAutoInstall: false, version: '1.2.0' } });
  });

  it('uses the release API for portable builds and stays quiet when nothing is newer', async () => {
    const event = await runUpdateCheck(
      { manual: false, now: 0, currentVersion: '1.0.0', delivery: 'github-release', preferences: prefs },
      { electronUpdater: vi.fn(), github: async () => null },
    );
    expect(event).toMatchObject({ type: 'up-to-date', notify: false });
  });

  it('surfaces a manual failure and hides an automatic one from the notify flag', async () => {
    const github = async () => {
      throw new UpdateLookupError('GitHub rate limit reached. Try again later.');
    };
    const manual = await runUpdateCheck(
      { manual: true, now: 0, currentVersion: '1.0.0', delivery: 'github-release', preferences: prefs },
      { electronUpdater: vi.fn(), github },
    );
    const automatic = await runUpdateCheck(
      { manual: false, now: 0, currentVersion: '1.0.0', delivery: 'github-release', preferences: prefs },
      { electronUpdater: vi.fn(), github },
    );
    expect(manual).toMatchObject({ type: 'error', notify: true, message: 'GitHub rate limit reached. Try again later.' });
    expect(automatic).toMatchObject({ type: 'error', notify: false });
  });
});

describe('signature probe', () => {
  it('trusts a verified macOS bundle and a Valid Windows signature', async () => {
    const execFile = vi.fn(async (file: string) => ({ code: file === 'codesign' ? 0 : 1, stdout: '' }));
    await expect(
      probeSignature({
        platform: 'darwin',
        exePath: '/Applications/EditPro.app/Contents/MacOS/EditPro',
        execFile,
      }),
    ).resolves.toBe(true);
    expect(execFile).toHaveBeenCalledWith(
      'codesign',
      ['--verify', '--deep', '--strict', '/Applications/EditPro.app'],
      expect.any(Object),
    );

    const windows = vi.fn(async () => ({ code: 0, stdout: 'Valid\n' }));
    await expect(probeSignature({ platform: 'win32', exePath: 'C:\\Program Files\\EditPro\\EditPro.exe', execFile: windows })).resolves.toBe(true);
    expect(windows.mock.calls[0]?.[2]).toMatchObject({ EDITPRO_SIGN_PATH: 'C:\\Program Files\\EditPro\\EditPro.exe' });
  });

  it('treats Linux and a failed check as unsigned', async () => {
    const execFile = vi.fn(async () => ({ code: 1, stdout: 'NotSigned' }));
    await expect(probeSignature({ platform: 'linux', exePath: '/usr/bin/editpro', execFile })).resolves.toBe(false);
    expect(execFile).not.toHaveBeenCalled();
    await expect(probeSignature({ platform: 'win32', exePath: 'C:\\EditPro.exe', execFile })).resolves.toBe(false);
    await expect(
      probeSignature({ platform: 'darwin', exePath: '/tmp/EditPro', execFile }),
    ).resolves.toBe(false);
  });
});

describe('release metadata publishing', () => {
  it('configures the GitHub provider and publishes latest.yml with the release', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      build: { publish?: { provider?: string; owner?: string; repo?: string } };
      dependencies?: Record<string, string>;
    };
    expect(packageJson.build.publish).toEqual({ provider: 'github', owner: 'Unwrenchable', repo: 'EditPro' });
    expect(packageJson.dependencies?.['electron-updater']).toBeTruthy();

    const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release.yml'), 'utf8');
    expect(workflow).toContain('--publish always');
    expect(workflow).toContain('release/*.yml');
    expect(workflow).toContain('release/*.blockmap');
    expect(workflow).toContain('latest-mac.yml');
    expect(workflow).toContain('latest-linux.yml');
    expect(workflow).toContain('latest.yml');
  });
});
