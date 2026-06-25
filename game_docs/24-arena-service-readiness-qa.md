# 치카포 아레나 상용 서비스 준비도 QA

## 1. 목적

이 문서는 치카포 아레나를 실제 서비스로 열기 전에 확인해야 할 실데이터 QA, API 스모크 테스트, 제한 부하 테스트, 관리자 검수, 출시 판정 기준을 정의한다.

핵심 원칙은 다음과 같다.

- 기본 점검은 읽기 전용 API만 호출한다.
- 매치 생성, 큐 참가, 덱 저장 같은 쓰기 API는 자동 점검에서 실행하지 않는다.
- 부하 테스트는 명시적으로 켠 경우에만 제한된 동시성으로 실행한다.
- 데이터가 비어 있으면 목업을 넣지 않고 빈 상태를 정상적으로 표시하는지 확인한다.
- 결과 파일은 JSON/CSV로 남겨 이후 원인 분석과 패치 검토에 사용한다.

## 2. 실행 스크립트

루트에서 실행한다.

```powershell
npm run arena:readiness
```

기본값:

```text
ARENA_BASE_URL=http://127.0.0.1:2083/api
ARENA_MAX_LATENCY_MS=1500
ARENA_REQUEST_TIMEOUT_MS=5000
ARENA_LOAD_REQUESTS=0
ARENA_LOAD_CONCURRENCY=4
```

운영 서버를 대상으로 할 때:

```powershell
$env:ARENA_BASE_URL="https://chikapo.yuaru.com/api"
npm run arena:readiness
```

로그인 사용자 API까지 확인할 때:

```powershell
$env:ARENA_AUTH_COOKIE="chikapo_session=..."
npm run arena:readiness
```

관리자 API까지 확인할 때:

```powershell
$env:ARENA_ADMIN_COOKIE="chikapo_session=..."
npm run arena:readiness
```

제한 부하 테스트를 켤 때:

```powershell
$env:ARENA_LOAD_REQUESTS="100"
$env:ARENA_LOAD_CONCURRENCY="4"
npm run arena:readiness
```

`ARENA_LOAD_REQUESTS`는 최대 1000, `ARENA_LOAD_CONCURRENCY`는 최대 16으로 제한한다. 6GB RAM 서버에서는 공개 베타 전까지 `100 / 4` 이하로 시작한다.

## 3. 보고서

실행 결과는 `reports` 폴더에 저장된다.

```text
reports/arena-readiness-YYYY-MM-DDTHH-MM-SS-sssZ.json
reports/arena-readiness-YYYY-MM-DDTHH-MM-SS-sssZ.csv
```

JSON은 상세 원인 분석용이다.

CSV는 스프레드시트, 통계 비교, 버전별 성능 차이 확인용이다.

보고서를 분석 요청에 첨부할 때는 JSON과 CSV를 함께 전달한다. JSON에는 endpoint별 상태 코드, 지연 시간, 응답 크기, cache-control, 실패 메시지가 포함되어 있어 API 실패와 성능 저하를 구분할 수 있다.

## 4. 기본 스모크 범위

자동 점검은 기본적으로 아래 공개 GET만 수행한다.

| 이름 | API | 목적 |
| --- | --- | --- |
| public:system-status | `GET /api/arena/system-status` | kill switch, 이탈 정책, 운영 상태 확인 |
| public:current-season | `GET /api/arena/seasons/current` | 현재 시즌 응답 확인 |
| public:rules-catalog | `GET /api/arena/rules/catalog` | 클래스/스킬/태그 룰 카탈로그 확인 |
| public:cards | `GET /api/arena/cards?limit=10` | 카드 목록의 제한 조회 확인 |
| public:rankings | `GET /api/arena/rankings?limit=20` | 랭킹 스냅샷 조회 확인 |
| public:cup-status | `GET /api/arena/cups/status` | 8인 컵 상태 확인 |

이 범위는 DB 쓰기를 만들지 않는다. 카드/랭킹/시즌 조회가 캐시 또는 스냅샷을 타는지 확인하는 목적이다.

## 5. 인증 사용자 스모크 범위

`ARENA_AUTH_COOKIE`가 있을 때만 아래 API를 확인한다.

| 이름 | API | 목적 |
| --- | --- | --- |
| user:owned-cards | `GET /api/arena/cards/owned?limit=12` | 보유 카드 목록 빈 상태/제한 조회 확인 |
| user:decks | `GET /api/arena/decks` | 내 덱 목록 조회 확인 |
| user:recent-matches | `GET /api/arena/matches/recent?limit=8` | 최근 경기 빈 상태/요약 조회 확인 |
| user:profile | `GET /api/arena/profile/me` | MMR/전적 프로필 조회 확인 |
| user:streamer-card | `GET /api/arena/streamer-card/me` | 스트리머 카드 설정 가능 여부 확인 |
| user:arena-cosmetic-items | `GET /api/arena/cosmetics/shop-items` | 아레나 내부 스타일 상점 조회 확인 |
| user:arena-cosmetic-counts | `GET /api/arena/cosmetics/inventory-counts` | 아레나 내부 보유 수량 조회 확인 |
| user:arena-cosmetic-loadout | `GET /api/arena/cosmetics/loadout` | 아레나 내부 장착 상태 조회 확인 |

이 단계에서도 쓰기 API는 호출하지 않는다.

## 6. 관리자 스모크 범위

`ARENA_ADMIN_COOKIE`가 있을 때만 아래 API를 확인한다.

| 이름 | API | 목적 |
| --- | --- | --- |
| admin:system | `GET /api/admin/arena/system` | 관리자 운영 상태 확인 |
| admin:jobs | `GET /api/admin/arena/jobs?limit=8` | 최근 작업 큐 확인 |
| admin:quick-match | `GET /api/admin/arena/quick-match` | 빠른대전 큐 스냅샷 확인 |
| admin:cups | `GET /api/admin/arena/cups` | 8인 컵 큐/진행 상태 확인 |
| admin:stats | `GET /api/admin/arena/stats?limit=300` | 밸런스/승률 스냅샷 확인 |

관리자 점검도 읽기 전용이다. `recover`, `rebuild`, `prune`, `flag update`는 운영자가 별도 절차로 실행한다.

## 7. 출시 Gate

정식 공개 전 모든 항목을 통과해야 한다.

| Gate | 기준 |
| --- | --- |
| 빌드 | frontend/backend build 성공 |
| API 스모크 | critical endpoint 실패 0개 |
| 지연 시간 | 기본 스모크 p95가 `ARENA_MAX_LATENCY_MS` 이하 |
| 빈 상태 | 목업 없이 빈 카드/덱/최근 경기/통계를 명확히 표시 |
| 관리자 | admin system, jobs, queue, stats 조회 성공 |
| 랭킹 | 요청 시 실시간 전체 정렬 없이 스냅샷만 조회 |
| 리플레이 | 상세 로그가 없어도 요약/빈 상태 fallback 가능 |
| 이탈 복구 | 매칭 확정 후 재접속 시 match id 복구 가능, 타이머 만료 라운드는 worker가 자동 진행 |
| kill switch | 빠른대전, 봇전, 리플레이, 랭킹 관련 제한 플래그 확인 |
| 보고서 | JSON/CSV가 `reports`에 생성됨 |

## 8. 빈 데이터 판정 기준

상용 화면에서 목업 데이터는 사용하지 않는다.

정상 빈 상태:

- 카드 목록이 실제로 0개이면 “사용 가능한 카드가 없습니다” 계열의 빈 상태를 표시한다.
- 보유 카드가 0개이면 보유 카드 기준 편성 UI에 빈 상태를 표시한다.
- 최근 경기가 0개이면 전적/리플레이 영역에 빈 상태를 표시한다.
- 관리자 통계 표본이 부족하면 승률을 과장하지 않고 표본 부족 상태를 표시한다.

비정상 빈 상태:

- API 실패인데 빈 목록처럼 보이는 경우
- 권한 실패인데 데이터가 없는 것처럼 보이는 경우
- 로딩이 끝나지 않아 빈 상태와 구분되지 않는 경우
- 실제 데이터가 있는데 필터/정렬 오류로 숨겨지는 경우

## 9. 제한 부하 테스트 기준

목표는 한계치를 찾는 것이 아니라 “상용 전 기본값이 안전한지” 확인하는 것이다.

초기 권장값:

```text
ARENA_LOAD_REQUESTS=100
ARENA_LOAD_CONCURRENCY=4
```

허용 기준:

- 실패율 0%
- public GET p95 500ms 이하 권장
- public GET p99 1500ms 이하 권장
- MySQL CPU 상승이 본편 API에 영향을 주지 않음
- Node.js RSS가 지속 증가하지 않음
- swap 사용량 증가 없음

중단 기준:

- 본편 API 지연 증가
- MySQL CPU high 5분 지속
- quick join 또는 ranking p95 1초 초과
- Node.js event loop delay 증가
- swap 사용량 증가
- DB slow query 증가

중단 기준에 닿으면 부하 테스트를 멈추고 `21-arena-low-load-optimization-plan.md`의 제한 순서에 따라 봇전, 상세 리플레이, 랭킹 갱신, 빠른대전 신규 큐를 차례로 줄인다.

## 10. 실데이터 QA 절차

1. 운영 DB 백업 상태를 확인한다.
2. `arena-worker`가 떠 있는지 확인한다.
3. `npm run arena:readiness`로 공개 API를 확인한다.
4. 사용자 쿠키를 넣고 인증 사용자 API를 확인한다.
5. 관리자 쿠키를 넣고 관리자 API를 확인한다.
6. 화면에서 카드/덱/최근 경기/통계가 빈 데이터와 실패 상태를 구분하는지 확인한다.
7. 관리자 통계 CSV/JSON export가 현재 화면 필터와 일치하는지 확인한다.
8. 제한 부하 테스트를 낮은 값으로 1회만 수행한다.
9. `reports`의 JSON/CSV를 보관한다.
10. 실패 또는 지연 초과 항목이 있으면 공개하지 않는다.

## 11. PM2 기준 운영 확인

운영에서는 API와 arena-worker를 분리하되, 아레나 전용 API 서버를 추가하지 않는다.

확인 명령:

```bash
pm2 status
pm2 logs chikapo-api
pm2 logs chikapo-arena-worker
```

정상 기준:

- `chikapo-api`가 일반 요청과 아레나 읽기/쓰기 API를 처리한다.
- `chikapo-arena-worker`는 큐 만료, 큐 복구, 만료 라운드 자동 진행, 스냅샷 재생성, 리플레이 정리만 처리한다.
- `arena-worker`의 `MYSQL_CONNECTION_LIMIT`는 1로 시작한다.
- 관리자 rebuild/prune 작업은 API 응답 경로에서 직접 오래 실행되지 않는다.

## 12. Go/No-Go 판정

Go:

- 빌드 성공
- critical API 실패 0개
- 제한 부하 테스트 실패 0개
- 관리자 통계와 큐 상태 조회 가능
- 빈 데이터와 실패 상태가 UI에서 명확히 구분됨
- 본편 API 성능 저하 없음

No-Go:

- public critical API 실패
- ranking/cards 조회가 전체 스캔 또는 전체 정렬에 의존
- 관리자 통계 조회가 실시간 대량 `GROUP BY`에 의존
- 매치 생성 없이도 스모크 테스트에서 DB 쓰기가 발생
- 빈 데이터를 목업으로 채워 사용자 판단을 흐림
- 리플레이/랭킹/봇전 kill switch가 동작하지 않음
