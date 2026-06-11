import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCOUNT_INTERACTION_RESTRICTION_MS,
  getAccountInteractionRestrictedUntil,
  parseAccountInteractionRestrictionMs,
  parseDeletedAccountTime
} from '../services/accountInteractionRestriction';

describe('accountInteractionRestriction service', () => {
  it('환경 변수 제한 시간은 숫자 밀리초와 간단한 duration 표기를 모두 허용한다', () => {
    expect(parseAccountInteractionRestrictionMs(undefined)).toBe(DEFAULT_ACCOUNT_INTERACTION_RESTRICTION_MS);
    expect(parseAccountInteractionRestrictionMs('86400000')).toBe(86_400_000);
    expect(parseAccountInteractionRestrictionMs('24h')).toBe(86_400_000);
    expect(parseAccountInteractionRestrictionMs('1d')).toBe(86_400_000);
    expect(parseAccountInteractionRestrictionMs('60m')).toBe(3_600_000);
    expect(parseAccountInteractionRestrictionMs('bad-value')).toBe(DEFAULT_ACCOUNT_INTERACTION_RESTRICTION_MS);
  });

  it('timezone 없는 DB datetime 문자열은 UTC 기준으로 해석한다', () => {
    expect(parseDeletedAccountTime('2026-06-10 12:00:00')).toBe(Date.parse('2026-06-10T12:00:00Z'));
    expect(parseDeletedAccountTime('2026-06-10T12:00:00')).toBe(Date.parse('2026-06-10T12:00:00Z'));
  });

  it('잘못된 탈퇴 시간은 제한을 만들지 않는다', () => {
    expect(parseDeletedAccountTime('not-a-date')).toBeNull();
    expect(getAccountInteractionRestrictedUntil('not-a-date')).toBeNull();
  });
});
