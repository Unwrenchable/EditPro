export interface HeadTag {
  tag: 'link' | 'meta';
  attrs: Record<string, string>;
  injectTo: 'head';
}

/** Install metadata for the web build. The desktop renderer keeps a strict CSP and no manifest. */
export function webInstallHeadTags(enabled: boolean): HeadTag[] {
  if (!enabled) return [];
  return [
    { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'theme-color', content: '#1a1a1a' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }, injectTo: 'head' },
    { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }, injectTo: 'head' },
  ];
}
