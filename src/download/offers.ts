export const RELEASE_API = 'https://api.github.com/repos/Unwrenchable/EditPro/releases/latest';
export const RELEASES_PAGE = 'https://github.com/Unwrenchable/EditPro/releases/latest';

export type HostOs = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'other';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface DownloadCard {
  id: string;
  title: string;
  detail: string;
  href: string | null;
  primary: boolean;
  action: 'download' | 'install' | 'ios';
}

export const IOS_STEPS = [
  'Open this page in Safari. Other browsers on iOS cannot add a home-screen app.',
  'Tap the Share button (the square with an arrow).',
  'Scroll the share sheet and tap Add to Home Screen.',
  'Tap Add. EditPro opens from the new icon without the browser chrome.',
];

/** Best-effort host from the user agent. iPadOS desktop mode still says Macintosh, plus Mobile. */
export function detectOs(userAgent: string, platform = ''): HostOs {
  const ua = `${userAgent} ${platform}`;
  if (/iPad|iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Win32|Win64/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh|MacIntel/i.test(ua)) return 'mac';
  if (/Linux|X11|CrOS/i.test(ua)) return 'linux';
  return 'other';
}

export function osLabel(os: HostOs): string {
  switch (os) {
    case 'windows': return 'Windows';
    case 'mac': return 'Mac';
    case 'linux': return 'Linux';
    case 'android': return 'Android';
    case 'ios': return 'iPhone or iPad';
    default: return 'this device';
  }
}

export function chooseReleaseAssets(assets: ReleaseAsset[]): Record<'windows' | 'mac' | 'linux' | 'android', ReleaseAsset | null> {
  const match = (pattern: RegExp) => assets.find((asset) => pattern.test(asset.name)) ?? null;
  return {
    windows: match(/\.exe$/i) ?? match(/windows.*\.zip$/i),
    mac: match(/\.dmg$/i) ?? match(/mac.*\.zip$/i),
    linux: match(/\.AppImage$/i) ?? match(/\.deb$/i),
    android: match(/\.apk$/i),
  };
}

export function downloadCards(os: HostOs, assets: ReleaseAsset[]): DownloadCard[] {
  const picked = chooseReleaseAssets(assets);
  const fileCard = (
    id: 'windows' | 'mac' | 'linux' | 'android',
    title: string,
    asset: ReleaseAsset | null,
    empty: string,
  ): DownloadCard => ({
    id,
    title,
    detail: asset ? asset.name : empty,
    href: asset ? asset.browser_download_url : RELEASES_PAGE,
    primary: os === id,
    action: 'download',
  });
  return [
    fileCard('windows', 'Windows', picked.windows, 'A Windows installer appears here when the latest release includes an .exe.'),
    fileCard('mac', 'Mac', picked.mac, 'A Mac disk image appears here when the latest release includes a .dmg.'),
    fileCard('linux', 'Linux', picked.linux, 'A Linux package appears here when the latest release includes an AppImage or .deb.'),
    fileCard(
      'android',
      'Android APK',
      picked.android,
      'An APK appears here when the latest release includes one. The Mobile workflow also builds an unsigned debug APK.',
    ),
    {
      id: 'pwa',
      title: 'Install in the browser',
      detail: os === 'ios'
        ? 'Safari on iPhone and iPad uses Add to Home Screen, below.'
        : 'Adds EditPro to this device. Chrome and Edge can show an install prompt on this page.',
      href: null,
      primary: os === 'android' || os === 'other',
      action: 'install',
    },
    {
      id: 'ios',
      title: 'iPhone and iPad',
      detail: 'Use Safari. The install prompt used by Chrome on other systems is not available in iOS browsers.',
      href: '#ios-steps',
      primary: os === 'ios',
      action: 'ios',
    },
  ];
}
