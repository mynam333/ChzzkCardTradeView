type ArenaCosmeticActivation = { active: boolean };

/**
 * 성공한 응답만 적용 순서를 전진시킵니다.
 *
 * 더 최신 요청이 시작됐더라도 아직 성공하지 않았다면 이전 요청의 성공 응답을
 * 적용할 수 있어야 합니다. 반대로 더 최신 성공 응답이 이미 적용된 뒤 도착한
 * 이전 응답은 화면을 되돌리지 않도록 null을 반환합니다.
 */
export const getSuccessfulRequestApplyVersion = (
  requestId: number,
  lastAppliedRequestId: number
): number | null => requestId >= lastAppliedRequestId ? requestId : null;

export const normalizeArenaCosmeticActive = (value: unknown): boolean => (
  value === true
  || value === 1
  || value === '1'
  || (typeof value === 'string' && ['true', 't'].includes(value.trim().toLowerCase()))
);

export const isArenaCosmeticActive = (item: ArenaCosmeticActivation): boolean => item.active;

export const getArenaCosmeticStatusLabel = (item: ArenaCosmeticActivation): '판매 중' | '비활성' => (
  isArenaCosmeticActive(item) ? '판매 중' : '비활성'
);

export const getArenaCosmeticToggleLabel = (item: ArenaCosmeticActivation): '판매 중지' | '판매 시작' => (
  isArenaCosmeticActive(item) ? '판매 중지' : '판매 시작'
);
