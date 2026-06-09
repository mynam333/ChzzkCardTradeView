import { describe, expect, it } from 'vitest';
import { computeValueDrawWeights, expectedValueForAlpha } from '../utils/gachaWeights';

describe('computeValueDrawWeights', () => {
  it('가치가 낮을수록 가중치가 항상 더 크다 (절대 명제 보존)', () => {
    const values = [100, 500, 1000, 5000, 50000, 300000];
    const { weights, alpha } = computeValueDrawWeights(values, 2500);
    expect(alpha).toBeGreaterThan(0);
    // 값이 오름차순이므로 가중치는 엄격히 내림차순이어야 한다.
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeLessThan(weights[i - 1]);
    }
  });

  it('분포가 넓을 때 추첨 기댓값을 목표값(2500) 근처로 맞춘다', () => {
    const values: number[] = [];
    for (let i = 0; i < 200; i++) values.push(100 + Math.round((i / 199) * 1900)); // 100~2000 저가 다수
    for (let i = 0; i < 20; i++) values.push(10000 + Math.round((i / 19) * 90000)); // 1만~10만 고가 소수

    const { weights, expected } = computeValueDrawWeights(values, 2500);

    // 가중치 합으로 실제 기댓값을 다시 계산해 검증 (Σ v*w / Σ w)
    const totalW = weights.reduce((s, w) => s + w, 0);
    const realExpected = values.reduce((s, v, i) => s + v * weights[i], 0) / totalW;

    expect(expected).toBeGreaterThan(2000);
    expect(expected).toBeLessThan(3000);
    expect(realExpected).toBeCloseTo(expected, 5);
  });

  it('기존 1/value(alpha=1) 방식보다 기댓값이 더 높다 (중간 가치 카드 노출↑)', () => {
    const values: number[] = [];
    for (let i = 0; i < 200; i++) values.push(100 + Math.round((i / 199) * 1900));
    for (let i = 0; i < 20; i++) values.push(10000 + Math.round((i / 19) * 90000));

    const harmonicMeanExpected = expectedValueForAlpha(values, 1); // 기존 방식 = 조화평균
    const { expected } = computeValueDrawWeights(values, 2500);
    expect(expected).toBeGreaterThan(harmonicMeanExpected);
  });

  it('전체 가치가 목표보다 낮으면 최대한 평탄하게(alphaMin) 처리한다', () => {
    const values = [100, 200, 300, 400, 500]; // 모두 목표(2500)보다 훨씬 낮음
    const { alpha, weights } = computeValueDrawWeights(values, 2500, { alphaMin: 0.05 });
    expect(alpha).toBeCloseTo(0.05, 5);
    // 그래도 저가 우대 명제는 유지
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]).toBeLessThan(weights[i - 1]);
    }
  });

  it('빈 배열은 안전하게 처리한다', () => {
    const { weights, expected } = computeValueDrawWeights([], 2500);
    expect(weights).toEqual([]);
    expect(expected).toBe(0);
  });
});
