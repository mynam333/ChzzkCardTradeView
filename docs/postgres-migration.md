# MySQL to PostgreSQL Migration

현재 운영 DB가 Ubuntu MySQL이고, 새 Ubuntu 서버의 PostgreSQL로 이전할 때 쓰는 절차다.

## 대상 PostgreSQL 준비

```sql
CREATE DATABASE chzzk_card_trade_view;
CREATE USER chikapo WITH PASSWORD 'change_me';
GRANT ALL PRIVILEGES ON DATABASE chzzk_card_trade_view TO chikapo;
```

PostgreSQL 15+ 기준으로 public schema 권한이 막혀 있으면 대상 DB에서 한 번 더 실행한다.

```sql
GRANT USAGE, CREATE ON SCHEMA public TO chikapo;
```

## 원클릭 이전

스크립트를 실행하기 위해 `.env`를 미리 수정할 필요는 없다. 기본 실행은 접속 정보를 대화형으로 묻고, 대상 DB 초기화 여부, `.env` 자동 갱신 여부, 프로젝트 파일 전송 여부도 실행 중에 입력받는다.

```bash
npm install
npm run migrate:mysql-to-postgres
```

명시적으로 대화형 모드를 켤 수도 있다.

```bash
npm run migrate:mysql-to-postgres -- --interactive
```

대화형 모드에서 입력하는 값:

- 원본 MySQL 호스트, 포트, DB 이름, 사용자 ID, 비밀번호
- 대상 PostgreSQL 호스트, 포트, DB 이름, 사용자 ID, 비밀번호, SSL 사용 여부
- 갱신할 `backend/.env` 경로
- 대상 PostgreSQL 초기화 여부
- 검증 성공 후 `.env`를 `DB_MODE=postgres`로 전환할지 여부
- 검증 성공 후 프로젝트 파일을 대상 Ubuntu로 전송할지 여부
- 전송할 프로젝트 폴더, 대상 SSH 호스트/포트/사용자/프로젝트 경로, SSH key 경로

자동화 환경에서는 `.env` 대신 명령줄 인자로 모두 넘긴다. 이때 `--non-interactive`를 붙이면 누락 값이 있을 때 즉시 실패한다.

```bash
npm run migrate:mysql-to-postgres -- \
  --non-interactive --reset --yes --sync-files \
  --mysql-host old-ubuntu --mysql-port 3306 --mysql-database chzzk_card_trade_view \
  --mysql-user chikapo --mysql-password old_password \
  --postgres-host new-ubuntu --postgres-port 5432 --postgres-database chzzk_card_trade_view \
  --postgres-user chikapo --postgres-password new_password \
  --target-host new-ubuntu --target-user deploy --target-path /srv/chzzk-card-trade-view \
  --env-path backend/.env
```

동작:

- `init-db-postgres.sql`을 먼저 적용한다.
- MySQL 원본에만 있는 테이블/컬럼은 PostgreSQL에 자동 생성/추가한다.
- MySQL 모든 base table을 대상 PostgreSQL로 복사한다.
- serial/sequence 값을 보정한다.
- 모든 복사 대상 테이블의 MySQL row count와 PostgreSQL row count를 비교한다.
- 검증이 통과하면 `backend/.env`를 백업한 뒤 `DB_MODE=postgres`, `POSTGRES_*`, `DATABASE_URL` 값을 갱신한다.
- `--sync-files`가 켜져 있으면 갱신된 프로젝트 폴더를 `tar | ssh tar` 방식으로 대상 Ubuntu 경로에 전송한다.

파일 전송에서 기본 제외되는 항목:

- `node_modules`
- `.git`
- `.next`, `frontend/.next`, `frontend/out`
- `backend/dist`, `dist`
- `coverage`, `.turbo`, `.cache`, `.pnpm-store`
- `*.log`
- `local.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`
- `backups`

추가 제외 패턴은 반복해서 넘길 수 있다.

```bash
npm run migrate:mysql-to-postgres -- --sync-files --exclude=public/tmp --exclude=uploads/cache
```

자동 `.env` 갱신을 막으려면:

```bash
npm run migrate:mysql-to-postgres -- --reset --skip-env-update
```

파일 전송만 막으려면:

```bash
npm run migrate:mysql-to-postgres -- --reset --skip-file-sync
```

스키마만 만들려면:

```bash
npm run migrate:mysql-to-postgres -- --schema-only
```

기존 스키마에 데이터만 다시 넣으려면:

```bash
npm run migrate:mysql-to-postgres -- --data-only --reset
```

대량 이력 테이블이 오래 걸리면 batch를 키울 수 있다. 스크립트는 숫자 `id`가 있는 테이블을 `LIMIT/OFFSET` 대신 keyset 방식으로 읽고, `value_history`는 reset 마이그레이션 중 인덱스를 잠시 내렸다가 import 후 재생성한다.

```bash
npm run migrate:mysql-to-postgres -- --reset --batch-size 10000 --max-insert-params 60000
```

기존 인덱스를 유지한 채 import하려면 `--keep-import-indexes`를 붙인다.

검증만 다시 수행하려면:

```bash
npm run migrate:mysql-to-postgres -- --verify-only
```

## PostgreSQL final tuning

마이그레이션 후 실데이터가 들어간 대상 PostgreSQL에서 다음을 실행하면 확장/인덱스 적용, 통계 갱신, 대표 쿼리 `EXPLAIN ANALYZE` 리포트 생성을 한 번에 수행한다. 이 스크립트도 `.env`를 수정하지 않는다.

```bash
npm run postgres:tune -- --interactive
```

명령줄로 실행할 수도 있다.

```bash
npm run postgres:tune -- \
  --host 10.0.0.20 \
  --port 5432 \
  --database chikapo \
  --user chikapo_app \
  --password 'POSTGRES_PASSWORD' \
  --ssl false \
  --yes
```

리포트는 기본적으로 `logs/postgres-tuning-report-*.json`에 저장된다. 운영 부하가 걱정되면 `--skip-explain` 또는 `--skip-analyze`를 붙여 단계별로 실행한다. 테이블 bloat 정리까지 같이 하고 싶을 때만 `--vacuum`을 추가한다. 큰 DB에서 인덱스 생성 시간이 길면 `--statement-timeout-ms 0` 기본값을 유지하고, 락 대기만 `--lock-timeout-ms 10000`처럼 조절한다.

## 백엔드 전환

대화형 또는 명령줄 옵션에서 `.env` 자동 갱신을 선택하면 검증 통과 후 스크립트가 `backend/.env`를 백업하고 PostgreSQL 런타임 값으로 바꾼다. 수동 수정은 필요 없다.
