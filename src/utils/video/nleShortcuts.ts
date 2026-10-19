import { isTextEditingTarget, type ShortcutEvent } from '../editorShortcuts';
import type { TimelineTool } from '../../types';

export type NleAction =
  | { type: 'shuttle'; direction: 'forward' | 'reverse' | 'stop'; slow: boolean }
  | { type: 'playToggle' }
  | { type: 'step'; frames: number }
  | { type: 'skip'; seconds: number }
  | { type: 'setIn' }
  | { type: 'setOut' }
  | { type: 'clearIn' }
  | { type: 'clearOut' }
  | { type: 'clearInOut' }
  | { type: 'marker' }
  | { type: 'tool'; tool: TimelineTool }
  | { type: 'toggleSnap' }
  | { type: 'zoom'; direction: 1 | -1 }
  | { type: 'zoomReset' }
  | { type: 'razorPlayhead' }
  | { type: 'delete'; ripple: boolean }
  | { type: 'markClip' }
  | { type: 'trimToPlayhead'; edge: 'previous' | 'next' }
  | { type: 'gotoEdit'; direction: -1 | 1 }
  | { type: 'goto'; edge: 'start' | 'end' }
  | { type: 'nudge'; frames: number }
  | { type: 'addKeyframe' }
  | { type: 'toggleLink' };

const TOOLS: Record<string, TimelineTool> = {
  v: 'select',
  c: 'razor',
  b: 'ripple',
  n: 'roll',
  y: 'slip',
  u: 'slide',
};

export function nleActionKind(action: NleAction): 'transport' | 'timeline' {
  switch (action.type) {
    case 'shuttle':
    case 'playToggle':
    case 'step':
    case 'skip':
    case 'setIn':
    case 'setOut':
    case 'clearIn':
    case 'clearOut':
    case 'clearInOut':
    case 'marker':
    case 'markClip':
    case 'trimToPlayhead':
    case 'gotoEdit':
    case 'goto':
      return 'transport';
    default:
      return 'timeline';
  }
}

/**
 * Premiere-style timeline shortcuts.
 * Document commands (undo, save, open) stay with matchEditorShortcut.
 */
export function matchNleShortcut(event: ShortcutEvent): NleAction | null {
  if (isTextEditingTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;

  if (mod) {
    if (!event.altKey && !event.shiftKey && key === 'k') return { type: 'razorPlayhead' };
    return null;
  }

  if (event.altKey) {
    if (key === 'arrowleft' || key === 'arrowright') {
      const sign = key === 'arrowleft' ? -1 : 1;
      return { type: 'nudge', frames: sign * (event.shiftKey ? 5 : 1) };
    }
    if (key === 'i') return { type: 'clearIn' };
    if (key === 'o') return { type: 'clearOut' };
    if (key === 'x') return { type: 'clearInOut' };
    if (key === 'l') return { type: 'toggleLink' };
    return null;
  }

  if (key === 'j') return { type: 'shuttle', direction: 'reverse', slow: event.shiftKey };
  if (key === 'k' && event.shiftKey) return { type: 'addKeyframe' };
  if (key === 'k') return { type: 'shuttle', direction: 'stop', slow: false };
  if (key === 'l') return { type: 'shuttle', direction: 'forward', slow: event.shiftKey };
  if (key === ' ') return { type: 'playToggle' };
  if (key === 'arrowleft') return { type: 'step', frames: event.shiftKey ? -5 : -1 };
  if (key === 'arrowright') return { type: 'step', frames: event.shiftKey ? 5 : 1 };
  if (key === 'arrowup') return { type: 'gotoEdit', direction: -1 };
  if (key === 'arrowdown') return { type: 'gotoEdit', direction: 1 };
  if (key === 'home') return { type: 'goto', edge: 'start' };
  if (key === 'end') return { type: 'goto', edge: 'end' };
  if (key === 'i') return { type: 'setIn' };
  if (key === 'o') return { type: 'setOut' };
  if (key === 'm') return { type: 'marker' };
  if (key === 's' && !event.shiftKey) return { type: 'toggleSnap' };
  if (key === '=' || key === '+') return { type: 'zoom', direction: 1 };
  if (key === '-' || key === '_') return { type: 'zoom', direction: -1 };
  if (key === '\\') return { type: 'zoomReset' };
  if (key === 'x') return { type: 'markClip' };
  if (key === 'q') return { type: 'trimToPlayhead', edge: 'previous' };
  if (key === 'w') return { type: 'trimToPlayhead', edge: 'next' };
  if (key === 'delete' || key === 'backspace') return { type: 'delete', ripple: event.shiftKey };
  const tool = TOOLS[key];
  if (tool && !event.shiftKey) return { type: 'tool', tool };
  return null;
}
