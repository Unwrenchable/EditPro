/**
 * @vitest-environment node
 *
 * Packaged EditPro evaluates dist-electron/main.js as Node ESM from inside
 * app.asar. An extensionless relative import crashes launch with
 * ERR_MODULE_NOT_FOUND before a window opens.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runGraphCheck(): string {
  try {
    return execFileSync(process.execPath, ['scripts/check-electron-esm.mjs'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    });
  } catch (error) {
    const failed = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    const details = [failed.stdout, failed.stderr, failed.message].filter((part) => typeof part === 'string').join('\n');
    throw new Error(details);
  }
}

describe('electron main-process ESM graph', () => {
  it('compiles and imports dist-electron/main.js under Node', () => {
    expect(runGraphCheck()).toContain('electron ESM graph ok');
  }, 120_000);
});
