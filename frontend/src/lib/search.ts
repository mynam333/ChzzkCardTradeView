/**
 * 한글 초성 리스트
 */
const CHOSUNG_LIST = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

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
  // 1. 공백 제거 및 소문자화 (띄어쓰기 무시)
  const cleanTarget = target.replace(/\s+/g, '').toLowerCase();
  const cleanQuery = query.replace(/\s+/g, '').toLowerCase();

  if (!cleanQuery) return true;
  if (!cleanTarget) return false;

  // 2. 검색어가 대상 문자열에 그대로 포함되어 있는지 1차 확인 (띄어쓰기 무시 매칭)
  if (cleanTarget.includes(cleanQuery)) return true;

  // 3. 초성 검색 또는 한글 유사 매칭을 위한 정규식 생성
  let regexString = '';
  
  for (let i = 0; i < cleanQuery.length; i++) {
    const char = cleanQuery[i];
    
    if (isChosung(char)) {
      // 해당 초성이 매칭될 수 있는 유니코드 한글 음절 범위 정의 (가 ~ 힣)
      const chosungIndex = CHOSUNG_LIST.indexOf(char);
      const startCode = 44032 + chosungIndex * 588;
      const endCode = startCode + 587;
      
      // 초성 자체('ㄱ') 또는 해당 초성으로 결합된 문자('가'~'갛') 매칭
      regexString += `(${char}|[\\u${startCode.toString(16)}-\\u${endCode.toString(16)}])`;
    } else {
      // 일반 문자(영어, 특수문자 등)는 이스케이프 처리하여 추가
      regexString += char.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
  }

  try {
    const regex = new RegExp(regexString);
    return regex.test(cleanTarget);
  } catch {
    return false;
  }
}
