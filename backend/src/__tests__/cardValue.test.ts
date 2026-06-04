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

  it('현재 가치가 팔로워보다 훨씬 작으면 상승 확률이 급격하게(기하급수적으로) 올라간다', () => {
    const followers = 10000;
    const value = 100; // 팔로워 대비 99% 작음 -> 상승 확률 100%에 근접
    let ups = 0;
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const d = computeRandomDrift(value, followers);
      if (d > 0) ups++;
    }
    // 거의 대부분 상승해야 함 (95% 이상으로 보수적 검증)
    expect(ups).toBeGreaterThan(iterations * 0.95);
  });

  it('현재 가치가 팔로워보다 훨씬 크면(200% 이상) 하락 확률이 100%에 근접한다', () => {
    const followers = 10000;
    const value = 30001; // 팔로워 대비 200% 초과하여 큼 -> 상승 확률 0%에 근접
    let downs = 0;
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const d = computeRandomDrift(value, followers);
      if (d < 0) downs++;
    }
    // 거의 대부분 하락해야 함 (95% 이상으로 보수적 검증)
    expect(downs).toBeGreaterThan(iterations * 0.95);
  });

  it('현재 가치와 팔로워의 차이가 미세하면 확률 변동도 미세하다 (50:50에 가깝다)', () => {
    const followers = 10000;
    const value = 9900; // 차이가 1% 수준 -> 변동 미세
    let ups = 0;
    const iterations = 2000;
    for (let i = 0; i < iterations; i++) {
      const d = computeRandomDrift(value, followers);
      if (d > 0) ups++;
    }
    // z = 0.01일 때 w = (e^0.04 - 1)/(e^4 - 1) = (1.0408 - 1)/53.598 = 0.00076
    // pUp = 0.5 + 0.5 * 0.00076 = 0.50038
    // 따라서 45% ~ 55% 사이로 분포해야 함
    expect(ups).toBeGreaterThan(iterations * 0.43);
    expect(ups).toBeLessThan(iterations * 0.57);
  });
});

