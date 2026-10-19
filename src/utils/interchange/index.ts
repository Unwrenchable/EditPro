import { exportEdl, importEdl } from './edl';
import { exportFcpxml, importFcpxml } from './fcpxml';
import { exportXmeml, importXmeml } from './xmeml';
import type { InterchangeSequence } from './model';

export type InterchangeFormat = 'edl' | 'fcpxml' | 'xmeml';

export function detectInterchange(text: string, filename = ''): InterchangeFormat {
  const sample = text.slice(0, 8000);
  if (/<fcpxml[\s>]/i.test(sample)) return 'fcpxml';
  if (/<xmeml[\s>]/i.test(sample)) return 'xmeml';
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (extension === 'fcpxml') return 'fcpxml';
  if (extension === 'edl' || /^\s*TITLE\s*:/im.test(sample) || /^\s*FCM\s*:/im.test(sample)) return 'edl';
  if (extension === 'xml') return 'xmeml';
  throw new Error('Unrecognized interchange file');
}

/**
 * Read an FCPXML, FCP7/Premiere xmeml, or CMX 3600 EDL document.
 * `frameRate` is used for EDL, which does not store a rate. XML documents carry their own rate.
 */
export function importInterchange(text: string, filename = '', frameRate = 24): InterchangeSequence {
  const format = detectInterchange(text, filename);
  if (format === 'edl') return importEdl(text, frameRate);
  if (format === 'fcpxml') return importFcpxml(text);
  return importXmeml(text);
}

export function exportInterchange(sequence: InterchangeSequence, format: InterchangeFormat): string {
  if (format === 'edl') return exportEdl(sequence);
  if (format === 'fcpxml') return exportFcpxml(sequence);
  return exportXmeml(sequence);
}
