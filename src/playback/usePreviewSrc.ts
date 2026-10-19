import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Assigns the monitor src after marking a preview exchange.
 * A new camera file must not restore the previous clip's playhead.
 * A proxy becoming ready must. The flag is set before `src` changes, so
 * `loadedmetadata` can keep the editorial duration and the playhead.
 */
export function usePreviewSrc(
  videoRef: RefObject<HTMLVideoElement | null>,
  nextUrl: string | null,
  mediaKey: string | null,
): void {
  const previousUrl = useRef<string | null>(null);
  const previousMedia = useRef<string | null | undefined>(undefined);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const mediaChanged = previousMedia.current !== undefined && previousMedia.current !== mediaKey;
    const urlChanged = previousUrl.current !== nextUrl;
    previousMedia.current = mediaKey;
    if (!urlChanged) return;

    if (previousUrl.current && !mediaChanged) {
      video.dataset.previewSwap = '1';
      video.dataset.resumeTime = String(video.currentTime || 0);
    } else {
      delete video.dataset.previewSwap;
      delete video.dataset.resumeTime;
    }
    previousUrl.current = nextUrl;
    video.crossOrigin = nextUrl?.startsWith('media:') ? 'anonymous' : '';
    if (nextUrl) video.src = nextUrl;
    else video.removeAttribute('src');
  }, [nextUrl, mediaKey, videoRef]);
}
