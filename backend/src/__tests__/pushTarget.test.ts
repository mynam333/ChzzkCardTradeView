import { describe, expect, it } from 'vitest';
import { buildCouponPushUrl } from '../utils/pushTarget';

describe('buildCouponPushUrl', () => {
  it('builds a normalized coupon deep link', () => {
    expect(buildCouponPushUrl(' welcome-2026 ')).toBe('/my-info?coupon=WELCOME-2026');
  });

  it('uses the home page for a normal push', () => {
    expect(buildCouponPushUrl(null)).toBe('/');
    expect(buildCouponPushUrl('   ')).toBe('/');
  });
});
