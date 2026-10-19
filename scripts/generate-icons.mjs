/**
 * Rasterize build-resources/icon.svg into the icon files electron-builder expects.
 *
 *   npm run generate:icons
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.join(root, 'build-resources');
const svgPath = path.join(resources, 'icon.svg');
const iconsDir = path.join(resources, 'icons');
const svg = readFileSync(svgPath);

/** Sizes named in build-resources/ICONS.md plus the intermediate sizes electron-builder copies into hicolor. */
const linuxSizes = [16, 24, 32, 48, 64, 96, 128, 256, 512, 1024];

function renderPng(size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0, 0, 0, 0)',
  });
  const rendered = resvg.render();
  if (rendered.width !== size || rendered.height !== size) {
    throw new Error(`Expected ${size}x${size} PNG, got ${rendered.width}x${rendered.height}`);
  }
  return rendered.asPng();
}

function walk(dir, extension, matches = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, extension, matches);
    else if (entry.endsWith(extension)) matches.push(full);
  }
  return matches;
}

function createIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  const blobs = [];
  for (const [index, image] of images.entries()) {
    const entry = directory.subarray(index * 16, (index + 1) * 16);
    const dimension = image.size >= 256 ? 0 : image.size;
    entry.writeUInt8(dimension, 0);
    entry.writeUInt8(dimension, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    blobs.push(image.png);
    offset += image.png.length;
  }
  return Buffer.concat([header, directory, ...blobs]);
}

function buildIcon(appBuilder, format, outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const result = spawnSync(
    appBuilder,
    ['icon', '--format', format, '--root', resources, '--input', 'icon.png', '--out', outDir],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    throw new Error(`app-builder icon --format ${format} failed with status ${result.status}`);
  }
}

mkdirSync(iconsDir, { recursive: true });

const master = renderPng(1024);
writeFileSync(path.join(resources, 'icon.png'), master);
for (const size of linuxSizes) {
  const png = size === 1024 ? master : renderPng(size);
  writeFileSync(path.join(iconsDir, `${size}x${size}.png`), png);
}
writeFileSync(path.join(root, 'public', 'favicon.svg'), svg);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(
  path.join(resources, 'icon.ico'),
  createIco(icoSizes.map((size) => ({ size, png: readFileSync(path.join(iconsDir, `${size}x${size}.png`)) }))),
);

function appBuilderBin() {
  const binRoot = path.join(root, 'node_modules', 'app-builder-bin');
  if (process.platform === 'darwin') {
    return path.join(binRoot, 'mac', process.arch === 'arm64' ? 'app-builder_arm64' : 'app-builder_amd64');
  }
  if (process.platform === 'win32') {
    const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64';
    return path.join(binRoot, 'win', arch, 'app-builder.exe');
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return path.join(binRoot, 'linux', arch, 'app-builder');
}

const appBuilder = appBuilderBin();
const staging = path.join(resources, '.icon-staging');
buildIcon(appBuilder, 'icns', path.join(staging, 'icns'));

const icnsFiles = walk(path.join(staging, 'icns'), '.icns');
if (icnsFiles.length !== 1) {
  throw new Error(`Expected one icns, found ${icnsFiles.length}`);
}
copyFileSync(icnsFiles[0], path.join(resources, 'icon.icns'));
rmSync(staging, { recursive: true, force: true });

const ico = readFileSync(path.join(resources, 'icon.ico'));
const icns = readFileSync(path.join(resources, 'icon.icns'));
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) {
  throw new Error('icon.ico is missing an ICONDIR header');
}
if (icns.subarray(0, 4).toString('ascii') !== 'icns') {
  throw new Error('icon.icns is missing an icns header');
}

console.log(
  `Wrote icon.png, icon.ico (${ico.length} bytes), icon.icns (${icns.length} bytes), and ${linuxSizes.length} linux PNGs.`,
);
