import { describe, expect, it } from 'vitest';
import {
  planCacheCleanup,
  planMediaRelink,
  planProxyRelink,
  recommendProxy,
  type CacheGroup,
} from './cachePolicy.js';

function group(partial: Partial<CacheGroup> & Pick<CacheGroup, 'id'>): CacheGroup {
  return {
    completeBytes: 0,
    partialBytes: 0,
    sidecarBytes: 0,
    lastUsedMs: 0,
    hasComplete: false,
    pinned: false,
    ...partial,
  };
}

describe('auto proxy rules', () => {
  it('sends 4K and heavy codecs to a proxy and leaves a short 720p file alone', () => {
    expect(recommendProxy({
      width: 3840,
      height: 2160,
      durationSec: 30,
      videoCodec: 'hevc',
      fileBytes: 500_000_000,
    })).toMatchObject({ required: true, scale: 'quarter' });
    expect(recommendProxy({
      width: 1920,
      height: 1080,
      durationSec: 20,
      videoCodec: 'prores',
      fileBytes: 1000,
    })).toMatchObject({ required: true, scale: 'half' });
    expect(recommendProxy({
      width: 1280,
      height: 720,
      durationSec: 12,
      videoCodec: 'h264',
      fileBytes: 20_000_000,
    })).toMatchObject({ required: false, scale: 'full' });
  });

  it('proxies a long 1080p recording and stays off when the rule is disabled', () => {
    const long = recommendProxy({
      width: 1920,
      height: 1080,
      durationSec: 20 * 60,
      videoCodec: 'h264',
      fileBytes: 1000,
    });
    expect(long.required).toBe(true);
    expect(long.scale).toBe('half');
    expect(recommendProxy({
      width: 3840,
      height: 2160,
      durationSec: 10,
      videoCodec: 'hevc',
      fileBytes: 10,
    }, { ...{
      enabled: false,
      fullResLongEdge: 1920,
      halfResLongEdge: 2560,
      heavyCodecs: ['hevc'],
      longDurationSec: 900,
      largeFileBytes: 8_000_000_000,
    } })).toMatchObject({ required: false, scale: 'full' });
  });
});

describe('proxy cache cleanup and relink', () => {
  it('drops partials and the oldest complete proxies until the budget is met', () => {
    const plan = planCacheCleanup([
      group({ id: 'partial', partialBytes: 50, sidecarBytes: 1, lastUsedMs: 1 }),
      group({ id: 'old', completeBytes: 800, sidecarBytes: 1, hasComplete: true, lastUsedMs: 10 }),
      group({ id: 'new', completeBytes: 800, sidecarBytes: 1, hasComplete: true, lastUsedMs: 50 }),
      group({ id: 'live', completeBytes: 800, sidecarBytes: 1, hasComplete: true, lastUsedMs: 5, pinned: true }),
    ], 1700);
    expect(plan.deleteIds).toContain('partial');
    expect(plan.deleteIds).toContain('old');
    expect(plan.deleteIds).not.toContain('live');
    expect(plan.deleteIds).not.toContain('new');
    expect(plan.remainingBytes).toBeLessThanOrEqual(1700);
  });

  it('trims a stale partial without deleting the finished proxy', () => {
    const plan = planCacheCleanup([
      group({ id: 'done', completeBytes: 100, partialBytes: 40, sidecarBytes: 1, hasComplete: true, lastUsedMs: 20 }),
    ], 1024 * 1024 * 1024);
    expect(plan.deleteIds).toEqual([]);
    expect(plan.trimPartialIds).toEqual(['done']);
    expect(plan.freedBytes).toBe(40);
  });

  it('matches offline media by name and size and will not reuse one file twice', () => {
    const matches = planMediaRelink(
      [
        { id: 'wide', name: 'A001.mov', size: 1000, durationSec: 12 },
        { id: 'close', name: 'B002.mp4', size: 2000, durationSec: 8 },
      ],
      [
        { id: 'wrong', name: 'notes.txt', size: 10, durationSec: null },
        { id: 'b', name: 'B002.mp4', size: 2000, durationSec: 8 },
        { id: 'a', name: 'A001.mov', size: 1000, durationSec: 12.01 },
        { id: 'a-copy', name: 'A001.mov', size: 1000, durationSec: 12 },
      ],
    );
    expect(matches.map((match) => [match.needId, match.candidateId])).toEqual([
      ['close', 'b'],
      ['wide', 'a-copy'],
    ]);
    expect(planMediaRelink(
      [{ id: 'wide', name: 'A001.mov', size: 1000, durationSec: null }],
      [{ id: 'other', name: 'totally-different.mov', size: 1000, durationSec: null }],
    )).toEqual([]);
  });

  it('relinks a moved proxy when the file name and size still match', () => {
    const moves = planProxyRelink(
      [
        { id: 'hash-half', sourcePath: '/old/card/A001.mov', sourceSize: 500, scale: 'half' },
        { id: 'hash-full', sourcePath: '/old/card/A001.mov', sourceSize: 500, scale: 'full' },
        { id: 'other', sourcePath: '/old/B002.mov', sourceSize: 10, scale: 'half' },
      ],
      [{ path: '/new/drive/A001.mov', size: 500, mtimeMs: 20 }],
    );
    expect(moves.map((move) => move.id).sort()).toEqual(['hash-full', 'hash-half']);
    expect(moves.every((move) => move.toPath.endsWith('A001.mov'))).toBe(true);
    expect(planProxyRelink(
      [{ id: 'hash', sourcePath: '/old/A001.mov', sourceSize: 500, scale: 'half' }],
      [{ path: '/new/A001.mov', size: 499, mtimeMs: 1 }],
    )).toEqual([]);
  });
});
