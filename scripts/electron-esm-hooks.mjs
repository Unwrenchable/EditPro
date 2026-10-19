/**
 * Node ESM hooks for the packaged-main regression check.
 * `electron` is replaced with a stub so the module graph can evaluate under
 * plain Node. Relative specifiers still use Node's resolver, which rejects
 * extensionless imports the same way app.asar does.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function distPrefix() {
  const dist = process.env.ELECTRON_ESM_DIST;
  if (!dist) return null;
  return `${pathToFileURL(path.resolve(dist)).href.replace(/\/$/, '')}/`;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    const stub = process.env.ELECTRON_ESM_STUB;
    if (!stub) throw new Error('ELECTRON_ESM_STUB is not set');
    return {
      url: pathToFileURL(stub).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const prefix = distPrefix();
  const logPath = process.env.ELECTRON_ESM_LOAD_LOG;
  if (prefix && logPath && url.startsWith(prefix) && url.split(/[?#]/, 1)[0].endsWith('.js')) {
    fs.appendFileSync(logPath, `${fileURLToPath(url)}\n`);
  }
  return nextLoad(url, context);
}
