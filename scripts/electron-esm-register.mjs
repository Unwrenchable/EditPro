/**
 * Installs the ESM hooks before dist-electron/main.js is imported.
 * Loaded with `node --import` so the hooks exist before the entry evaluates.
 */
import { register } from 'node:module';

register(new URL('./electron-esm-hooks.mjs', import.meta.url).href, import.meta.url);
