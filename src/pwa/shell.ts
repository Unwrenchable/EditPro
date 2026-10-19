/** URLs the service worker precaches. Keep this list in step with public/sw.js. */
export const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
] as const;

export const SHELL_CACHE = 'editpro-shell-v1';

/** The desktop app has its own window. Only the web and Capacitor builds install a worker. */
export function shouldRegisterServiceWorker(options: {
  production: boolean;
  kind: string;
  supported: boolean;
}): boolean {
  return options.production && options.kind !== 'electron' && options.supported;
}
