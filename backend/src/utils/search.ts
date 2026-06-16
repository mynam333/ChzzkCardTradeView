/**
 * search.ts - 백엔드 공용 검색 유틸리티
 * 프론트엔드 frontend/src/lib/search.ts 의 fuzzySearch 와 동작을 맞춥니다.
 */
const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];
const JAMO_CHOSUNG = [
  'ᄀ', 'ᄁ', 'ᄂ', 'ᄃ', 'ᄄ', 'ᄅ', 'ᄆ', 'ᄇ', 'ᄈ', 'ᄉ', 'ᄊ', 'ᄋ', 'ᄌ', 'ᄍ', 'ᄎ', 'ᄏ', 'ᄐ', 'ᄑ', 'ᄒ'
];
const JAMO_TO_COMPAT_CHOSUNG = new Map(JAMO_CHOSUNG.map((char, index) => [char, CHOSUNG[index]]));

const NOISE_PATTERN = /[\s\p{P}\p{S}\u200B-\u200D\uFEFF\u2060]+/gu;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/g;
const COMPAT_CHOSUNG_PATTERN = /^[ㄱ-ㅎ]+$/;

/** 한글 음절을 초성 문자열로 변환합니다. (음절이 아닌 문자는 그대로 유지) */
export function getChosung(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 0xac00;
    if (code >= 0 && code <= 11171) {
      result += CHOSUNG[Math.floor(code / 588)];
    } else {
      const char = str.charAt(i);
      result += JAMO_TO_COMPAT_CHOSUNG.get(char) || char;
    }
  }
  return result;
}

/** 검색 비교용 문자열을 정규화합니다. */
export function normalizeSearchText(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .replace(CONTROL_PATTERN, '')
    .split('')
    .map((char) => JAMO_TO_COMPAT_CHOSUNG.get(char) || char)
    .join('')
    .toLocaleLowerCase('ko-KR')
    .replace(NOISE_PATTERN, '')
    .trim();
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

const scoreContains = (target: string, query: string, exactScore: number, prefixScore: number, containsScore: number): number | null => {
  if (!query) return 0;
  if (!target) return null;
  if (target === query) return exactScore;
  const lengthGap = Math.max(0, target.length - query.length);
  if (target.startsWith(query)) return prefixScore + lengthGap;
  const index = target.indexOf(query);
  if (index !== -1) return containsScore + index * 10 + lengthGap;
  return null;
};

const levenshteinDistance = (a: string, b: string, maxDistance: number): number => {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    prev = curr;
  }
  return prev[b.length] ?? maxDistance + 1;
};

const firstSearchUnit = (value: string) => value[0] || '';

const canCompareTypoWindow = (window: string, query: string) => {
  const a = firstSearchUnit(window);
  const b = firstSearchUnit(query);
  return !!a && !!b && (a === b || getChosung(a) === getChosung(b));
};

const scoreTypo = (target: string, query: string): number | null => {
  if (query.length < 3 || COMPAT_CHOSUNG_PATTERN.test(query)) return null;
  const maxDistance = query.length >= 6 ? 2 : 1;
  if (target.length < Math.max(1, query.length - maxDistance)) return null;

  let best: number | null = null;
  const minLen = Math.max(1, query.length - maxDistance);
  const maxLen = Math.min(target.length, query.length + maxDistance);

  for (let len = minLen; len <= maxLen; len += 1) {
    const window = target.slice(0, len);
    if (!canCompareTypoWindow(window, query)) continue;
    const distance = levenshteinDistance(window, query, maxDistance);
    if (distance <= maxDistance) {
      const score = 3000 + distance * 500 + Math.abs(window.length - query.length) * 100;
      best = best === null ? score : Math.min(best, score);
    }
  }

  return best;
};

/**
 * 유사도 점수를 반환합니다. 낮을수록 더 좋은 일치이며, 일치하지 않으면 null.
 * 점수 우선순위:
 * 1. 정규화 완전 일치
 * 2. 접두/부분 문자열 일치
 * 3. 사용자가 초성을 입력한 경우의 초성 완전/접두/부분 일치
 * 4. 짧은 편집거리 기반 오타 보정
 */
export function fuzzyScore(target: string, query: string): number | null {
  const cleanTarget = normalizeSearchText(target);
  const cleanQuery = normalizeSearchText(query);
  if (!cleanQuery) return 0;
  if (!cleanTarget) return null;

  const directScore = scoreContains(cleanTarget, cleanQuery, -10000, -8000, -6000);
  if (directScore !== null) return directScore;

  if (COMPAT_CHOSUNG_PATTERN.test(cleanQuery) && cleanQuery.length >= 2) {
    const targetChosung = getChosung(cleanTarget);
    const chosungScore = scoreContains(targetChosung, cleanQuery, 1000, 1200, 1600);
    if (chosungScore !== null) return chosungScore;
  }

  const typoScore = scoreTypo(cleanTarget, cleanQuery);
  if (typoScore !== null) return typoScore;

  return null;
}
