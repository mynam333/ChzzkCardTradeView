# Single Server Multi-Process Operation

한 대의 Ubuntu 서버에서 API, 라이브/채팅 수집, 예약 작업, 백업, 이미지 프록시를 프로세스 단위로 분리해 운영한다.

## 프로세스 역할

- `api`: Express API 서버. 일반 API/SSE/업로드만 처리한다.
- `live-worker`: 치지직 라이브 상태 폴링과 채팅 WebSocket 수집을 처리한다.
- `scheduler-worker`: 예약 푸시와 만료 경매 정산을 처리한다.
- `backup-worker`: MySQL 데이터를 SQLite로 백업한다.
- `image-worker`: `/api/image-proxy` 이미지 fetch/resize/cache만 처리한다.
- `arena-worker`: 아레나 관리자 작업, 큐 만료/복구, 스냅샷 재생성처럼 API 응답 경로에서 분리해야 하는 저빈도 작업만 처리한다.
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
backend/.env.arena-worker
```

저장소에는 같은 형식의 예시 파일이 포함되어 있다.

```text
backend/.env.example
backend/.env.api.example
backend/.env.live-worker.example
backend/.env.scheduler-worker.example
backend/.env.backup-worker.example
backend/.env.image-worker.example
backend/.env.arena-worker.example
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
POSTGRES_SQLITE_BACKUP_ENABLED=false
MYSQL_SQLITE_BACKUP_INCLUDE_VALUE_HISTORY=false
MYSQL_SQLITE_BACKUP_DIR=./backups/mysql-sqlite
MYSQL_SQLITE_BACKUP_RETENTION_DAYS=7

BACKEND_FILE_LOGGING=true
LOG_DIR=./backend/logs
LOG_RETENTION_DAYS=14
LOG_FILE_PREFIX=backend
LOG_SPLIT_BY_PROCESS=true
LOG_PRUNE_INTERVAL_MS=21600000
```

## 역할별 dotenv 예시

`backend/.env.api`

```env
MYSQL_CONNECTION_LIMIT=20
POSTGRES_CONNECTION_LIMIT=3
API_SERVE_IMAGE_PROXY=false
RUN_PUSH_SCHEDULER=false
RUN_MARKET_SCHEDULER=false
API_BODY_SIZE_LIMIT=50mb
GLOBAL_API_RATE_LIMIT_MAX=600
DRAW_RATE_LIMIT_MAX=180
SEARCH_RATE_LIMIT_MAX=180
TRADE_RATE_LIMIT_MAX=180
COUPON_RATE_LIMIT_MAX=60
AUTH_RATE_LIMIT_MAX=60
REGISTER_RATE_LIMIT_MAX=60
REPORT_RATE_LIMIT_MAX=60
CHAT_IMAGE_RATE_LIMIT_MAX=60
STREAMER_READ_RATE_LIMIT_MAX=240
VALUE_AGO_CACHE_TTL_MS=300000
STREAMER_RANKING_CHANGE_HISTORY_ENABLED=true
STREAMERS_INCLUDE_VALUE_1H_HISTORY=true
STREAMER_RANKING_TITLES_CACHE_TTL_MS=300000
STREAMER_DETAIL_CACHE_TTL_MS=30000
STREAMER_DETAIL_STALE_TTL_MS=300000
USER_RANKING_ALLOW_LIVE_FALLBACK=false
USER_RANKING_SNAPSHOT_REFRESH_IN_API=false
STREAMER_IMAGE_MAX_UPLOAD_BYTES=20mb
CHAT_IMAGE_MAX_UPLOAD_BYTES=25mb
CHAT_GIF_MAX_UPLOAD_BYTES=25mb
```

`backend/.env.live-worker`

```env
MYSQL_CONNECTION_LIMIT=3
POSTGRES_CONNECTION_LIMIT=2
CHAT_COUNT_FLUSH_INTERVAL_MS=10000
MYSQL_CHAT_FLUSH_CHUNK_SIZE=50
OFFLINE_POLL_SHARDS=10
OFFLINE_COMPUTE_EVERY_CYCLES=10
VALUE_HISTORY_RECORD_EVERY_CYCLES=10
```

`backend/.env.scheduler-worker`

```env
MYSQL_CONNECTION_LIMIT=2
POSTGRES_CONNECTION_LIMIT=1
RUN_PUSH_SCHEDULER=true
RUN_MARKET_SCHEDULER=true
USER_RANKING_SNAPSHOT_SCHEDULER_ENABLED=true
USER_RANKING_SNAPSHOT_INITIAL_DELAY_MS=30000
USER_RANKING_SNAPSHOT_TTL_MS=900000
USER_RANKING_SNAPSHOT_MIN_REFRESH_INTERVAL_MS=600000
USER_RANKING_SNAPSHOT_SCHEDULER_INTERVAL_MS=900000
USER_RANKING_SNAPSHOT_STATEMENT_TIMEOUT_MS=45000
USER_RANKING_SNAPSHOT_PRESENCE_CACHE_TTL_MS=10000
```

`backend/.env.backup-worker`

```env
MYSQL_CONNECTION_LIMIT=1
POSTGRES_SQLITE_BACKUP_ENABLED=false
MYSQL_SQLITE_BACKUP_INCLUDE_VALUE_HISTORY=false
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

`backend/.env.arena-worker`

```env
MYSQL_CONNECTION_LIMIT=1
ARENA_WORKER_JOB_POLL_INTERVAL_MS=10000
ARENA_WORKER_AUTO_QUEUE_RECOVERY=true
ARENA_WORKER_QUEUE_RECOVERY_INTERVAL_MS=60000
ARENA_WORKER_STALE_JOB_RESET_INTERVAL_MS=300000
ARENA_WORKER_STALE_JOB_MINUTES=30
```

아레나는 별도 API 서버로 분리하지 않는다. 일반 요청, 빠른대전 참가, 봇 연습 생성은 기존 API에서 처리하고, 오래 걸릴 수 있는 관리자 스냅샷 재생성, 랭킹 스냅샷 재생성, 리플레이 정리, 중단된 큐 복구만 `arena-worker`가 순차 처리한다. 이렇게 해야 6GB RAM 서버에서 프로세스 수 증가로 인한 메모리/DB 커넥션 비용을 최소화하면서도 API 응답 지연을 줄일 수 있다.

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
pm2 logs chikapo-arena-worker
```

## 파일 로그

`BACKEND_FILE_LOGGING=true`이면 각 프로세스의 console 로그가 `LOG_DIR` 아래에 날짜별 파일로 저장된다.

기본 파일명:

```text
backend-api-2026-06-10.log
backend-live-worker-2026-06-10.log
backend-scheduler-worker-2026-06-10.log
backend-backup-worker-2026-06-10.log
backend-image-worker-2026-06-10.log
backend-arena-worker-2026-06-10.log
```

`LOG_RETENTION_DAYS`보다 오래된 `backend-*.log` 파일은 프로세스 시작 시와 `LOG_PRUNE_INTERVAL_MS` 간격마다 자동 삭제된다.

실시간 확인:

```bash
tail -f backend/logs/backend-api-$(date +%F).log
tail -f backend/logs/backend-live-worker-$(date +%F).log
tail -f backend/logs/backend-image-worker-$(date +%F).log
tail -f backend/logs/backend-arena-worker-$(date +%F).log
```

PM2 자체 로그는 `~/.pm2/logs`에도 남을 수 있다. PM2 로그까지 장기 보관할 필요가 있으면 `pm2-logrotate`를 같이 설정한다.

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:compress true
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
