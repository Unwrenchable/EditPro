/**
 * ffmpeg scene-score log. `metadata=print` emits pts_time and lavfi.scene_score.
 */
export interface SceneHit {
  time: number;
  score: number;
}

export function parseSceneLog(log: string): SceneHit[] {
  const hits: SceneHit[] = [];
  let pendingTime: number | null = null;
  const lines = log.split(/\r?\n/);
  for (const line of lines) {
    const timeMatch = /pts_time:(\d+(?:\.\d+)?)/.exec(line);
    const scoreMatch = /lavfi\.scene_score[=:](\d+(?:\.\d+)?)/.exec(line);
    if (timeMatch) pendingTime = Number(timeMatch[1]);
    if (scoreMatch && pendingTime != null && Number.isFinite(pendingTime)) {
      const score = Number(scoreMatch[1]);
      if (score > 0 && pendingTime > 0.04) hits.push({ time: pendingTime, score });
      pendingTime = null;
    }
  }
  hits.sort((a, b) => a.time - b.time);
  const deduped: SceneHit[] = [];
  for (const hit of hits) {
    const previous = deduped[deduped.length - 1];
    if (previous && hit.time - previous.time < 0.2) {
      if (hit.score > previous.score) deduped[deduped.length - 1] = hit;
      continue;
    }
    deduped.push(hit);
  }
  return deduped;
}

export function sceneFilterArgs(input: string, threshold: number): string[] {
  const gate = Math.max(0.05, Math.min(0.9, threshold));
  return [
    '-hide_banner',
    '-i',
    input,
    '-filter:v',
    `select='gt(scene\\,${gate.toFixed(3)})',metadata=print`,
    '-an',
    '-f',
    'null',
    '-',
  ];
}
