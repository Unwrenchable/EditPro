import { runFfmpeg } from '../ffmpegJob.js';
import { parseSceneLog, sceneFilterArgs, type SceneHit } from './plan.js';

export async function detectScenes(options: {
  ffmpegPath: string;
  sourcePath: string;
  threshold: number;
  signal?: AbortSignal;
}): Promise<SceneHit[]> {
  const result = await runFfmpeg(
    options.ffmpegPath,
    sceneFilterArgs(options.sourcePath, options.threshold),
    { signal: options.signal },
  );
  if (result.cancelled) throw new Error('Cancelled');
  if (result.code !== 0 && !result.text.includes('scene_score')) {
    throw new Error('Could not scan this video for scene cuts');
  }
  return parseSceneLog(result.text);
}
