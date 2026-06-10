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

Pages 프로젝트를 GitHub 저장소와 연결한다.

```text
Project name: chzzk-card-trade-view-frontend
Production branch: main
Root directory: /
Build command: pnpm run build:frontend
Build output directory: frontend/out
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

빌드 횟수를 줄이기 위해 main만 자동 배포한다.

```text
Production branch: main
Enable automatic production branch deployments: ON
```

초기 안정화 기간에는 preview build를 끈다.

```text
Preview deployments: None
```

dev 브랜치 미리보기가 필요하면 다음처럼 제한한다.

```text
Preview deployments: Custom branches
Include preview branches: dev
Exclude preview branches: 비움
```

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
