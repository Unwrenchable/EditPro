import { describe, expect, it } from 'vitest';
import { matchNleShortcut, nleActionKind } from '../utils/video/nleShortcuts';

const base = {
  key: 'k',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  target: null,
};

describe('NLE shortcuts', () => {
  it('maps shuttle, tools, razor, and ripple delete', () => {
    expect(matchNleShortcut({ ...base, key: 'j' })).toEqual({ type: 'shuttle', direction: 'reverse', slow: false });
    expect(matchNleShortcut({ ...base, key: 'l', shiftKey: true })).toEqual({ type: 'shuttle', direction: 'forward', slow: true });
    expect(matchNleShortcut({ ...base, key: 'k' })).toEqual({ type: 'shuttle', direction: 'stop', slow: false });
    expect(matchNleShortcut({ ...base, key: 'K', shiftKey: true })).toEqual({ type: 'addKeyframe' });
    expect(matchNleShortcut({ ...base, key: 'c' })).toEqual({ type: 'tool', tool: 'razor' });
    expect(matchNleShortcut({ ...base, key: 'b' })).toEqual({ type: 'tool', tool: 'ripple' });
    expect(matchNleShortcut({ ...base, key: 'n' })).toEqual({ type: 'tool', tool: 'roll' });
    expect(matchNleShortcut({ ...base, key: 'y' })).toEqual({ type: 'tool', tool: 'slip' });
    expect(matchNleShortcut({ ...base, key: 'u' })).toEqual({ type: 'tool', tool: 'slide' });
    expect(matchNleShortcut({ ...base, key: 's' })).toEqual({ type: 'toggleSnap' });
    expect(matchNleShortcut({ ...base, key: 'k', ctrlKey: true })).toEqual({ type: 'razorPlayhead' });
    expect(matchNleShortcut({ ...base, key: 'k', metaKey: true })).toEqual({ type: 'razorPlayhead' });
    expect(matchNleShortcut({ ...base, key: 'Delete', shiftKey: true })).toEqual({ type: 'delete', ripple: true });
    expect(matchNleShortcut({ ...base, key: 'Backspace' })).toEqual({ type: 'delete', ripple: false });
    expect(matchNleShortcut({ ...base, key: 'q' })).toEqual({ type: 'trimToPlayhead', edge: 'previous' });
    expect(matchNleShortcut({ ...base, key: 'w' })).toEqual({ type: 'trimToPlayhead', edge: 'next' });
    expect(matchNleShortcut({ ...base, key: 'ArrowRight', shiftKey: true })).toEqual({ type: 'step', frames: 5 });
    expect(matchNleShortcut({ ...base, key: 'ArrowLeft', altKey: true })).toEqual({ type: 'nudge', frames: -1 });
    expect(nleActionKind({ type: 'tool', tool: 'razor' })).toBe('timeline');
    expect(nleActionKind({ type: 'shuttle', direction: 'stop', slow: false })).toBe('transport');
  });

  it('leaves document commands and text fields alone', () => {
    expect(matchNleShortcut({ ...base, key: 'z', ctrlKey: true })).toBeNull();
    expect(matchNleShortcut({ ...base, key: 's', metaKey: true })).toBeNull();
    expect(matchNleShortcut({ ...base, key: 'o', ctrlKey: true })).toBeNull();
    const input = document.createElement('input');
    expect(matchNleShortcut({ ...base, key: 'v', target: input })).toBeNull();
    expect(matchNleShortcut({ ...base, key: ' ', target: input })).toBeNull();
  });
});
