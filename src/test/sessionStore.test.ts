import { beforeEach, describe, expect, it } from 'vitest';
import { createBrowserProjectIO, resetPageBootToken } from '../services/projectIO';
import {
  beginSession,
  discardSessionAutosave,
  emptySessionMeta,
  markSessionClean,
  noteSessionSaved,
  recordAutosave,
  recoveryKind,
  type SessionMeta,
  type SessionPersistence,
} from '../utils/sessionStore';

function memoryStore(initial?: { meta?: SessionMeta | null; autosave?: string | null }): SessionPersistence & {
  meta: SessionMeta | null;
  autosave: string | null;
} {
  const state = {
    meta: initial?.meta ?? null,
    autosave: initial?.autosave ?? null,
  };
  return {
    get meta() {
      return state.meta;
    },
    set meta(value) {
      state.meta = value;
    },
    get autosave() {
      return state.autosave;
    },
    set autosave(value) {
      state.autosave = value;
    },
    readMeta: () => state.meta,
    writeMeta: (meta) => {
      state.meta = meta;
    },
    readAutosave: () => state.autosave,
    writeAutosave: (contents) => {
      state.autosave = contents;
    },
    clearAutosave: () => {
      state.autosave = null;
    },
  };
}

describe('recovery policy', () => {
  const dirty: SessionMeta = {
    ...emptySessionMeta(),
    dirty: true,
    unclean: true,
    projectPath: '/films/cut.editpro',
    autosaveUpdatedAt: '2026-10-19T12:00:00.000Z',
  };

  it('offers a crash restore only when the previous session was unclean and dirty', () => {
    expect(recoveryKind(dirty, true)).toBe('crash');
    expect(recoveryKind({ ...dirty, unclean: false }, true)).toBe('autosave');
    expect(recoveryKind({ ...dirty, dirty: false }, true)).toBeNull();
    expect(recoveryKind(dirty, false)).toBeNull();
    expect(recoveryKind(null, true)).toBeNull();
  });

  it('boots once per token so a second read does not relabel a clean quit as a crash', () => {
    const store = memoryStore({
      meta: { ...dirty, unclean: false },
      autosave: '{"format":"editpro"}',
    });

    const first = beginSession(store, 'page-a');
    const second = beginSession(store, 'page-a');
    expect(first?.kind).toBe('autosave');
    expect(second?.kind).toBe('autosave');
    expect(store.meta?.unclean).toBe(true);
  });

  it('records autosave, treats an explicit save as clean, and can discard recovery', () => {
    const store = memoryStore();
    expect(beginSession(store, 'boot-1')).toBeNull();

    recordAutosave(store, '{"format":"editpro","version":1}', '/films/cut.editpro', new Date('2026-10-19T12:00:00.000Z'));
    expect(store.meta?.dirty).toBe(true);
    expect(store.autosave).toContain('editpro');

    noteSessionSaved(store, '/films/cut.editpro', new Date('2026-10-19T12:05:00.000Z'));
    expect(store.meta?.dirty).toBe(false);
    expect(recoveryKind(store.meta, Boolean(store.autosave))).toBeNull();

    recordAutosave(store, '{"format":"editpro","version":1}', '/films/cut.editpro');
    discardSessionAutosave(store);
    expect(store.autosave).toBeNull();
    expect(store.meta?.dirty).toBe(false);

    markSessionClean(store);
    expect(store.meta?.unclean).toBe(false);
  });
});

describe('browser project session', () => {
  beforeEach(() => {
    localStorage.clear();
    resetPageBootToken();
  });

  it('restores an autosave after a crash and after a clean quit that left the document dirty', async () => {
    const first = createBrowserProjectIO(localStorage);
    expect(await first.boot()).toBeNull();
    await first.autosave('{"format":"editpro","version":1}', '/tmp/demo.editpro');

    resetPageBootToken();
    const crashed = await createBrowserProjectIO(localStorage).boot();
    expect(crashed?.kind).toBe('crash');
    expect(crashed?.autosave).toContain('editpro');

    await first.markCleanShutdown();
    resetPageBootToken();
    const quit = await createBrowserProjectIO(localStorage).boot();
    expect(quit?.kind).toBe('autosave');
    expect(quit?.projectPath).toBe('/tmp/demo.editpro');
  });

  it('does not offer recovery after the project is saved or the autosave is discarded', async () => {
    const session = createBrowserProjectIO(localStorage);
    await session.boot();
    await session.autosave('{"format":"editpro","version":1}', null);
    await session.noteSaved('/tmp/saved.editpro');

    resetPageBootToken();
    expect(await createBrowserProjectIO(localStorage).boot()).toBeNull();

    const dirty = createBrowserProjectIO(localStorage);
    await dirty.boot();
    await dirty.autosave('{"format":"editpro","version":1}', null);
    await dirty.discardRecovery();
    resetPageBootToken();
    expect(await createBrowserProjectIO(localStorage).boot()).toBeNull();
  });

  it('reopens a recent project from its stored contents', async () => {
    const session = createBrowserProjectIO(localStorage);
    await session.boot();
    const contents = '{"format":"editpro","version":1}';
    await session.rememberRecent({
      path: 'Demo.editpro',
      name: 'Demo.editpro',
      mode: 'photo',
      openedAt: '2026-10-19T12:00:00.000Z',
      contents,
    });

    expect(await session.readProject('Demo.editpro')).toBe(contents);
    const recent = await session.listRecent();
    expect(recent[0]?.name).toBe('Demo.editpro');
  });
});
