import type { PlatformKind } from './types';

/**
 * Mark the document before the first paint so desktop CSS can ignore the
 * phone layout. Electron already sizes the window in device pixels, so the
 * mobile viewport meta is removed there and left in place for the browser
 * and Capacitor.
 */
export function applyHostMarkup(doc: Document, kind: PlatformKind): void {
  doc.documentElement.dataset.host = kind;
  if (kind === 'electron') {
    doc.querySelector('meta[name="viewport"]')?.remove();
  }
}
