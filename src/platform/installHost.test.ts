import { describe, expect, it } from 'vitest';
import { applyHostMarkup } from './installHost';

describe('host markup', () => {
  it('marks the desktop app and drops the mobile viewport', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    applyHostMarkup(document, 'electron');
    expect(document.documentElement.dataset.host).toBe('electron');
    expect(document.querySelector('meta[name="viewport"]')).toBeNull();
  });

  it('keeps the viewport meta for the browser and Capacitor', () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    applyHostMarkup(document, 'web');
    expect(document.documentElement.dataset.host).toBe('web');
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toContain('device-width');

    applyHostMarkup(document, 'capacitor');
    expect(document.documentElement.dataset.host).toBe('capacitor');
    expect(document.querySelector('meta[name="viewport"]')).not.toBeNull();
  });
});
