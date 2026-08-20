import { describe, expect, it } from 'vitest';
import { formatMarketPrice } from '../utils/marketPrice';

describe('formatMarketPrice', () => {
  it('숫자 가격에 천 단위 구분자를 붙인다', () => {
    expect(formatMarketPrice(1_234_567)).toBe('1,234,567');
  });

  it('PostgreSQL BIGINT 문자열 가격에도 천 단위 구분자를 붙인다', () => {
    expect(formatMarketPrice('1234567')).toBe('1,234,567');
  });

  it('유효하지 않은 가격은 0으로 표시한다', () => {
    expect(formatMarketPrice('invalid')).toBe('0');
  });
});
