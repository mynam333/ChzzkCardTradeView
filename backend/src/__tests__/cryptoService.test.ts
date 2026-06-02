import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../services/cryptoService';

describe('cryptoService', () => {
  it('암호화 후 복호화하면 원문이 복원된다 (라운드트립)', () => {
    const plain = 'chzzk_access_token_example_12345';
    const enc = encryptToken(plain);
    expect(enc).not.toBe(plain);          // 암호문은 원문과 달라야 함
    expect(enc!.startsWith('v1:')).toBe(true);
    expect(decryptToken(enc)).toBe(plain);
  });

  it('매 호출마다 다른 IV로 암호문이 달라진다', () => {
    const plain = 'same-token';
    const a = encryptToken(plain);
    const b = encryptToken(plain);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(plain);
    expect(decryptToken(b)).toBe(plain);
  });

  it('null/빈 문자열은 그대로 통과시킨다', () => {
    expect(encryptToken(null)).toBeNull();
    expect(encryptToken(undefined)).toBeNull();
    expect(encryptToken('')).toBe('');
    expect(decryptToken(null)).toBeNull();
  });

  it('암호화 포맷이 아닌 레거시 평문은 그대로 반환한다 (하위호환)', () => {
    const legacy = 'plain_legacy_token_without_encryption';
    expect(decryptToken(legacy)).toBe(legacy);
  });

  it('한글/유니코드 토큰도 정상 복원된다', () => {
    const plain = '토큰-値-🔐';
    expect(decryptToken(encryptToken(plain))).toBe(plain);
  });
});
