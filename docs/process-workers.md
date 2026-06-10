# Single Server Multi-Process Operation

한 대의 Ubuntu 서버에서 API, 라이브/채팅 수집, 예약 작업, 백업, 이미지 프록시를 프로세스 단위로 분리해 운영한다.

## 프로세스 역할

- `api`: Express API 서버. 일반 API/SSE/업로드만 처리한다.
- `live-worker`: 치지직 라이브 상태 폴링과 채팅 WebSocket 수집을 처리한다.
- `scheduler-worker`: 예약 푸시와 만료 경매 정산을 처리한다.
- `backup-worker`: MySQL 데이터를 SQLite로 백업한다.
- `image-worker`: `/api/image-proxy` 이미지 fetch/resize/cache만 처리한다.
- `all`: 기존처럼 한 프로세스에서 모든 작업을 실행한다. 운영에서는 권장하지 않는다.

## dotenv 로딩 규칙

모든 프로세스는 먼저 `backend/.env`를 읽는다.
그 다음 `backend/.env.<PROCESS_ROLE>` 파일이 있으면 추가로 읽고 같은 키를 override한다.

예:

```text
backend/.env
backend/.env.api
backend/.env.live-worker
backend/.env.scheduler-worker
backend/.env.backup-worker
backend/.env.image-worker
```

저장소에는 같은 형식의 예시 파일이 포함되어 있다.

```text
backend/.env.example
backend/.env.api.example
backend/.env.live-worker.example
backend/.env.scheduler-worker.example
backend/.env.backup-worker.example
backend/.env.image-worker.example
```

운영 서버에서는 필요한 예시 파일을 복사해 `.example`을 제거하고 비밀값을 채운다.

## backend/.env 공통 예시

```env
DB_MODE=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=chikapo
MYSQL_PASSWORD=change_me
MYSQL_DATABASE=chzzk_card_trade_view

USE_HTTPS=true
PORT=2083
CLOUDFLARE_ORIGIN_KEY_PATH=backend/yuaru.com/yuaru.com.key
CLOUDFLARE_ORIGIN_CERT_PATH=backend/yuaru.com/yuaru.com.pem

BACKEND_PUBLIC_URL=https://chikapo.yuaru.com
CORS_ALLOWED_ORIGINS=https://chikapo.yuaru.com

MYSQL_LOCK_WAIT_TIMEOUT_SECONDS=5
MYSQL_TRANSACTION_MAX_ATTEMPTS=3

MYSQL_SQLITE_BACKUP_ENABLED=true
MYSQL_SQLITE_BACKUP_DIR=./backups/mysql-sqlite
MYSQL_SQLITE_BACKUP_RETENTION_DAYS=7
```

## 역할별 dotenv 예시

`backend/.env.api`

```env
MYSQL_CONNECTION_LIMIT=10
API_SERVE_IMAGE_PROXY=false
RUN_PUSH_SCHEDULER=false
RUN_MARKET_SCHEDULER=false
```

`backend/.env.live-worker`

```env
MYSQL_CONNECTION_LIMIT=3
CHAT_COUNT_FLUSH_INTERVAL_MS=10000
MYSQL_CHAT_FLUSH_CHUNK_SIZE=50
```

`backend/.env.scheduler-worker`

```env
MYSQL_CONNECTION_LIMIT=2
RUN_PUSH_SCHEDULER=true
RUN_MARKET_SCHEDULER=true
```

`backend/.env.backup-worker`

```env
MYSQL_CONNECTION_LIMIT=1
MYSQL_SQLITE_BACKUP_BATCH_SIZE=500
MYSQL_SQLITE_BACKUP_MAX_CHAT_CONNECTIONS=10
MYSQL_SQLITE_BACKUP_MAX_DESIRED_CHAT_CONNECTIONS=10
MYSQL_SQLITE_BACKUP_MAX_REALTIME_CLIENTS=20
MYSQL_SQLITE_BACKUP_MAX_NOTIFICATION_CLIENTS=20
```

`backend/.env.image-worker`

```env
IMAGE_WORKER_PORT=2087
IMAGE_PROXY_TIMEOUT_MS=3000
IMAGE_PROXY_MAX_CACHE_BYTES=134217728
```

## PM2 실행

```bash
npm run build:backend
pm2 start ecosystem.config.cjs
pm2 save
```

상태 확인:

```bash
pm2 status
pm2 logs chikapo-api
pm2 logs chikapo-live-worker
pm2 logs chikapo-backup-worker
```

## Nginx 라우팅 예시

API는 `2083`, 이미지 프록시는 `2087`로 분리한다.

```nginx
location /api/image-proxy {
    proxy_pass http://127.0.0.1:2087;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    proxy_pass https://127.0.0.1:2083;
    proxy_ssl_verify off;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Cloudflare Origin Certificate를 API 서버에서 직접 쓰는 경우 `2083`은 HTTPS다. 이미지 worker는 내부 전용 HTTP 포트로 두고 Nginx가 앞단에서 TLS를 처리하는 구성을 권장한다.

## 주의

- `api` 프로세스에서는 기본적으로 라이브 스케줄러, 백업 스케줄러, 푸시/마켓 스케줄러가 돌지 않는다.
- `API_SERVE_IMAGE_PROXY=false`일 때 `/api/image-proxy`는 API 서버에서 503을 반환한다. 반드시 Nginx/프록시에서 image-worker로 라우팅해야 한다.
- `all` 역할은 문제 발생 시 원인 분리가 어려우므로 운영에서는 쓰지 않는다.
