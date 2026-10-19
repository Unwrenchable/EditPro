/**
 * One update check: electron-updater when this install can apply an update,
 * otherwise the public GitHub Releases API.
 */
import {
  publicUpdateError,
  shouldNotify,
  type AppPreferences,
  type AvailableUpdate,
  type UpdateDelivery,
  type UpdateEvent,
} from './policy.js';

export interface UpdateCheckContext {
  manual: boolean;
  now: number;
  currentVersion: string;
  delivery: UpdateDelivery;
  preferences: AppPreferences;
}

export interface UpdateProbe {
  electronUpdater: () => Promise<AvailableUpdate | null>;
  github: () => Promise<AvailableUpdate | null>;
}

function manualOnly(update: AvailableUpdate): AvailableUpdate {
  return update.canAutoInstall ? { ...update, canAutoInstall: false } : update;
}

export async function runUpdateCheck(context: UpdateCheckContext, probe: UpdateProbe): Promise<UpdateEvent> {
  if (!context.manual && !context.preferences.automaticUpdateChecks) {
    return { type: 'idle', manual: false };
  }

  try {
    let update: AvailableUpdate | null;
    if (context.delivery === 'electron-updater') {
      try {
        update = await probe.electronUpdater();
      } catch {
        const release = await probe.github();
        update = release ? manualOnly(release) : null;
      }
    } else {
      const release = await probe.github();
      update = release ? manualOnly(release) : null;
    }

    if (!update) {
      return {
        type: 'up-to-date',
        manual: context.manual,
        version: context.currentVersion,
        notify: context.manual,
      };
    }

    return {
      type: 'available',
      manual: context.manual,
      update,
      notify: shouldNotify({
        manual: context.manual,
        version: update.version,
        skippedVersion: context.preferences.skippedVersion,
        snoozeUntil: context.preferences.snoozeUntil,
        now: context.now,
      }),
    };
  } catch (error) {
    return {
      type: 'error',
      manual: context.manual,
      message: publicUpdateError(error, 'check'),
      notify: context.manual,
    };
  }
}
