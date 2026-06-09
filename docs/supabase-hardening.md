# Supabase DB 접근 차단 가이드

이 서비스는 프론트엔드가 Supabase에 직접 접근하지 않고, 백엔드 API만 DB에 접근하는 구조로 운영해야 한다.

## 확인된 외부 접근 경로

1. 프론트엔드 `NEXT_PUBLIC_SUPABASE_*`
   - `NEXT_PUBLIC_` 환경변수는 브라우저 번들에 노출된다.
   - 프론트가 Supabase JS를 쓰지 않으므로 이 값은 제거한다.

2. Supabase Data API
   - Supabase URL과 publishable/anon key를 아는 외부 사용자는 PostgREST Data API를 직접 호출할 수 있다.
   - 테이블/RPC grant가 열려 있으면 백엔드 API를 우회할 수 있다.
   - `supabase-hardening.sql`로 `anon`, `authenticated`의 public schema 객체 권한을 제거한다.

3. Postgres 직접 접속
   - `DATABASE_URL` 또는 DB 비밀번호가 노출되면 Supabase Data API와 무관하게 직접 접속할 수 있다.
   - Supabase Dashboard의 Network Restrictions에서 백엔드 서버 고정 IP만 허용한다.

4. 서버 키 오설정
   - 백엔드 `SUPABASE_SERVICE_ROLE_KEY`에는 `sb_publishable_*` 또는 anon JWT를 넣으면 안 된다.
   - 서버 전용 `sb_secret_*` 또는 legacy `service_role` JWT만 사용한다.
   - 백엔드는 시작 시 publishable/anon key를 감지하면 Supabase 모드 진입을 거부한다.

## 적용 순서

1. Supabase Dashboard에서 API key를 rotate한다.
   - 이전에 프론트/로그/저장소에 노출된 publishable/anon key와 DB password는 폐기한다.
   - 백엔드 `.env`에는 서버 전용 key만 설정한다.

2. 운영 백엔드 `.env`를 확인한다.
   - `SUPABASE_URL`: Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: `sb_secret_*` 또는 legacy service_role JWT
   - `SUPABASE_REQUIRED=true`: 운영에서 Supabase 연결 실패 시 SQLite fallback 금지
   - `CORS_ALLOWED_ORIGINS`: 실제 프론트 도메인만 콤마로 등록

3. 프론트 `.env`에서 제거한다.
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

4. Supabase SQL Editor에서 실행한다.
   - `supabase-hardening.sql`

5. Supabase Dashboard에서 Network Restrictions를 적용한다.
   - 백엔드 서버의 고정 outbound IP만 허용한다.
   - 로컬 개발 IP가 필요하면 임시로만 추가하고 작업 후 제거한다.

6. 배포 후 확인한다.
   - 프론트 정상 로그인/조회/마켓/가챠 동작 확인
   - 외부에서 Supabase REST endpoint로 public table 조회 시 401/403 또는 권한 오류가 나는지 확인
   - `/api/health`는 접근 가능, 그 외 직접 API 호출은 `403 ForbiddenApiOrigin`인지 확인

## 운영상 주의

- `service_role` key는 RLS를 우회하므로 절대 프론트엔드, 모바일 앱, 공개 저장소, 클라이언트 로그에 넣지 않는다.
- 새로운 public table/function을 추가한 뒤에는 `supabase-hardening.sql`을 다시 실행해도 된다.
- 외부에서 헤더를 위조하는 공격까지 막으려면 Cloudflare/WAF 또는 nginx에서 프론트 도메인과 rate rule을 추가로 적용한다.
