# SQLite to MySQL Migration

현재 백엔드는 `DB_MODE=mysql`일 때 MySQL 리포지토리로 동작한다. 이 문서는 운영 SQLite 파일을 MySQL 8 스키마로 이전하고 런타임을 MySQL로 전환하는 절차다.

## 준비

1. MySQL 8 데이터베이스를 생성한다.

```sql
CREATE DATABASE chzzk_card_trade_view
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

2. `backend/.env`에 MySQL 접속 정보를 추가한다.

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=chikapo
MYSQL_PASSWORD=change_me
MYSQL_DATABASE=chzzk_card_trade_view
DB_MODE=mysql
```

또는 URL 하나로 지정할 수 있다.

```env
MYSQL_URL=mysql://chikapo:change_me@127.0.0.1:3306/chzzk_card_trade_view
```

TLS가 필요한 MySQL은 다음 중 하나를 추가한다.

```env
MYSQL_SSL=true
MYSQL_SSL_CA_PATH=/path/to/ca.pem
```

## 이전 실행

기본 입력 파일은 프로젝트 루트의 `local.sqlite`다. 다른 파일을 쓰려면 `SQLITE_DB_PATH`를 지정한다.

```bash
npm install
npm run migrate:sqlite-to-mysql -- --reset
```

동작:

- `init-db-mysql.sql`을 적용해 테이블과 인덱스를 만든다.
- `--reset`이 있으면 대상 MySQL 테이블을 드롭하고 `init-db-mysql.sql`로 utf8mb4 스키마를 다시 만든 뒤 데이터를 넣는다.
- `--data-only --reset` 조합은 기존 스키마를 유지하고 대상 테이블 데이터만 비운 뒤 다시 넣는다.
- SQLite에만 있는 컬럼과 MySQL 생성 컬럼은 자동으로 제외한다.
- 대량 데이터는 `MYSQL_IMPORT_BATCH_SIZE` 단위로 bulk insert한다. 기본값은 `500`이다.

스키마만 만들려면:

```bash
npm run migrate:sqlite-to-mysql -- --schema-only
```

이미 만들어진 스키마에 데이터만 넣으려면:

```bash
npm run migrate:sqlite-to-mysql -- --data-only
```

## MySQL 데이터를 SQLite로 자동 백업

MySQL 런타임(`DB_MODE=mysql`)에서는 백엔드가 하루 1회 SQLite 스냅샷을 자동 생성할 수 있다. 기본값은 활성화이며, 매 30분마다 백업 가능 여부를 확인한다. 이미 오늘 백업이 있으면 건너뛴다.

```env
MYSQL_SQLITE_BACKUP_ENABLED=true
MYSQL_SQLITE_BACKUP_DIR=./backups/mysql-sqlite
MYSQL_SQLITE_BACKUP_RETENTION_DAYS=7
MYSQL_SQLITE_BACKUP_CRON=*/30 * * * *
MYSQL_SQLITE_BACKUP_BATCH_SIZE=1000
```

백업 파일 이름은 `mysql-backup-YYYY-MM-DD-HHMMSS.sqlite` 형식이다. 생성 중에는 임시 파일에 쓰고 완료 후 rename하므로, 중간 실패로 깨진 `.sqlite` 백업이 남지 않는다. 보관 기간이 지난 백업 파일과 하루 이상 지난 임시 파일은 자동 삭제한다.

부하가 높으면 해당 회차를 건너뛴다. 기준은 환경변수로 조정할 수 있다.

```env
MYSQL_SQLITE_BACKUP_MIN_UPTIME_SECONDS=300
MYSQL_SQLITE_BACKUP_MAX_RSS_MB=700
MYSQL_SQLITE_BACKUP_MAX_HEAP_USED_MB=450
MYSQL_SQLITE_BACKUP_MAX_REALTIME_CLIENTS=100
MYSQL_SQLITE_BACKUP_MAX_NOTIFICATION_CLIENTS=100
MYSQL_SQLITE_BACKUP_MAX_CHAT_PENDING=200
MYSQL_SQLITE_BACKUP_MAX_RECONNECT_TIMERS=30
```

여러 백엔드 인스턴스가 떠 있는 경우 `system_configs` 기반 scheduler lock을 사용해 한 인스턴스만 백업한다.

## 주의

- `market_listings`의 SQLite 부분 UNIQUE 인덱스(`status = 'PENDING'`)는 MySQL 생성 컬럼 `pending_user_card_id`와 UNIQUE 인덱스로 변환했다.
- 날짜 컬럼은 기존 코드와 SQLite 데이터를 그대로 보존하기 위해 `VARCHAR(64)`로 둔다.
- MySQL 런타임은 `DB_MODE=mysql`을 설정해야 활성화된다. 기존 호환용으로 `DB_CLIENT=mysql` 또는 `MYSQL_REQUIRED=true`도 인식하지만 신규 배포에서는 `DB_MODE`를 사용한다.
