import { isFilesystemPath } from '../../utils/video/exportPlan';

const VIRTUAL_INPUT = 'input';

export function outputVirtualName(outputPath: string): string {
  const base = outputPath.split(/[/\\]/).pop() ?? 'output.mp4';
  const match = /\.([a-z0-9]{1,8})$/i.exec(base);
  return match ? `output.${match[1].toLowerCase()}` : 'output.mp4';
}

/**
 * Point the desktop export plan at ffmpeg.wasm's in-memory files.
 * `-progress pipe:1` is dropped; wasm reports progress on its own event.
 * Any other absolute path is returned in `blocked` so multicam desktop
 * paths are not silently omitted.
 */
export function rewriteFfmpegArgsForWasm(
  args: readonly string[],
  inputPath: string,
  outputPath: string,
): { args: string[]; outputName: string; blocked: string[] } {
  const outputName = outputVirtualName(outputPath);
  const rewritten: string[] = [];
  const blocked: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-progress') {
      index += 1;
      continue;
    }
    let next = arg;
    if (arg === inputPath) next = VIRTUAL_INPUT;
    else if (arg === outputPath) next = outputName;
    if (isFilesystemPath(next)) blocked.push(next);
    rewritten.push(next);
  }
  return { args: rewritten, outputName, blocked };
}
