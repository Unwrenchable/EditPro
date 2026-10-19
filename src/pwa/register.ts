import { getPlatform } from '../platform';
import { shouldRegisterServiceWorker } from './shell';

/** Register the offline shell after load. Failures stay silent so the editor still opens. */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!shouldRegisterServiceWorker({
    production: import.meta.env.PROD,
    kind: getPlatform().kind,
    supported: 'serviceWorker' in navigator,
  })) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
