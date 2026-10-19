import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PREFERENCES,
  applyPreferencePatch,
  isUpdateDialogState,
  type AppPreferences,
  type PreferencePatch,
  type UpdateDialogState,
} from '../../electron/updates/policy';
import { getPlatform } from '../platform';
import { loadBrowserPreferences, saveBrowserPreferences } from '../utils/preferences';

const WEBSITE = 'https://github.com/Unwrenchable/EditPro';

export function useDesktopChrome() {
  const [prefs, setPrefs] = useState<AppPreferences | null>(() => {
    if (typeof window === 'undefined') return null;
    if (getPlatform().kind === 'electron') return null;
    return loadBrowserPreferences(window.localStorage);
  });
  const [version, setVersion] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [dialog, setDialog] = useState<UpdateDialogState>({ type: 'hidden' });

  const acceptDialog = useCallback((next: UpdateDialogState) => {
    setDialog(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bridge = getPlatform();
    const loadPrefs = bridge.getPreferences();
    const loadVersion = bridge.getVersion();
    void loadPrefs
      .then((next) => {
        if (!cancelled) setPrefs(next);
      })
      .catch(() => {
        if (!cancelled) setPrefs({ ...DEFAULT_PREFERENCES });
      });
    void loadVersion
      .then((next) => {
        if (!cancelled && next) setVersion(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const bridge = getPlatform();
    let sawEvent = false;
    const unsubscribe = bridge.onUpdateState((payload) => {
      if (!isUpdateDialogState(payload)) return;
      sawEvent = true;
      acceptDialog(payload);
    });
    void bridge.getUpdateState?.().then((payload) => {
      if (sawEvent || !isUpdateDialogState(payload) || payload.type === 'hidden') return;
      acceptDialog(payload);
    });
    return unsubscribe;
  }, [acceptDialog]);

  useEffect(() => {
    const bridge = getPlatform();
    if (bridge.kind !== 'electron') return;
    const offSettings = bridge.onMenu('menu:settings', () => setSettingsOpen(true));
    const offAbout = bridge.onMenu('menu:about', () => setAboutOpen(true));
    return () => {
      offSettings();
      offAbout();
    };
  }, []);

  useEffect(() => {
    const platform = getPlatform();
    if (platform.kind === 'electron' && !window.editpro?.recordClientError) return;
    if (platform.kind !== 'electron' && !prefs?.crashLogging) return;
    const onError = (event: ErrorEvent) => {
      void platform.recordClientError({
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        source: event.filename,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : 'Unhandled promise rejection';
      void platform.recordClientError({
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [prefs?.crashLogging]);

  const updatePreferences = useCallback(async (patch: PreferencePatch) => {
    const current = prefs ?? loadBrowserPreferences(window.localStorage);
    try {
      const platform = getPlatform();
      if (platform.kind === 'electron' && window.editpro?.setPreferences) {
        const next = await platform.setPreferences(patch);
        setPrefs(next);
        return next;
      }
      const next = applyPreferencePatch(current, patch);
      saveBrowserPreferences(window.localStorage, next);
      setPrefs(next);
      return next;
    } catch {
      return current;
    }
  }, [prefs]);

  const checkForUpdates = useCallback(() => {
    setSettingsOpen(false);
    void getPlatform().checkForUpdates().catch(() => undefined);
  }, []);

  const visibleDialog: UpdateDialogState =
    dialog.type === 'available' && dialog.source === 'automatic' && !prefs?.onboardingComplete
      ? { type: 'hidden' }
      : dialog;

  return {
    prefs,
    version,
    settingsOpen,
    setSettingsOpen,
    aboutOpen,
    setAboutOpen,
    dialog: visibleDialog,
    showWelcome: prefs != null && !prefs.onboardingComplete,
    completeOnboarding: (crashLogging: boolean) => updatePreferences({ onboardingComplete: true, crashLogging }),
    setAutomatic: (automaticUpdateChecks: boolean) => updatePreferences({ automaticUpdateChecks }),
    setCrashLogging: (crashLogging: boolean) => updatePreferences({ crashLogging }),
    checkForUpdates,
    downloadUpdate: () => {
      void getPlatform().downloadUpdate().catch(() => undefined);
    },
    installUpdate: () => {
      void getPlatform().installUpdate().catch(() => undefined);
    },
    skipUpdate: () => {
      if (dialog.type !== 'available') return;
      void getPlatform().skipUpdate(dialog.update.version).catch(() => undefined);
    },
    remindLater: () => {
      void getPlatform().remindUpdateLater().catch(() => undefined);
    },
    dismissUpdate: () => {
      void getPlatform().dismissUpdate().catch(() => undefined);
    },
    openRelease: () => {
      if (dialog.type !== 'available') return;
      void getPlatform().openExternal(dialog.update.releaseUrl).catch(() => undefined);
    },
    openWebsite: () => {
      void getPlatform().openExternal(WEBSITE).catch(() => undefined);
    },
  };
}
