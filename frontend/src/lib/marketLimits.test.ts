import { describe, expect, it } from 'vitest';
import { formatMarketPrice, MAX_MARKET_PRICE } from './marketLimits';

describe('formatMarketPrice', () => {
  it('숫자 가격에 천 단위 구분자를 붙인다', () => {
    expect(formatMarketPrice(1_234_567)).toBe('1,234,567');
  });

  it('PostgreSQL BIGINT 문자열 가격에도 천 단위 구분자를 붙인다', () => {
    expect(formatMarketPrice('1234567')).toBe('1,234,567');
    expect(formatMarketPrice(String(MAX_MARKET_PRICE))).toBe('999,999,999');
  });

  it('비어 있거나 유효하지 않은 가격은 0으로 표시한다', () => {
    expect(formatMarketPrice(null)).toBe('0');
    expect(formatMarketPrice('invalid')).toBe('0');
  });
});
