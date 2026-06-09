/**
 * gachaWeights.ts - 카드 가치 기반 가챠 추첨 가중치 계산
 *
 * 핵심 아이디어:
 * - 각 카드의 추첨 가중치를 w_i = value_i^(-alpha) 로 둡니다.
 *   alpha > 0 이면 가치가 낮을수록 가중치(=확률)가 '항상' 높습니다.
 *   → "카드 가치가 낮으면 나올 확률이 높다"는 절대 명제가 언제나 유지됩니다.
 * - 단순히 alpha=1 (w=1/value)을 쓰면 추첨 기댓값이 '조화평균'이 되어 저가 카드에
 *   극단적으로 쏠리고 중간 가치 카드가 거의 나오지 않습니다.
 * - 그래서 분포가 매 순간 달라져도(시세 변동) 추첨 기댓값이 목표값(예: 2500) 근처가
 *   되도록 alpha를 적응적으로 탐색합니다.
 *   E(alpha) = Σ v^(1-alpha) / Σ v^(-alpha) 는 alpha에 대해 단조 감소이므로 이분 탐색이 가능합니다.
 *   (alpha를 키우면 저가 쏠림↑·기댓값↓, 줄이면 평탄↑·기댓값↑ — 다양성도 함께 증가)
 */

export interface DrawWeightResult {
  weights: number[];
  alpha: number;
  expected: number;
}

/** 주어진 alpha에서의 추첨 기댓값 E[value] = Σ v^(1-alpha) / Σ v^(-alpha) */
export const expectedValueForAlpha = (values: number[], alpha: number): number => {
  let numerator = 0; // Σ v^(1-alpha)
  let denominator = 0; // Σ v^(-alpha)
  for (const v of values) {
    const w = Math.pow(v, -alpha);
    denominator += w;
    numerator += v * w;
  }
  return denominator > 0 ? numerator / denominator : 0;
};

/**
 * 카드 가치 배열로부터 추첨 가중치를 계산합니다.
 * 추첨 기댓값이 targetExpected 부근이 되도록 alpha를 적응적으로 정합니다.
 *
 * @param rawValues   각 카드(스트리머)의 현재 가치 배열
 * @param targetExpected 목표 추첨 기댓값 (기본 2500)
 */
export const computeValueDrawWeights = (
  rawValues: number[],
  targetExpected = 2500,
  options: { alphaMin?: number; alphaMax?: number; iterations?: number } = {}
): DrawWeightResult => {
  const alphaMin = options.alphaMin ?? 0.05; // 0 초과 → 저가 우대 명제 유지(아주 평탄해도 단조 감소)
  const alphaMax = options.alphaMax ?? 4;    // 충분히 가파른 상한
  const iterations = options.iterations ?? 40;

  // 가치 하한 보정(0/음수/NaN 방지)
  const values = rawValues.map((v) => (Number.isFinite(v) && v > 0 ? v : 1));

  if (values.length === 0) {
    return { weights: [], alpha: alphaMin, expected: 0 };
  }

  // E(alpha)는 단조 감소. 경계에서 목표 도달 가능 여부를 먼저 판단.
  const eAtMin = expectedValueForAlpha(values, alphaMin); // 가장 평탄 → 낼 수 있는 최대 기댓값
  const eAtMax = expectedValueForAlpha(values, alphaMax); // 가장 가파름 → 최소 기댓값

  let alpha: number;
  if (eAtMin <= targetExpected) {
    // 저가 우대를 유지하며 낼 수 있는 최대 기댓값도 목표 미만 → 최대한 평탄하게(alphaMin)
    alpha = alphaMin;
  } else if (eAtMax >= targetExpected) {
    // 가장 가파르게 해도 목표 초과 → alphaMax
    alpha = alphaMax;
  } else {
    // 이분 탐색: E(alpha)가 단조 감소이므로 E > target이면 alpha를 키운다.
    let lo = alphaMin;
    let hi = alphaMax;
    for (let i = 0; i < iterations; i++) {
      const mid = (lo + hi) / 2;
      if (expectedValueForAlpha(values, mid) > targetExpected) lo = mid;
      else hi = mid;
    }
    alpha = (lo + hi) / 2;
  }

  const weights = values.map((v) => Math.pow(v, -alpha));
  return { weights, alpha, expected: expectedValueForAlpha(values, alpha) };
};
