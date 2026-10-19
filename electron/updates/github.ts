/**
 * GitHub Releases lookup used when electron-updater cannot install in place.
 * Runs in the main process. The renderer never calls this API.
 */
import {
  RELEASES_API_URL,
  normalizeVersion,
  updateFromGitHubRelease,
  type AvailableUpdate,
} from './policy.js';

export class UpdateLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateLookupError';
  }
}

export async function fetchLatestGitHubRelease(options: {
  currentVersion: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}): Promise<AvailableUpdate | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const version = normalizeVersion(options.currentVersion) ?? '0.0.0';
  let response: Response;
  try {
    response = await fetchImpl(RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': options.userAgent ?? `EditPro/${version}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new UpdateLookupError('Could not reach GitHub to check for updates.');
  }

  let finalHost = '';
  try {
    finalHost = response.url ? new URL(response.url).hostname : '';
  } catch {
    finalHost = '';
  }
  if (finalHost && finalHost !== 'api.github.com') {
    throw new UpdateLookupError('Could not check for updates.');
  }
  if (response.status === 404) throw new UpdateLookupError('No EditPro release was found.');
  if (response.status === 403 || response.status === 429) {
    throw new UpdateLookupError('GitHub rate limit reached. Try again later.');
  }
  if (!response.ok) throw new UpdateLookupError('Could not check for updates.');

  const text = await response.text();
  if (text.length > 1_000_000) throw new UpdateLookupError('GitHub returned an unexpected response.');
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new UpdateLookupError('GitHub returned an unexpected response.');
  }
  return updateFromGitHubRelease(payload, options.currentVersion, false);
}
