import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyScore, getChosung, isExactSearchMatch, normalizeSearchText } from '../utils/search';

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
  it('완전 일치를 부분일치보다 우선한다', () => {
    const exact = fuzzyScore('치카포', '치카포');
    const prefix = fuzzyScore('치카포컬렉터', '치카포');
    expect(exact).toBe(-100);
    expect(prefix).toBe(0);
    expect(exact as number).toBeLessThan(prefix as number);
  });

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

describe('exact search helpers', () => {
  it('띄어쓰기와 대소문자를 무시하고 완전 일치를 판정한다', () => {
    expect(normalizeSearchText(' Chzzk Card ')).toBe('chzzkcard');
    expect(isExactSearchMatch('Chzzk Card', 'chzzkcard')).toBe(true);
    expect(isExactSearchMatch('치카포컬렉터', '치카포')).toBe(false);
  });
});
