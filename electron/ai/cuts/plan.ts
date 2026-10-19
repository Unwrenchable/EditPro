/**
 * Keep the complement of the removed ranges and encode it as one file.
 */
export interface TimeRange {
  start: number;
  end: number;
}

export function keptRanges(duration: number, removed: readonly TimeRange[]): TimeRange[] {
  const sorted = removed
    .filter((range) => range.end - range.start >= 0.02 && range.end > 0)
    .map((range) => ({
      start: Math.max(0, range.start),
      end: Math.min(duration, range.end),
    }))
    .filter((range) => range.end - range.start >= 0.02)
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) merged.push({ ...range });
    else previous.end = Math.max(previous.end, range.end);
  }
  const kept: TimeRange[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start - cursor >= 0.05) kept.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (duration - cursor >= 0.05) kept.push({ start: cursor, end: duration });
  return kept;
}

function between(ranges: readonly TimeRange[]): string {
  return ranges
    .map((range) => `between(t\\,${range.start.toFixed(3)}\\,${range.end.toFixed(3)})`)
    .join('+');
}

export function renderCutArgs(input: string, kept: readonly TimeRange[], output: string, dropAudio: boolean): string[] {
  const gate = between(kept);
  const filter = dropAudio
    ? `[0:v]select='${gate}',setpts=N/FRAME_RATE/TB[vout]`
    : `[0:v]select='${gate}',setpts=N/FRAME_RATE/TB[vout];[0:a]aselect='${gate}',asetpts=N/SR/TB[aout]`;
  return [
    '-y',
    '-hide_banner',
    '-i',
    input,
    '-filter_complex',
    filter,
    '-map',
    '[vout]',
    ...(dropAudio ? ['-an'] : ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k']),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    '-preset',
    'veryfast',
    output,
  ];
}
