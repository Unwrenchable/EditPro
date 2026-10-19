/**
 * Compiles the Electron main process and imports dist-electron/main.js under
 * Node ESM. Extensionless relative imports fail here with ERR_MODULE_NOT_FOUND,
 * which is the packaged-app crash (NSIS and portable).
 *
 *   node scripts/check-electron-esm.mjs
 *   node scripts/check-electron-esm.mjs --dist /path/to/extracted/dist-electron
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = /\.(?:js|mjs|cjs|json|node|wasm)(?:[?#].*)?$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.[^'"]+)\1/g;

function parseArgs(argv) {
  const opts = {
    dist: path.join(root, 'dist-electron'),
    skipCompile: false,
    skipSource: false,
    load: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--load') opts.load = true;
    else if (arg === '--skip-compile') opts.skipCompile = true;
    else if (arg === '--skip-source') opts.skipSource = true;
    else if (arg === '--dist') {
      const value = argv[i + 1];
      if (!value) {
        console.error('--dist requires a directory');
        process.exit(2);
      }
      opts.dist = path.resolve(value);
      opts.skipCompile = true;
      opts.skipSource = true;
      i += 1;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function relativeSpecifiers(source) {
  const found = [];
  let inBlock = false;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlock = false;
    }
    while (line.includes('/*')) {
      const start = line.indexOf('/*');
      const end = line.indexOf('*/', start + 2);
      if (end === -1) {
        line = line.slice(0, start);
        inBlock = true;
        break;
      }
      line = `${line.slice(0, start)}${line.slice(end + 2)}`;
    }
    line = line.replace(/(^|[^:])\/\/.*$/, '$1');
    SPECIFIER.lastIndex = 0;
    for (const match of line.matchAll(SPECIFIER)) {
      found.push({ specifier: match[2], line: index + 1 });
    }
  }
  return found;
}

function assertExtensions(files, labelFor) {
  const problems = [];
  for (const file of files) {
    const specifiers = relativeSpecifiers(fs.readFileSync(file, 'utf8'));
    for (const item of specifiers) {
      if (!EXTENSION.test(item.specifier)) {
        problems.push(`${labelFor(file)}:${item.line} imports '${item.specifier}' without a .js extension`);
      }
    }
  }
  if (problems.length > 0) {
    console.error('Node ESM cannot resolve these relative imports:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
}

function assertSourceExtensions() {
  const files = walk(path.join(root, 'electron')).filter((file) => file.endsWith('.ts'));
  assertExtensions(files, (file) => path.relative(root, file));
}

function assertCompiledExtensions(distDir) {
  const files = walk(distDir).filter((file) => file.endsWith('.js'));
  assertExtensions(files, (file) => path.relative(distDir, file));
}

function selfCheckSpecifiers() {
  const bad = relativeSpecifiers("import { motionGraph } from './motion';\n");
  const good = relativeSpecifiers("export { motionGraph } from './motion.js';\n");
  if (bad.length !== 1 || EXTENSION.test(bad[0].specifier) || good.length !== 1 || !EXTENSION.test(good[0].specifier)) {
    console.error('relative-import checker failed its self-test');
    process.exit(1);
  }
}

function compileElectron() {
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', 'electron/tsconfig.json'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, [tsc, '-p', 'electron/tsconfig.preload.json'], { cwd: root, stdio: 'inherit' });
}

function electronImportNames(distDir) {
  const names = new Set();
  const pattern = /import\s*\{([^}]+)\}\s*from\s*['"]electron['"]/g;
  for (const file of walk(distDir)) {
    if (!file.endsWith('.js')) continue;
    const source = fs.readFileSync(file, 'utf8');
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').replace(/\s+as\s+.+$/, '').trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
    }
  }
  if (!names.has('app')) {
    console.error(`expected ${path.join(distDir, 'main.js')} to import { app } from 'electron'`);
    process.exit(1);
  }
  return [...names].sort();
}

function writeStub(names) {
  const exports = names.map((name) => `export const ${name} = electronSurface();`).join('\n');
  const source = `function electronSurface() {
  function call() {
    return chain;
  }
  const chain = new Proxy(call, {
    get(_target, prop) {
      if (prop === 'then') {
        // Do not run app.whenReady().then(boot). Evaluating the graph must not start the app.
        return function then() {
          return chain;
        };
      }
      if (prop === Symbol.toStringTag) return 'ElectronStub';
      if (typeof prop === 'symbol' || prop === 'toJSON') return undefined;
      return chain;
    },
    apply() {
      return chain;
    },
    construct() {
      return chain;
    },
  });
  return chain;
}
${exports}
export default { ${names.join(', ')} };
`;
  const file = path.join(os.tmpdir(), `editpro-electron-stub-${process.pid}.mjs`);
  fs.writeFileSync(file, source);
  return file;
}

function wasLoaded(loaded, ...parts) {
  const suffix = path.sep + path.join(...parts);
  return loaded.some((file) => file.endsWith(suffix));
}

async function importGraph(distDir) {
  const mainPath = path.join(distDir, 'main.js');
  if (!fs.existsSync(mainPath)) {
    console.error(`missing compiled entry ${mainPath}`);
    process.exit(1);
  }
  await import(pathToFileURL(mainPath).href);
  const loaded = fs.readFileSync(process.env.ELECTRON_ESM_LOAD_LOG, 'utf8').split(/\r?\n/).filter(Boolean);
  const required = [
    ['main.js'],
    ['export', 'plan.js'],
    ['export', 'creative.js'],
    ['export', 'motion.js'],
    ['export', 'runner.js'],
    ['security.js'],
    ['playback', 'register.js'],
    ['updates', 'controller.js'],
  ];
  const missing = required.filter((parts) => !wasLoaded(loaded, ...parts));
  if (missing.length > 0) {
    console.error('dist-electron/main.js loaded, but these modules were absent from the Node ESM graph:');
    for (const parts of missing) console.error(`  ${parts.join('/')}`);
    console.error(loaded.join('\n') || '(nothing logged)');
    process.exit(1);
  }
  console.log(`electron ESM graph ok (${loaded.length} modules)`);
}

function loadInChild(distDir, stubPath) {
  const logPath = path.join(os.tmpdir(), `editpro-esm-load-${process.pid}.log`);
  fs.writeFileSync(logPath, '');
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  env.ELECTRON_ESM_STUB = stubPath;
  env.ELECTRON_ESM_LOAD_LOG = logPath;
  env.ELECTRON_ESM_DIST = distDir;
  const child = spawnSync(
    process.execPath,
    ['--import', path.join(root, 'scripts', 'electron-esm-register.mjs'), fileURLToPath(import.meta.url), '--load'],
    { cwd: root, env, encoding: 'utf8', timeout: 30_000 },
  );
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) {
    console.error(child.error.message);
    process.exit(1);
  }
  if (child.status !== 0) process.exit(child.status ?? 1);
  if (!child.stdout.includes('electron ESM graph ok')) {
    console.error('electron graph import finished without loading the module graph');
    process.exit(1);
  }
}

const opts = parseArgs(process.argv);
if (opts.load) {
  await importGraph(process.env.ELECTRON_ESM_DIST);
} else {
  selfCheckSpecifiers();
  if (!opts.skipSource) assertSourceExtensions();
  if (!opts.skipCompile) compileElectron();
  assertCompiledExtensions(opts.dist);
  const stubPath = writeStub(electronImportNames(opts.dist));
  loadInChild(opts.dist, stubPath);
}
