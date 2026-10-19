import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  replacePresent,
  undo,
} from '../utils/history';
import { matchEditorShortcut } from '../utils/editorShortcuts';

describe('history', () => {
  it('starts with an empty past and future', () => {
    const history = createHistory({ value: 1 });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(history.present).toEqual({ value: 1 });
  });

  it('does not alias the snapshot passed to createHistory', () => {
    const original = { value: 1 };
    const history = createHistory(original);
    original.value = 9;
    expect(history.present.value).toBe(1);
  });

  it('undo and redo walk the stack', () => {
    let history = createHistory('a');
    history = commit(history, 'b');
    history = commit(history, 'c');
    expect(history.present).toBe('c');

    history = undo(history);
    expect(history.present).toBe('b');
    expect(canRedo(history)).toBe(true);

    history = redo(history);
    expect(history.present).toBe('c');
    expect(canRedo(history)).toBe(false);
  });

  it('a new edit clears the redo stack', () => {
    let history = createHistory(0);
    history = commit(history, 1);
    history = commit(history, 2);
    history = undo(history);
    history = commit(history, 9);
    expect(history.present).toBe(9);
    expect(history.future).toEqual([]);
    history = undo(history);
    expect(history.present).toBe(1);
  });

  it('coalesces repeated edits that share a key into one step', () => {
    let history = createHistory(0);
    history = commit(history, 1, { coalesceKey: 'brightness' });
    history = commit(history, 2, { coalesceKey: 'brightness' });
    history = commit(history, 3, { coalesceKey: 'brightness' });
    expect(history.past).toEqual([0]);
    expect(history.present).toBe(3);

    history = undo(history);
    expect(history.present).toBe(0);

    history = commit(history, 4, { coalesceKey: 'contrast' });
    expect(history.past).toEqual([0]);
    expect(history.present).toBe(4);
  });

  it('ignores a commit that does not change the snapshot', () => {
    const history = createHistory({ n: 1 });
    const next = commit(history, { n: 1 });
    expect(next).toBe(history);
  });

  it('drops the oldest entries past the limit', () => {
    let history = createHistory(0);
    for (let value = 1; value <= 5; value += 1) {
      history = commit(history, value, { limit: 3 });
    }
    expect(history.past).toEqual([2, 3, 4]);
    expect(history.present).toBe(5);
  });

  it('undo and redo are no-ops at the ends of the stack', () => {
    const history = createHistory('only');
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it('replacePresent updates the baseline without an undo step', () => {
    const history = replacePresent(createHistory({ trim: 0 }), { trim: 8 });
    expect(history.present).toEqual({ trim: 8 });
    expect(canUndo(history)).toBe(false);
  });
});

describe('editor shortcuts', () => {
  const base = {
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: null as EventTarget | null,
  };

  it('maps undo, redo, save, and open', () => {
    expect(matchEditorShortcut({ ...base, key: 'z' })).toBe('undo');
    expect(matchEditorShortcut({ ...base, key: 'Z', shiftKey: true })).toBe('redo');
    expect(matchEditorShortcut({ ...base, key: 'y' })).toBe('redo');
    expect(matchEditorShortcut({ ...base, key: 's' })).toBe('save');
    expect(matchEditorShortcut({ ...base, key: 's', shiftKey: true })).toBe('saveAs');
    expect(matchEditorShortcut({ ...base, key: 'o' })).toBe('openProject');
    expect(matchEditorShortcut({ ...base, key: 'o', metaKey: true, ctrlKey: false })).toBe('openProject');
  });

  it('leaves undo and redo to text fields, but sliders undo the document', () => {
    const input = document.createElement('input');
    const slider = document.createElement('input');
    slider.type = 'range';
    expect(matchEditorShortcut({ ...base, key: 'z', target: input })).toBeNull();
    expect(matchEditorShortcut({ ...base, key: 'y', target: input })).toBeNull();
    expect(matchEditorShortcut({ ...base, key: 's', target: input })).toBe('save');
    expect(matchEditorShortcut({ ...base, key: 'z', target: slider })).toBe('undo');
  });

  it('ignores plain keys and alt-modified shortcuts', () => {
    expect(matchEditorShortcut({ ...base, key: 'z', ctrlKey: false })).toBeNull();
    expect(matchEditorShortcut({ ...base, key: 'z', altKey: true })).toBeNull();
  });
});
