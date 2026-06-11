/**
 * search.ts - 백엔드 공용 유사도(초성/띄어쓰기 무시) 검색 유틸리티
 * 프론트엔드 frontend/src/lib/search.ts 의 fuzzySearch 와 동작을 맞춥니다.
 */

const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

/** 한글 음절을 초성 문자열로 변환합니다. (음절이 아닌 문자는 그대로 유지) */
export function getChosung(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 0xac00;
    if (code >= 0 && code <= 11171) {
      result += CHOSUNG[Math.floor(code / 588)];
    } else {
      result += str.charAt(i);
    }
  }
  return result;
}

/** 검색 비교용 문자열을 정규화합니다. */
export function normalizeSearchText(value: string): string {
  return (value || '').replace(/\s+/g, '').toLowerCase();
}

/** 띄어쓰기/대소문자를 무시한 완전 일치 여부를 반환합니다. */
export function isExactSearchMatch(target: string, query: string): boolean {
  const cleanTarget = normalizeSearchText(target);
  const cleanQuery = normalizeSearchText(query);
  return !!cleanTarget && !!cleanQuery && cleanTarget === cleanQuery;
}

/** 띄어쓰기/대소문자 무시 + 초성 매칭으로 유사도 일치 여부를 반환합니다. */
export function fuzzyMatch(target: string, query: string): boolean {
  return fuzzyScore(target, query) !== null;
}

/**
 * 유사도 점수를 반환합니다. 낮을수록 더 좋은 일치이며, 일치하지 않으면 null.
 * - 완전 일치: 가장 우선(-100)
 * - 부분 문자열 일치: 일치 시작 위치(앞쪽일수록 우선)
 * - 초성 일치: 부분 문자열 일치보다 항상 후순위(+1000 오프셋)
 * 정렬에 활용해 완전 일치와 정확한 부분일치를 초성 일치보다 우선 노출합니다.
 */
export function fuzzyScore(target: string, query: string): number | null {
  const cleanTarget = normalizeSearchText(target);
  const cleanQuery = normalizeSearchText(query);
  if (!cleanQuery) return 0;
  if (!cleanTarget) return null;
  if (cleanTarget === cleanQuery) return -100;

  const directIdx = cleanTarget.indexOf(cleanQuery);
  if (directIdx !== -1) return directIdx;

  const chosungIdx = getChosung(cleanTarget).indexOf(getChosung(cleanQuery));
  if (chosungIdx !== -1) return 1000 + chosungIdx;

  return null;
}
