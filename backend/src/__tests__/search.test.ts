import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyScore, getChosung } from '../utils/search';

describe('getChosung', () => {
  it('한글 음절을 초성으로 변환한다', () => {
    expect(getChosung('치카포')).toBe('ㅊㅋㅍ');
    expect(getChosung('스트리머')).toBe('ㅅㅌㄹㅁ');
  });

  it('한글이 아닌 문자는 그대로 둔다', () => {
    expect(getChosung('abc123')).toBe('abc123');
    expect(getChosung('치카 abc')).toBe('ㅊㅋ abc');
  });
});

describe('fuzzyMatch', () => {
  it('띄어쓰기/대소문자를 무시한 부분일치를 허용한다', () => {
    expect(fuzzyMatch('치카포 컬렉터', '치카포컬렉터')).toBe(true);
    expect(fuzzyMatch('ChzzkCard', 'chzzk card')).toBe(true);
  });

  it('초성 검색을 지원한다', () => {
    expect(fuzzyMatch('치카포', 'ㅊㅋㅍ')).toBe(true);
    expect(fuzzyMatch('스트리머', 'ㅅㅌ')).toBe(true);
  });

  it('일치하지 않으면 false', () => {
    expect(fuzzyMatch('치카포', 'ㄱㄴㄷ')).toBe(false);
    expect(fuzzyMatch('hello', 'world')).toBe(false);
  });

  it('빈 검색어는 모두 일치로 본다', () => {
    expect(fuzzyMatch('치카포', '')).toBe(true);
    expect(fuzzyMatch('치카포', '   ')).toBe(true);
  });
});

describe('fuzzyScore', () => {
  it('부분일치를 초성 일치보다 우선(작은 점수)한다', () => {
    const direct = fuzzyScore('치카포', '카포'); // 부분일치
    const chosung = fuzzyScore('치카포', 'ㅊㅋㅍ'); // 초성 일치
    expect(direct).not.toBeNull();
    expect(chosung).not.toBeNull();
    expect(direct as number).toBeLessThan(chosung as number);
  });

  it('일치하지 않으면 null', () => {
    expect(fuzzyScore('치카포', 'xyz')).toBeNull();
  });
});
