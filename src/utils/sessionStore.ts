/**
 * Autosave / crash-recovery policy shared by the browser store and tests.
 * The Electron main process mirrors `recoveryKind` when it boots a session.
 */
export interface SessionMeta {
  /** True while the process is running, or if it exited without a clean shutdown. */
  unclean: boolean;
  /** True when the autosave is newer than the last explicit save. */
  dirty: boolean;
  projectPath: string | null;
  autosaveUpdatedAt: string | null;
  lastSaveAt: string | null;
  /**
   * Identifies the page load that already consumed this meta.
   * A second boot with the same token returns the stashed offer instead of
   * relabeling a clean quit as a crash (React StrictMode mounts twice).
   */
  bootToken: string | null;
  pendingKind: RecoveryKind | null;
}

export type RecoveryKind = 'crash' | 'autosave';

export interface RecoveryOffer {
  kind: RecoveryKind;
  autosave: string;
  projectPath: string | null;
  savedAt: string | null;
}

export function emptySessionMeta(): SessionMeta {
  return {
    unclean: false,
    dirty: false,
    projectPath: null,
    autosaveUpdatedAt: null,
    lastSaveAt: null,
    bootToken: null,
    pendingKind: null,
  };
}

export function normalizeSessionMeta(value: unknown): SessionMeta {
  const record = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pendingKind = record.pendingKind === 'crash' || record.pendingKind === 'autosave' ? record.pendingKind : null;
  return {
    unclean: Boolean(record.unclean),
    dirty: Boolean(record.dirty),
    projectPath: typeof record.projectPath === 'string' ? record.projectPath : null,
    autosaveUpdatedAt: typeof record.autosaveUpdatedAt === 'string' ? record.autosaveUpdatedAt : null,
    lastSaveAt: typeof record.lastSaveAt === 'string' ? record.lastSaveAt : null,
    bootToken: typeof record.bootToken === 'string' ? record.bootToken : null,
    pendingKind,
  };
}

/** Decide whether the next launch should offer the autosave, and why. */
export function recoveryKind(meta: SessionMeta | null, hasAutosave: boolean): RecoveryKind | null {
  if (!meta || !hasAutosave || !meta.dirty) return null;
  return meta.unclean ? 'crash' : 'autosave';
}

export interface SessionPersistence {
  readMeta(): SessionMeta | null;
  writeMeta(meta: SessionMeta): void;
  readAutosave(): string | null;
  writeAutosave(contents: string): void;
  clearAutosave(): void;
}

/**
 * Read the previous session, then mark this process as running.
 * Returns an offer when the previous session left a dirty autosave.
 */
export function beginSession(store: SessionPersistence, bootToken: string): RecoveryOffer | null {
  const previous = store.readMeta();
  const autosave = store.readAutosave();
  const hasAutosave = Boolean(autosave && autosave.trim());

  if (previous?.bootToken === bootToken) {
    if (!previous.dirty || !previous.pendingKind || !hasAutosave || !autosave) return null;
    return {
      kind: previous.pendingKind,
      autosave,
      projectPath: previous.projectPath,
      savedAt: previous.autosaveUpdatedAt,
    };
  }

  const kind = recoveryKind(previous, hasAutosave);
  const offer =
    kind && autosave
      ? {
          kind,
          autosave,
          projectPath: previous?.projectPath ?? null,
          savedAt: previous?.autosaveUpdatedAt ?? null,
        }
      : null;

  store.writeMeta({
    unclean: true,
    dirty: Boolean(offer),
    projectPath: previous?.projectPath ?? null,
    autosaveUpdatedAt: previous?.autosaveUpdatedAt ?? null,
    lastSaveAt: previous?.lastSaveAt ?? null,
    bootToken,
    pendingKind: kind,
  });

  return offer;
}

export function recordAutosave(
  store: SessionPersistence,
  contents: string,
  projectPath: string | null,
  now = new Date(),
): void {
  store.writeAutosave(contents);
  const meta = store.readMeta() ?? emptySessionMeta();
  store.writeMeta({
    ...meta,
    unclean: true,
    dirty: true,
    projectPath,
    autosaveUpdatedAt: now.toISOString(),
  });
}

export function noteSessionSaved(store: SessionPersistence, projectPath: string, now = new Date()): void {
  const meta = store.readMeta() ?? emptySessionMeta();
  store.writeMeta({
    ...meta,
    dirty: false,
    projectPath,
    lastSaveAt: now.toISOString(),
  });
}

export function markSessionClean(store: SessionPersistence): void {
  const meta = store.readMeta() ?? emptySessionMeta();
  store.writeMeta({ ...meta, unclean: false });
}

export function discardSessionAutosave(store: SessionPersistence): void {
  store.clearAutosave();
  const meta = store.readMeta() ?? emptySessionMeta();
  store.writeMeta({ ...meta, dirty: false, autosaveUpdatedAt: null });
}
