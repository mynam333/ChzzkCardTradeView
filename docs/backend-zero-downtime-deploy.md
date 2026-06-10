# 백엔드 무중단 배포

이 프로젝트의 백엔드는 GitHub Actions에서 TypeScript 빌드를 수행하고, 운영 서버는 빌드 산출물(`backend/dist`)만 받아 PM2로 무중단 reload합니다.

## 운영 서버 사전 준비

운영 서버에는 기존 프로젝트 디렉터리가 있어야 합니다.

```bash
cd /home/ubuntu/ChzzkCardTradeView
```

필수 도구:

```bash
node -v
pnpm -v
pm2 -v
mysql --version
mysqldump --version
```

없으면 설치합니다.

```bash
corepack enable
corepack prepare pnpm@10 --activate
npm install -g pm2
```

운영 환경변수는 서버에만 둡니다.

```bash
backend/.env
backend/.env.api
backend/.env.live-worker
backend/.env.scheduler-worker
backend/.env.backup-worker
backend/.env.image-worker
```

GitHub Actions 아티팩트에는 `.env`가 포함되지 않습니다.

## GitHub Secrets

GitHub 저장소의 `Settings > Secrets and variables > Actions`에 아래 값을 추가합니다.

| 이름 | 설명 |
| --- | --- |
| `DEPLOY_HOST` | 운영 서버 IP 또는 도메인 |
| `DEPLOY_USER` | SSH 접속 사용자. 예: `ubuntu` |
| `DEPLOY_SSH_KEY` | 배포용 private key 전체 내용 |
| `DEPLOY_PORT` | SSH 포트. 기본값 22라면 생략 가능 |
| `DEPLOY_PATH` | 프로젝트 경로. 기본값 `/home/ubuntu/ChzzkCardTradeView`라면 생략 가능 |

배포용 public key는 운영 서버의 `~/.ssh/authorized_keys`에 등록합니다.

## 첫 배포 전 확인

PM2 설정은 API만 cluster 모드로 2개 인스턴스를 띄우고, 워커는 중복 실행을 막기 위해 단일 fork로 유지합니다.

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 status
```

헬스체크가 통과해야 합니다.

```bash
curl -k https://127.0.0.1:2083/health
```

HTTP로 운영 중이면:

```bash
curl http://127.0.0.1:5000/health
```

포트/프로토콜이 다르면 `backend/.env`에 맞춰 확인합니다. 필요하면 서버 환경변수에 `HEALTHCHECK_URL`을 지정할 수 있습니다.

## 배포 흐름

`.github/workflows/deploy-backend.yml`는 다음 순서로 실행됩니다.

1. GitHub runner에서 `pnpm install --frozen-lockfile`
2. GitHub runner에서 `pnpm --filter backend build`
3. `backend/dist`와 배포 메타 파일을 `backend-release-<sha>.tar.gz`로 압축
4. 운영 서버로 업로드
5. 운영 서버에서 `deploy.sh` 실행
6. 운영 서버에서 `backend/dist` 교체
7. MySQL 스키마 적용
8. `chikapo-api` 무중단 reload
9. 헬스체크 통과 후 워커 순차 reload

## 운영 서버 부하를 줄이는 이유

운영 서버는 더 이상 TypeScript 빌드를 하지 않습니다. 의존성이 바뀌지 않았다면 `pnpm install`도 건너뜁니다.

의존성이 바뀐 경우에만 운영 서버에서 production dependency 설치가 실행됩니다. 이 작업은 `nice`/`ionice`로 낮은 우선순위로 실행됩니다.

## 수동 배포

GitHub Actions가 만든 release archive를 서버에 올린 뒤 수동으로 실행할 수도 있습니다.

```bash
cd /home/ubuntu/ChzzkCardTradeView
./deploy.sh /home/ubuntu/ChzzkCardTradeView/backend-release-<sha>.tar.gz
```

## 긴급 롤백

직전 dist는 `backend/dist.prev`에 남습니다.

```bash
cd /home/ubuntu/ChzzkCardTradeView
rm -rf backend/dist.bad
mv backend/dist backend/dist.bad
mv backend/dist.prev backend/dist
pm2 startOrReload ecosystem.config.cjs --only chikapo-api --update-env
```

워커도 롤백해야 하면:

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
```
