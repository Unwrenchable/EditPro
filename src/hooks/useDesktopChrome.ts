import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PREFERENCES,
  applyPreferencePatch,
  isUpdateDialogState,
  type AppPreferences,
  type PreferencePatch,
  type UpdateDialogState,
} from '../../electron/updates/policy';
import { loadBrowserPreferences, saveBrowserPreferences } from '../utils/preferences';

const WEBSITE = 'https://github.com/Unwrenchable/EditPro';

export function useDesktopChrome() {
  const [prefs, setPrefs] = useState<AppPreferences | null>(() => {
    if (typeof window === 'undefined') return null;
    if (window.editpro?.getPreferences) return null;
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
    const bridge = window.editpro;
    const loadPrefs = bridge?.getPreferences
      ? bridge.getPreferences()
      : Promise.resolve(loadBrowserPreferences(window.localStorage));
    const loadVersion = bridge?.getVersion ? bridge.getVersion() : Promise.resolve(null);
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
    const bridge = window.editpro;
    if (!bridge?.onUpdateState) return;
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
    const bridge = window.editpro;
    if (!bridge?.onMenu) return;
    const offSettings = bridge.onMenu('menu:settings', () => setSettingsOpen(true));
    const offAbout = bridge.onMenu('menu:about', () => setAboutOpen(true));
    return () => {
      offSettings();
      offAbout();
    };
  }, []);

  useEffect(() => {
    const bridge = window.editpro;
    if (!bridge?.recordClientError) return;
    const onError = (event: ErrorEvent) => {
      void bridge.recordClientError({
        message: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        source: event.filename,
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : 'Unhandled promise rejection';
      void bridge.recordClientError({
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
  }, []);

    const updatePreferences = useCallback(async (patch: PreferencePatch) => {
      try {
        const bridge = window.editpro;
        if (bridge?.setPreferences) {
          const next = await bridge.setPreferences(patch);
          setPrefs(next);
          return next;
        }
        const next = applyPreferencePatch(prefs ?? DEFAULT_PREFERENCES, patch);
        saveBrowserPreferences(window.localStorage, next);
        setPrefs(next);
        return next;
      } catch {
        return prefs ?? DEFAULT_PREFERENCES;
      }
    }, [prefs]);

  const checkForUpdates = useCallback(() => {
    setSettingsOpen(false);
    void window.editpro?.checkForUpdates?.().catch(() => undefined);
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
      void window.editpro?.downloadUpdate?.().catch(() => undefined);
    },
    installUpdate: () => {
      void window.editpro?.installUpdate?.().catch(() => undefined);
    },
    skipUpdate: () => {
      if (dialog.type !== 'available') return;
      void window.editpro?.skipUpdate?.(dialog.update.version).catch(() => undefined);
    },
    remindLater: () => {
      void window.editpro?.remindUpdateLater?.().catch(() => undefined);
    },
    dismissUpdate: () => {
      void window.editpro?.dismissUpdate?.().catch(() => undefined);
    },
    openRelease: () => {
      if (dialog.type !== 'available') return;
      void window.editpro?.openExternal?.(dialog.update.releaseUrl).catch(() => undefined);
    },
    openWebsite: () => {
      void window.editpro?.openExternal?.(WEBSITE).catch(() => undefined);
    },
  };
}
