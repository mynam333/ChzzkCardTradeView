import { describe, it, expect } from 'vitest';
import { calculateCardValue, computeRandomDrift } from '../cron/streamerScheduler';

describe('calculateCardValue', () => {
  it('결과는 항상 100~500,000 범위로 클램프된다', () => {
    for (let i = 0; i < 50; i++) {
      const v = calculateCardValue(250000, 1000, 0.01, 100, 50, true, 5);
      expect(v).toBeGreaterThanOrEqual(100);
      expect(v).toBeLessThanOrEqual(500000);
    }
  });

  it('극단적으로 큰 값/델타는 상한(500,000)으로 제한된다', () => {
    const v = calculateCardValue(1_000_000, 999999, 0.05, 99999, 9999, true, 99999);
    expect(v).toBe(500000);
  });

  it('극단적으로 작은 값/음수 델타는 하한(100)으로 제한된다', () => {
    const v = calculateCardValue(120, 1, -0.05, 0, 0, false, -1000);
    expect(v).toBe(100);
  });

  it('prevValue가 0 이하면 followers를 기준값으로 사용한다 (하한 보장)', () => {
    const v = calculateCardValue(0, 5000, 0, 0, 0, false, 0);
    expect(v).toBeGreaterThanOrEqual(100);
    expect(v).toBeLessThanOrEqual(500000);
  });
});

describe('computeRandomDrift', () => {
  it('변동량은 항상 현재 가치의 ±2.5% 이내다', () => {
    const value = 10000;
    for (let i = 0; i < 1000; i++) {
      const drift = computeRandomDrift(value);
      expect(Math.abs(drift)).toBeLessThanOrEqual(value * 0.025 + 1e-9);
    }
  });

  it('상승/하락이 모두 발생한다 (한쪽으로 치우치지 않음)', () => {
    let ups = 0, downs = 0;
    for (let i = 0; i < 1000; i++) {
      const d = computeRandomDrift(10000);
      if (d > 0) ups++;
      else if (d < 0) downs++;
    }
    expect(ups).toBeGreaterThan(0);
    expect(downs).toBeGreaterThan(0);
  });
});
