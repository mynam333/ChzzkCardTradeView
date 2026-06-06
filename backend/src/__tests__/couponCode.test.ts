import { describe, expect, it } from 'vitest';
import { normalizeCouponCode } from '../utils/couponCode';

describe('normalizeCouponCode', () => {
  it('removes surrounding whitespace and normalizes letter case', () => {
    expect(normalizeCouponCode('  c-ab12-cd34-ef56  ')).toBe('C-AB12-CD34-EF56');
  });

  it('rejects non-string values', () => {
    expect(normalizeCouponCode(undefined)).toBe('');
    expect(normalizeCouponCode(1234)).toBe('');
  });
});
