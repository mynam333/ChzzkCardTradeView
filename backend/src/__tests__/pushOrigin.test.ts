import { describe, expect, it } from 'vitest';
import {
  filterPushSubscriptionsByOrigin,
  getConfiguredPushOrigins,
  getRequestPushOrigin,
  isPushOriginAllowed,
  normalizePushOrigin
} from '../utils/pushOrigin';

describe('push origin helpers', () => {
  it('normalizes http origins and rejects invalid values', () => {
    expect(normalizePushOrigin('https://chikapo.yuaru.com/shop')).toBe('https://chikapo.yuaru.com');
    expect(normalizePushOrigin('ftp://chikapo.yuaru.com')).toBeNull();
    expect(normalizePushOrigin('not a url')).toBeNull();
  });

  it('uses explicit allowed push origins before fallbacks', () => {
    expect(getConfiguredPushOrigins({
      PUSH_ALLOWED_ORIGINS: 'https://chikapo.yuaru.com, https://cctv.yuaru.com',
      NODE_ENV: 'production'
    })).toEqual(['https://chikapo.yuaru.com', 'https://cctv.yuaru.com']);
  });

  it('defaults production push delivery to the current chikapo origin', () => {
    expect(getConfiguredPushOrigins({ NODE_ENV: 'production' })).toEqual(['https://chikapo.yuaru.com']);
  });

  it('falls back from body origin to request headers', () => {
    expect(getRequestPushOrigin('', 'https://chikapo.yuaru.com', '')).toBe('https://chikapo.yuaru.com');
    expect(getRequestPushOrigin('', '', 'https://chikapo.yuaru.com/my-info')).toBe('https://chikapo.yuaru.com');
  });

  it('allows only configured origins when configured', () => {
    expect(isPushOriginAllowed('https://chikapo.yuaru.com', ['https://chikapo.yuaru.com'])).toBe(true);
    expect(isPushOriginAllowed('https://cctv.yuaru.com', ['https://chikapo.yuaru.com'])).toBe(false);
    expect(isPushOriginAllowed(null, ['https://chikapo.yuaru.com'])).toBe(false);
  });

  it('filters legacy rows once the origin column exists', () => {
    expect(filterPushSubscriptionsByOrigin([
      { id: 1, origin: 'https://chikapo.yuaru.com' },
      { id: 2, origin: 'https://cctv.yuaru.com' },
      { id: 3, origin: null }
    ], ['https://chikapo.yuaru.com'])).toEqual([{ id: 1, origin: 'https://chikapo.yuaru.com' }]);
  });

  it('keeps delivery unchanged before the origin column is migrated', () => {
    expect(filterPushSubscriptionsByOrigin([{ id: 1 }, { id: 2 }], ['https://chikapo.yuaru.com']))
      .toEqual([{ id: 1 }, { id: 2 }]);
  });
});
