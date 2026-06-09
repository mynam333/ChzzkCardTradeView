# Persistent Disk SQLite 운영 가이드

이 백엔드는 Supabase 환경 변수가 없거나 `SUPABASE_REQUIRED=false`인 상태에서 SQLite repository로 동작한다.
운영에서는 SQLite 파일과 업로드 파일을 반드시 persistent disk/volume 안에 둔다.

## 필수 환경 변수

```env
SUPABASE_REQUIRED=false
SQLITE_DB_PATH=/var/data/chikapo.sqlite
SQLITE_REQUIRE_PERSISTENT_PATH=true
UPLOADS_DIR=/var/data/uploads
```

`SQLITE_DB_PATH`는 SQLite 본 파일 경로다. 같은 디렉터리에 `chikapo.sqlite-wal`, `chikapo.sqlite-shm`도 생긴다.
`UPLOADS_DIR`는 커스텀 카드 이미지 저장 경로다. DB만 보존하고 이 경로를 ephemeral filesystem에 두면 이미지가 재배포 때 사라진다.

## 배포 플랫폼 예시

Render:

```env
SQLITE_DB_PATH=/var/data/chikapo.sqlite
UPLOADS_DIR=/var/data/uploads
SQLITE_REQUIRE_PERSISTENT_PATH=true
```

Render Dashboard에서 Disk를 추가하고 mount path를 `/var/data`로 맞춘다.

Fly.io:

```env
SQLITE_DB_PATH=/data/chikapo.sqlite
UPLOADS_DIR=/data/uploads
SQLITE_REQUIRE_PERSISTENT_PATH=true
```

Fly Volume을 만들고 앱에 `/data`로 마운트한다.

## Supabase에서 SQLite로 전환

1. 현재 서비스를 쓰기 중지 또는 점검 모드로 전환한다.
2. Supabase 데이터를 SQLite 파일로 export한다. 이미 생성된 `supabase.sqlite`가 있다면 그 파일을 persistent disk의 `SQLITE_DB_PATH` 위치로 복사한다.
3. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`을 운영 환경 변수에서 제거한다.
4. `SUPABASE_REQUIRED=false`, `SQLITE_DB_PATH`, `SQLITE_REQUIRE_PERSISTENT_PATH=true`, `UPLOADS_DIR`를 설정한다.
5. 서버를 재시작하고 `/api/health` 및 로그인/인벤토리/랭킹/마켓 기능을 확인한다.

## 백업

SQLite는 실행 중에도 백업 API를 통해 안전하게 복사해야 한다. 단순 파일 복사는 WAL 체크포인트 타이밍에 따라 일관성이 깨질 수 있다.
운영 서버에서 주기적으로 `better-sqlite3`의 `db.backup()` 또는 `sqlite3 .backup`을 사용해 persistent disk 외부 스토리지로 내보낸다.

## 운영 주의점

SQLite 쓰기는 단일 writer 모델이다. 이 서비스는 단일 백엔드 인스턴스 기준으로 운영한다.
여러 인스턴스를 띄우면 스케줄러와 거래/경매 쓰기가 충돌할 수 있으므로, 수평 확장이 필요해지는 시점에는 Postgres 계열로 되돌리는 것이 맞다.
