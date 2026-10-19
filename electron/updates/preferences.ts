import fs from 'node:fs';
import path from 'node:path';
import { sanitizePreferences, type AppPreferences } from './policy.js';

export function readPreferencesFile(filePath: string): AppPreferences {
  try {
    return sanitizePreferences(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return sanitizePreferences(null);
  }
}

export function writePreferencesFile(filePath: string, preferences: AppPreferences): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(preferences), 'utf8');
  fs.renameSync(tmp, filePath);
}
