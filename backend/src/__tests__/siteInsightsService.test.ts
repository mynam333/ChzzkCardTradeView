import { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/authSessionService', () => ({
  getRequestSessionToken: vi.fn(),
  verifyAuthSessionToken: vi.fn()
}));

import { getRequestSessionToken, verifyAuthSessionToken } from '../services/authSessionService';
import { isSiteInsightsStorageSupported, resolveSiteInsightsUserId } from '../services/siteInsightsService';

const getSessionToken = vi.mocked(getRequestSessionToken);
const verifySessionToken = vi.mocked(verifyAuthSessionToken);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('siteInsightsService storage support', () => {
  it('PostgreSQL을 사용하는 MYSQL 저장소 모드에서도 인사이트를 활성화한다', () => {
    expect(isSiteInsightsStorageSupported('MYSQL', 'postgres')).toBe(true);
  });

  it('MySQL과 로컬 SQLite 저장소를 지원한다', () => {
    expect(isSiteInsightsStorageSupported('MYSQL', 'mysql')).toBe(true);
    expect(isSiteInsightsStorageSupported('LOCAL_SQL', null)).toBe(true);
  });

  it('별도 구현이 없는 Supabase 모드는 비활성화한다', () => {
    expect(isSiteInsightsStorageSupported('SUPABASE', null)).toBe(false);
  });
});

describe('siteInsightsService session identity', () => {
  it('uses an active server-side auth session identity', async () => {
    const request = {} as Request;
    getSessionToken.mockReturnValue('active-token');
    verifySessionToken.mockResolvedValue({ id: 'user-1', role: 'USER', jti: 'session-1' } as never);

    await expect(resolveSiteInsightsUserId(request)).resolves.toBe('user-1');
    expect(verifySessionToken).toHaveBeenCalledWith('active-token');
  });

  it('treats a revoked or legacy token as anonymous', async () => {
    const request = {} as Request;
    getSessionToken.mockReturnValue('revoked-token');
    verifySessionToken.mockRejectedValue(new Error('InvalidAuthSession'));

    await expect(resolveSiteInsightsUserId(request)).resolves.toBeNull();
  });
});
