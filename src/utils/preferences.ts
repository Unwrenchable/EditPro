import { DEFAULT_PREFERENCES, sanitizePreferences, type AppPreferences } from '../../electron/updates/policy';

const STORAGE_KEY = 'editpro.preferences.v1';

export function loadBrowserPreferences(storage: Pick<Storage, 'getItem'>): AppPreferences {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return sanitizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function saveBrowserPreferences(storage: Pick<Storage, 'setItem'>, preferences: AppPreferences): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}
