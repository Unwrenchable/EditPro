import './download.css';
import {
  IOS_STEPS,
  RELEASE_API,
  detectOs,
  downloadCards,
  osLabel,
  type DownloadCard,
  type HostOs,
  type ReleaseAsset,
} from './offers';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export interface DownloadPageState {
  os: HostOs;
  assets: ReleaseAsset[];
  installed: boolean;
  canPrompt: boolean;
  onInstall: () => void;
}

export async function loadReleaseAssets(fetchImpl: typeof fetch = fetch): Promise<ReleaseAsset[]> {
  try {
    const response = await fetchImpl(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return [];
    const body = await response.json() as { assets?: ReleaseAsset[] };
    return Array.isArray(body.assets) ? body.assets : [];
  } catch {
    return [];
  }
}

function cardElement(card: DownloadCard, state: DownloadPageState): HTMLElement {
  const article = document.createElement('article');
  article.className = card.primary ? 'download-card download-card-primary' : 'download-card';
  article.dataset.card = card.id;
  const title = document.createElement('h2');
  title.textContent = card.title;
  const detail = document.createElement('p');
  detail.textContent = card.detail;
  article.append(title, detail);

  if (card.action === 'install') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'download-action';
    if (state.installed) {
      button.textContent = 'Installed';
      button.disabled = true;
    } else if (state.canPrompt) {
      button.textContent = 'Install EditPro';
      button.addEventListener('click', state.onInstall);
    } else if (state.os === 'ios') {
      button.textContent = 'See Add to Home Screen';
      button.addEventListener('click', () => {
        document.getElementById('ios-steps')?.scrollIntoView();
      });
    } else {
      button.textContent = 'Install EditPro';
      button.addEventListener('click', () => {
        const status = document.getElementById('install-status');
        if (status) {
          status.textContent = 'When this site is served over HTTPS, Chrome and Edge offer install from the address bar. iPhone and iPad use the steps below.';
        }
      });
    }
    article.append(button);
    return article;
  }

  const link = document.createElement('a');
  link.className = 'download-action';
  link.href = card.href ?? '#ios-steps';
  link.textContent = card.action === 'ios'
    ? 'Add to Home Screen steps'
    : (card.href && card.href !== '#ios-steps' && !card.href.endsWith('/releases/latest') ? `Download ${card.title}` : 'View releases');
  if (card.action === 'download' && card.href?.startsWith('http')) link.rel = 'noopener';
  article.append(link);
  return article;
}

export function mountDownloadPage(root: ParentNode, state: DownloadPageState): void {
  const detected = root.querySelector('#download-detected');
  if (detected) detected.textContent = `This looks like ${osLabel(state.os)}.`;
  const cards = root.querySelector('#download-cards');
  if (cards) {
    cards.replaceChildren(...downloadCards(state.os, state.assets).map((card) => cardElement(card, state)));
  }
  const steps = root.querySelector('#ios-step-list');
  if (steps) {
    steps.replaceChildren(...IOS_STEPS.map((step) => {
      const item = document.createElement('li');
      item.textContent = step;
      return item;
    }));
  }
}

export async function startDownloadPage(doc: Document = document): Promise<void> {
  const os = detectOs(navigator.userAgent, navigator.platform);
  const nav = navigator as Navigator & { standalone?: boolean };
  const installed = window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
  let assets: ReleaseAsset[] = [];
  let canPrompt = false;
  let promptEvent: InstallPromptEvent | null = null;
  const paint = () => mountDownloadPage(doc, {
    os,
    assets,
    installed,
    canPrompt,
    onInstall: () => { void promptEvent?.prompt(); },
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptEvent = event as InstallPromptEvent;
    canPrompt = true;
    paint();
  });
  paint();
  assets = await loadReleaseAssets();
  paint();
}

if (typeof document !== 'undefined' && document.getElementById('download-cards')) {
  void startDownloadPage();
}
