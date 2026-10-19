import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserPlatformFor, resetBrowserPlatformForTests, setNativeFileAccessForTests } from '../browserPlatform';
import { fileFromPicked, isNativeCancel, pickerTypes } from './files';

describe('native file picker', () => {
  it('maps accept lists to system media types', () => {
    expect(pickerTypes('image/jpeg, image/png')).toEqual(['image/jpeg', 'image/png']);
    expect(pickerTypes('video/mp4,.mkv,.mov,.editpro')).toEqual([
      'video/mp4',
      'video/x-matroska',
      'video/quicktime',
      'application/json',
      'application/octet-stream',
    ]);
  });

  it('builds a File from a content URI when the picker has no blob', async () => {
    const readUrl = vi.fn(async () => new Blob(['frame'], { type: 'video/mp4' }));
    const file = await fileFromPicked(
      { name: 'clip.mp4', mimeType: 'video/mp4', path: '/storage/clip.mp4' },
      readUrl,
      (path) => `https://localhost/_capacitor_file_${path}`,
    );
    expect(readUrl).toHaveBeenCalledWith('https://localhost/_capacitor_file_/storage/clip.mp4');
    expect(file?.name).toBe('clip.mp4');
    expect(file?.type).toBe('video/mp4');
    expect(await file?.text()).toBe('frame');
  });

  it('treats a dismissed picker as a cancel', () => {
    expect(isNativeCancel(new Error('pickFiles canceled'))).toBe(true);
    expect(isNativeCancel(new Error('plugin unavailable'))).toBe(false);
  });
});

describe('capacitor file access', () => {
  beforeEach(() => {
    resetBrowserPlatformForTests();
  });

  it('opens and shares through the native picker instead of a browser input', async () => {
    const pick = vi.fn(async () => [new File(['v'], 'clip.mp4', { type: 'video/mp4' })]);
    const share = vi.fn(async () => true);
    setNativeFileAccessForTests(pick, share);
    const platform = browserPlatformFor('capacitor');
    const id = await platform.openVideo();
    expect(pick).toHaveBeenCalledWith(expect.stringContaining('video/mp4'), false);
    expect(id).toBeTruthy();
    const blob = new Blob(['out'], { type: 'video/mp4' });
    expect(await platform.shareFile(blob, 'out.mp4', 'Export')).toBe(true);
    expect(share).toHaveBeenCalledWith(blob, 'out.mp4', 'Export');
  });
});
