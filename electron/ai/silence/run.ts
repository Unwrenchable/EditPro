import { runFfmpeg } from '../ffmpegJob.js';
import { parseMediaDuration, parseSilenceLog, silenceCuts, silenceFilterArgs, type TimeRange } from './plan.js';

export async function detectSilence(options: {
  ffmpegPath: string;
  sourcePath: string;
  noiseDb: number;
  minDuration: number;
  padding: number;
  signal?: AbortSignal;
}): Promise<{ duration: number; ranges: TimeRange[] }> {
  const result = await runFfmpeg(
    options.ffmpegPath,
    silenceFilterArgs(options.sourcePath, options.noiseDb, options.minDuration),
    { signal: options.signal },
  );
  if (result.cancelled) throw new Error('Cancelled');
  const duration = parseMediaDuration(result.text);
  if (result.code !== 0 || duration == null) {
    throw new Error('Could not scan this video for silence');
  }
  return {
    duration,
    ranges: silenceCuts(parseSilenceLog(result.text, duration), options.padding),
  };
}
