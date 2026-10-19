/**
 * Renderer entry for proxy rules. The implementation is shared with the main
 * process so the monitor and the cache manager cannot drift apart.
 */
export {
  DEFAULT_CACHE_LIMIT_BYTES,
  MAX_CACHE_LIMIT_BYTES,
  MIN_CACHE_LIMIT_BYTES,
  clampCacheLimit,
  defaultAutoProxyRules,
  planCacheCleanup,
  planMediaRelink,
  planProxyRelink,
  recommendProxy,
} from '../../../electron/playback/cachePolicy';

export type {
  AutoProxyRules,
  CacheCleanupPlan,
  CacheGroup,
  MediaRelinkCandidate,
  MediaRelinkMatch,
  MediaRelinkNeed,
  ProxyDecision,
  ProxyRelinkEntry,
  ProxyRelinkMove,
  ProxyRelinkTarget,
  ProxyScale,
  ProxySourceProfile,
} from '../../../electron/playback/cachePolicy';
