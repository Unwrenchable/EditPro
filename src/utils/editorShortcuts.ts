export type EditorShortcut = 'undo' | 'redo' | 'save' | 'saveAs' | 'openProject';

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

/** Text fields keep the browser's own undo stack. Sliders and buttons do not. */
export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName === 'INPUT') {
    return TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  }
  return false;
}

/**
 * Map a key event to a document command.
 * Undo/redo inside text fields return null so the field keeps native editing history.
 */
export function matchEditorShortcut(event: ShortcutEvent): EditorShortcut | null {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return null;

  const editable = isTextEditingTarget(event.target);
  if (key === 'z' && !event.shiftKey) return editable ? null : 'undo';
  if (key === 'z' && event.shiftKey) return editable ? null : 'redo';
  if (key === 'y' && !event.shiftKey) return editable ? null : 'redo';
  if (key === 's' && event.shiftKey) return 'saveAs';
  if (key === 's') return 'save';
  if (key === 'o' && !event.shiftKey) return 'openProject';
  return null;
}
