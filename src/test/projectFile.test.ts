import { describe, expect, it } from 'vitest';
import { createDefaultPhotoEdits, createDefaultVideoEdits } from '../utils/editSnapshots';
import {
  candidateMediaPaths,
  createProject,
  parseProject,
  ProjectFileError,
  resolveRelativePath,
  serializeProject,
  toRelativePath,
} from '../utils/projectFile';
import { addRecentFile, RECENT_FILES_LIMIT } from '../utils/recentFiles';
import type { RecentFileEntry } from '../utils/recentFiles';

describe('project file', () => {
  it('serializes a versioned project that references media paths', () => {
    const photo = createDefaultPhotoEdits();
    photo.adjustments = { ...photo.adjustments, brightness: 18 };
    photo.filter = 'dramatic';
    photo.rotation = 90;

    const video = createDefaultVideoEdits();
    video.trimStart = 1.25;
    video.trimEnd = 8;
    video.tracks = [...video.tracks, { id: 'v2', type: 'video', name: 'V2', muted: true, locked: false }];
    video.clips = [
      {
        id: 'clip-1',
        src: '/work/media/a.mp4',
        trackId: 'v1',
        startTime: 0,
        endTime: 4,
        inPoint: 1,
        outPoint: 5,
      },
    ];
    video.markers = [{ id: 'm1', time: 2, label: 'Hit', color: 'red' }];

    const project = createProject({
      mode: 'video',
      projectPath: '/work/album.editpro',
      savedAt: '2026-10-19T12:00:00.000Z',
      photo: { edits: photo, mediaPath: '/work/pics/still.jpg', mediaName: 'still.jpg' },
      video: { edits: video, mediaPath: '/work/media/a.mp4', mediaName: 'a.mp4', timelineZoom: 2 },
    });

    expect(project.format).toBe('editpro');
    expect(project.version).toBe(1);
    expect(project.media.map((item) => item.relativePath)).toEqual(['pics/still.jpg', 'media/a.mp4']);

    const parsed = parseProject(serializeProject(project));
    expect(parsed).toEqual(project);
    expect(parsed.photo.edits.adjustments.brightness).toBe(18);
    expect(parsed.photo.edits.filter).toBe('dramatic');
    expect(parsed.video.edits.clips[0]?.id).toBe('clip-1');
    expect(parsed.video.edits.markers[0]?.label).toBe('Hit');
    expect(parsed.video.timelineZoom).toBe(2);
  });

  it('fills defaults for a minimal version-1 file and rejects incompatible files', () => {
    const parsed = parseProject(JSON.stringify({ format: 'editpro', version: 1 }));
    expect(parsed.mode).toBe('photo');
    expect(parsed.photo.edits.filter).toBe('none');
    expect(parsed.video.edits.tracks.map((track) => track.id)).toEqual(['v1', 'a1']);
    expect(parsed.photo.edits.adjustments.contrast).toBe(0);

    expect(() => parseProject('not json')).toThrow(ProjectFileError);
    expect(() => parseProject(JSON.stringify({ format: 'other', version: 1 }))).toThrow(/not an EditPro project/);
    expect(() => parseProject(JSON.stringify({ format: 'editpro', version: 2 }))).toThrow(/version 2/);
  });

  it('keeps known adjustment keys and drops invalid timeline entries', () => {
    const parsed = parseProject(
      JSON.stringify({
        format: 'editpro',
        version: 1,
        photo: { edits: { adjustments: { brightness: 4, nope: 1 }, filter: 'not-a-filter' } },
        video: {
          edits: {
            markers: [{ id: '', time: 1 }, { id: 'ok', time: 3, label: 'Go', color: 'green' }, 'bad'],
            tracks: [{ id: 'v9', type: 'video', name: 'Titles' }],
          },
          timelineZoom: 99,
        },
      }),
    );

    expect(parsed.photo.edits.adjustments.brightness).toBe(4);
    expect(parsed.photo.edits.adjustments.exposure).toBe(0);
    expect(parsed.photo.edits.filter).toBe('none');
    expect(parsed.video.edits.markers).toEqual([{ id: 'ok', time: 3, label: 'Go', color: 'green' }]);
    expect(parsed.video.edits.tracks).toEqual([{ id: 'v9', type: 'video', name: 'Titles', muted: false, locked: false }]);
    expect(parsed.video.timelineZoom).toBe(8);
  });

  it('resolves media paths relative to the project file', () => {
    expect(toRelativePath('/projects/film.editpro', '/projects/media/a.mp4')).toBe('media/a.mp4');
    expect(resolveRelativePath('/projects/film.editpro', 'media/a.mp4')).toBe('/projects/media/a.mp4');
    expect(toRelativePath('C:\\docs\\film.editpro', 'D:\\media\\a.mp4')).toBeNull();
    expect(toRelativePath('C:\\docs\\film.editpro', 'C:\\docs\\media\\a.mp4')).toBe('media/a.mp4');
    expect(resolveRelativePath('C:\\docs\\film.editpro', 'media/a.mp4')).toBe('C:\\docs\\media\\a.mp4');

    const paths = candidateMediaPaths(
      { id: 'video', kind: 'video', name: 'a.mp4', path: '/old/a.mp4', relativePath: 'media/a.mp4' },
      '/projects/film.editpro',
    );
    expect(paths).toEqual(['/old/a.mp4', '/projects/media/a.mp4']);
  });
});

describe('recent files', () => {
  function entry(path: string, openedAt: string): RecentFileEntry {
    return { path, name: path, mode: 'photo', openedAt };
  }

  it('puts the newest entry first, dedupes, and caps the list', () => {
    let list: RecentFileEntry[] = [];
    for (let index = 0; index < RECENT_FILES_LIMIT + 2; index += 1) {
      list = addRecentFile(list, entry(`file-${index}.editpro`, `2026-10-19T00:00:${index.toString().padStart(2, '0')}Z`));
    }
    list = addRecentFile(list, entry('file-5.editpro', '2026-10-19T01:00:00Z'));

    expect(list).toHaveLength(RECENT_FILES_LIMIT);
    expect(list[0]?.path).toBe('file-5.editpro');
    expect(list.filter((item) => item.path === 'file-5.editpro')).toHaveLength(1);
    expect(list.some((item) => item.path === 'file-0.editpro')).toBe(false);
  });
});
