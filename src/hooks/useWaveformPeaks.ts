import { useEffect, useState } from 'react';
import { waveformPeaks } from '../utils/video/creative';

interface WaveformSample {
  url: string;
  peaks: number[];
  duration: number;
}

const EMPTY = { peaks: [] as number[], duration: 0 };

/** Peak envelope for the loaded media. Empty when the browser cannot decode it. */
export function useWaveformPeaks(url: string | null): { peaks: number[]; duration: number } {
  const [loaded, setLoaded] = useState<WaveformSample | null>(null);

  useEffect(() => {
    if (!url || typeof AudioContext === 'undefined') return;
    let cancelled = false;
    const context = new AudioContext();
    fetch(url)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .then((audio) => {
        if (cancelled) return;
        const channel = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(channel.length / 4000));
        const compact = new Float32Array(Math.ceil(channel.length / step));
        for (let index = 0; index < compact.length; index += 1) compact[index] = channel[index * step] ?? 0;
        setLoaded({ url, peaks: waveformPeaks(compact, 180), duration: audio.duration });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ url, peaks: [], duration: 0 });
      })
      .finally(() => {
        void context.close();
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!url || !loaded || loaded.url !== url) return EMPTY;
  return loaded;
}
