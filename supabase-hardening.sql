-- ============================================================
-- Chikapo Supabase hardening
--
-- 목적:
-- - 브라우저/외부 클라이언트가 Supabase Data API(anon/authenticated role)로
--   public schema의 테이블/RPC에 직접 접근하지 못하게 차단합니다.
-- - 백엔드 서버만 service_role/secret key로 접근하도록 고정합니다.
--
-- 적용 위치:
-- - Supabase Dashboard > SQL Editor에서 실행
--
-- 주의:
-- - 프론트엔드가 Supabase JS 클라이언트로 직접 DB를 읽고 있다면 해당 기능은 막힙니다.
--   현재 서비스 구조는 백엔드 API를 통해 DB에 접근하므로 이 설정이 권장됩니다.
-- ============================================================

BEGIN;

-- public schema 자체 사용권은 유지하되, 객체 생성권은 제거합니다.
-- PostgREST가 schema를 확인하려면 USAGE는 필요할 수 있지만,
-- 객체별 권한을 모두 닫아 실제 데이터 접근은 차단합니다.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM anon;
REVOKE CREATE ON SCHEMA public FROM authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- 기존 테이블/시퀀스/RPC 직접 접근 차단.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- 백엔드 service_role만 명시 허용.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 앞으로 생성될 public 객체에도 동일한 기본 권한 적용.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- RLS를 모든 public 테이블에 켭니다.
-- service_role은 RLS를 우회할 수 있으므로 백엔드 동작은 유지되고,
-- anon/authenticated는 grant가 닫혀 있어 Data API 직접 접근이 막힙니다.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT schemaname, tablename
      FROM pg_tables
     WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
  END LOOP;
END $$;

-- PostgREST/Supabase API schema cache 갱신.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- 적용 확인용 조회:
-- SELECT grantee, table_schema, table_name, privilege_type
--   FROM information_schema.role_table_grants
--  WHERE table_schema = 'public'
--    AND grantee IN ('anon', 'authenticated', 'service_role')
--  ORDER BY table_name, grantee, privilege_type;
