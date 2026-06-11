/**
 * 한글 초성 리스트
 */
import Fuse from 'fuse.js';

const CHOSUNG_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];
const JAMO_CHOSUNG_LIST = [
  'ᄀ', 'ᄁ', 'ᄂ', 'ᄃ', 'ᄄ', 'ᄅ', 'ᄆ', 'ᄇ', 'ᄈ', 'ᄉ', 'ᄊ', 'ᄋ', 'ᄌ', 'ᄍ', 'ᄎ', 'ᄏ', 'ᄐ', 'ᄑ', 'ᄒ'
];
const JAMO_TO_COMPAT_CHOSUNG = new Map(JAMO_CHOSUNG_LIST.map((char, index) => [char, CHOSUNG_LIST[index]]));

const NOISE_PATTERN = /[\s\p{P}\p{S}\u200B-\u200D\uFEFF\u2060]+/gu;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/g;

/** 한글 음절을 초성 문자열로 변환합니다. (음절이 아닌 문자는 그대로 유지) */
export function getChosung(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 0xac00;
    if (code >= 0 && code <= 11171) {
      result += CHOSUNG_LIST[Math.floor(code / 588)];
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

const scoreWithFuse = (target: string, targetChosung: string, query: string): number | null => {
  if (query.length < 2) return null;
  const fuse = new Fuse(
    [{ normalized: target, chosung: targetChosung }],
    {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.35,
      minMatchCharLength: Math.min(2, query.length),
      keys: [
        { name: 'normalized', weight: 0.85 },
        { name: 'chosung', weight: 0.15 }
      ]
    }
  );
  const result = fuse.search(query)[0];
  if (!result || result.score === undefined) return null;
  return 3000 + Math.round(result.score * 2000);
};

/**
 * 유사도 점수를 반환합니다. 낮을수록 더 좋은 일치이며, 일치하지 않으면 null.
 * 백엔드 backend/src/utils/search.ts 의 fuzzyScore 와 같은 기준입니다.
 */
export function fuzzyScore(target: string, query: string): number | null {
  const cleanTarget = normalizeSearchText(target);
  const cleanQuery = normalizeSearchText(query);
  if (!cleanQuery) return 0;
  if (!cleanTarget) return null;

  const directScore = scoreContains(cleanTarget, cleanQuery, -10000, -8000, -6000);
  if (directScore !== null) return directScore;

  const targetChosung = getChosung(cleanTarget);
  const queryChosung = getChosung(cleanQuery);
  const chosungScore = scoreContains(targetChosung, queryChosung, 1000, 1200, 1600);
  if (chosungScore !== null) return chosungScore;

  const fuseScore = scoreWithFuse(cleanTarget, targetChosung, cleanQuery);
  if (fuseScore !== null) return fuseScore;

  return null;
}

/**
 * 검색 대상 문자열(target)과 검색어(query)를 비교하여 
 * 띄어쓰기 무시, 대소문자 무시, 한글 초성 매칭을 포함하는 퍼지(유사도) 매칭 여부를 판단합니다.
 */
export function fuzzySearch(target: string, query: string): boolean {
  return fuzzyScore(target, query) !== null;
}
