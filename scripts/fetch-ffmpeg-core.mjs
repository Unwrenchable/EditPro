/**
 * Download the ffmpeg.wasm core into public/ffmpeg so a web build can load it
 * from the same origin. The files are large and are not committed.
 *
 *   npm run fetch:ffmpeg
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '0.12.10';
const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${version}/dist/esm`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'public', 'ffmpeg');

await mkdir(dest, { recursive: true });
for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) {
  const response = await fetch(`${base}/${name}`);
  if (!response.ok) {
    throw new Error(`Could not download ${name} (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(dest, name), bytes);
  console.log(`wrote public/ffmpeg/${name} (${bytes.length} bytes)`);
}
