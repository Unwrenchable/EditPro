import { runFfmpeg } from '../ffmpegJob.js';
import { parseMediaDuration } from '../probe.js';
import { keptRanges, renderCutArgs, type TimeRange } from './plan.js';

export async function renderCut(options: {
  ffmpegPath: string;
  sourcePath: string;
  outputPath: string;
  ranges: readonly TimeRange[];
  signal?: AbortSignal;
  onProgress?: (percent: number, message: string) => void;
}): Promise<void> {
  options.onProgress?.(8, 'Reading the timeline');
  const probed = await runFfmpeg(options.ffmpegPath, ['-hide_banner', '-i', options.sourcePath, '-f', 'null', '-'], {
    signal: options.signal,
  });
  if (options.signal?.aborted) throw new Error('Cancelled');
  const duration = parseMediaDuration(probed.text);
  if (duration == null) throw new Error('Could not read the length of this video');
  const kept = keptRanges(duration, options.ranges);
  if (kept.length === 0) throw new Error('Nothing left to keep');
  options.onProgress?.(30, 'Writing the cut');
  const encoded = await runFfmpeg(
    options.ffmpegPath,
    renderCutArgs(options.sourcePath, kept, options.outputPath, false),
    { signal: options.signal },
  );
  if (encoded.cancelled) throw new Error('Cancelled');
  if (encoded.code === 0) {
    options.onProgress?.(100, 'Cut ready');
    return;
  }
  const silent = await runFfmpeg(
    options.ffmpegPath,
    renderCutArgs(options.sourcePath, kept, options.outputPath, true),
    { signal: options.signal },
  );
  if (silent.cancelled) throw new Error('Cancelled');
  if (silent.code !== 0) throw new Error('Could not write the cut');
  options.onProgress?.(100, 'Cut ready');
}
