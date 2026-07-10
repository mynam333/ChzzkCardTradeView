import { describe, expect, it } from 'vitest';
import { isSiteInsightsStorageSupported } from '../services/siteInsightsService';

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
