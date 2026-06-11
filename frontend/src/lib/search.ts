/**
 * 한글 초성 리스트
 */
const CHOSUNG_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

/** 한글 음절을 초성 문자열로 변환합니다. (음절이 아닌 문자는 그대로 유지) */
export function getChosung(str: string): string {
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i) - 0xac00;
    if (code >= 0 && code <= 11171) {
      result += CHOSUNG_LIST[Math.floor(code / 588)];
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

/**
 * 유사도 점수를 반환합니다. 낮을수록 더 좋은 일치이며, 일치하지 않으면 null.
 * 백엔드 backend/src/utils/search.ts 의 fuzzyScore 와 같은 기준입니다.
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

/**
 * 한글 문자 1개에서 초성을 추출합니다.
 */
function isChosung(char: string): boolean {
  return CHOSUNG_LIST.includes(char);
}

/**
 * 검색 대상 문자열(target)과 검색어(query)를 비교하여 
 * 띄어쓰기 무시, 대소문자 무시, 한글 초성 매칭을 포함하는 퍼지(유사도) 매칭 여부를 판단합니다.
 */
export function fuzzySearch(target: string, query: string): boolean {
  const cleanQuery = query.replace(/\s+/g, '').toLowerCase();
  if (!cleanQuery) return true;
  if (fuzzyScore(target, query) !== null) return true;

  // 2글자 이상 입력된 경우에는 기존 순차 정규식 매칭도 유지합니다.
  // 예: 중간 글자를 건너뛰어 입력한 검색어도 자연스럽게 좁혀집니다.
  let regexString = '';
  for (let i = 0; i < cleanQuery.length; i++) {
    const char = cleanQuery[i];
    if (isChosung(char)) {
      const chosungIndex = CHOSUNG_LIST.indexOf(char);
      const startCode = 44032 + chosungIndex * 588;
      const endCode = startCode + 587;
      regexString += `(${char}|[\\u${startCode.toString(16)}-\\u${endCode.toString(16)}])`;
    } else {
      regexString += char.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
  }
  try {
    const regex = new RegExp(regexString);
    return regex.test((target || '').replace(/\s+/g, '').toLowerCase());
  } catch {
    return false;
  }
}
