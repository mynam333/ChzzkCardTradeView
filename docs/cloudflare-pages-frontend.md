# Cloudflare Pages Frontend Operation

프론트엔드는 Cloudflare Pages에서 운영하고, 기존 Vercel 배포는 dev 미리보기 도메인으로 유지한다.

## 도메인 구조

```text
chikapo.yuaru.com      -> Cloudflare Pages production
dev.chikapo.yuaru.com  -> Vercel dev/preview
api.yuaru.com          -> VPS backend API
```

프론트는 항상 백엔드 직통 API를 사용한다.

```env
NEXT_PUBLIC_API_URL=https://api.yuaru.com/api
```

## Cloudflare Pages 설정

2026-11-18 기준 Pages 프로젝트는 Git 연결 없이 GitHub Actions의 Wrangler 업로드로 배포한다. 현재 설정은 `.github/workflows/deploy-frontend.yml`을 따른다.

```text
Project name: chikapo
Production branch: main
Build command: pnpm --filter frontend build
Upload directory: frontend/out
Deployment: wrangler pages deploy frontend/out --project-name chikapo --branch main
```

환경 변수:

```env
DEPLOY_TARGET=cloudflare-pages
NEXT_PUBLIC_API_URL=https://api.yuaru.com/api
NEXT_PUBLIC_SITE_URL=https://chikapo.yuaru.com
NODE_VERSION=22
```

pnpm 버전 문제가 있으면 추가한다.

```env
PNPM_VERSION=10
```

## Branch Controls

운영 자동 배포는 GitHub Actions의 `main` push와 경로 필터로 제어한다. 수동 배포는 같은 워크플로의 `workflow_dispatch`를 사용한다. Pages 대시보드의 Git 빌드 설정으로 제어하는 구조가 아니다.

## Vercel Dev 도메인

기존 Vercel 프로젝트에는 다음 도메인을 연결한다.

```text
dev.chikapo.yuaru.com
```

Vercel 환경 변수:

```env
NEXT_PUBLIC_API_URL=https://api.yuaru.com/api
NEXT_PUBLIC_SITE_URL=https://dev.chikapo.yuaru.com
```

## Backend Origin 허용

운영 서버 `backend/.env`에 운영/개발 프론트 도메인을 모두 허용한다.

```env
CORS_ALLOWED_ORIGINS=https://chikapo.yuaru.com,https://dev.chikapo.yuaru.com
PUSH_ALLOWED_ORIGINS=https://chikapo.yuaru.com,https://dev.chikapo.yuaru.com
BACKEND_PUBLIC_URL=https://api.yuaru.com
```

적용:

```bash
pm2 reload ecosystem.config.cjs --update-env
```

치지직 OAuth 콘솔에는 두 callback을 모두 등록한다.

```text
https://chikapo.yuaru.com/auth/chzzk/callback
https://dev.chikapo.yuaru.com/auth/chzzk/callback
```

## Static Export Notes

Cloudflare Pages 빌드는 `DEPLOY_TARGET=cloudflare-pages`일 때 `next.config.ts`에서 `output: 'export'`를 사용한다.

정적 export에서는 Next API routes를 사용할 수 없다. 프론트 API route는 백엔드 API로 옮기거나 정적 파일로 대체한다.

현재 점검 페이지의 공사중 이미지는 `frontend/public/construction`의 정적 파일 목록을 클라이언트에서 선택한다.

## Retired URLs

2026-11-18 아레나 소스·정적 자산·백엔드 API를 제거했다. Pages 기본 주소에서는 404였지만 사용자 도메인의 정확한 `/arena` 주소에서 이전 HTML이 반환되었다. URL 3개 및 `chikapo.yuaru.com` 호스트 캐시 제거 요청은 성공했으나 이전 응답이 남아, 폐기된 주소를 Cloudflare 단일 리디렉션으로 처리한다. 캐시의 정확한 내부 계층은 확인되지 않았다.

- 규칙: `치카포 종료된 아레나 404 이동`
- 규칙 ID: `bd7f1f8f0e374c87bc9fe03ae7e6cf40`
- 위치: `yuaru.com` → 규칙 → 리디렉션 규칙, 기존 HTTPS·cctv 규칙 뒤
- 응답: `301` → `https://chikapo.yuaru.com/not-found` → 최종 `404`, 쿼리 문자열 유지 안 함
- 조건:

```text
(http.host eq "chikapo.yuaru.com" and (http.request.uri.path eq "/arena" or http.request.uri.path eq "/arena.html" or starts_with(http.request.uri.path, "/arena/")))
```

이는 폐기된 주소의 404 이동 규칙이며 게임 실행 코드는 포함하지 않는다. `/arenax`, API 호스트 및 다른 사이트에는 적용되지 않는다. 아레나 API는 계속 404를 반환한다. `/404`는 정적 파일로 제공되어 HTTP 200이므로, 실제 HTTP 404를 반환하는 `/not-found`를 대상으로 사용한다.

캐시 제거 워크플로 `.github/workflows/purge-frontend-cache.yml`은 수동 실행 전용이다. 현재 배포 토큰에는 zone 캐시 삭제 권한이 없어 실패한다. Pages 업로드 성공 또는 캐시 삭제 접수만으로 완료를 판정하지 말고, 실제 사용자 도메인의 상태 코드·Location·최종 응답을 확인한다.
