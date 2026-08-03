# 치카포 아레나 최종 API 계약

## 1. 목적

이 문서는 구현자가 따라야 할 치카포 아레나 API의 단일 기준이다.

다른 기획 문서에 과거 초안 경로가 남아 있더라도 실제 구현은 이 문서와 `15-arena-api-spec.md`를 기준으로 한다.

## 2. 경로 규칙

- REST 스타일을 사용한다.
- 빠른대전은 `/matchmaking/quick/*` 아래에 둔다.
- 스트리머 본인 카드는 `/streamer-card/me` 아래에 둔다.
- 관리자 API는 `/api/admin/arena/*` 아래에 둔다.
- 클라이언트는 전투 결과를 제출하지 않는다.

## 3. 최종 엔드포인트

### 시스템/시즌

```text
GET /api/arena/system-status
GET /api/arena/seasons/current
GET /api/arena/rules/catalog
```

### 카드

```text
GET /api/arena/cards
GET /api/arena/cards/owned
GET /api/arena/cards/{card_id}
```

### 아레나 포인트 코스메틱

```text
GET   /api/arena/cosmetics/shop-items
GET   /api/arena/cosmetics/inventory-counts
GET   /api/arena/cosmetics/purchases
GET   /api/arena/cosmetics/loadout
PATCH /api/arena/cosmetics/loadout
POST  /api/arena/cosmetics/buy
```

### 아레나 실시간 외형 이벤트

```text
WS /arena/realtime
```

`/arena/realtime`은 배틀 이모트만 처리한다. 매칭, 전투 판정, 관전 tick stream, 랭킹 갱신에는 사용하지 않는다.

### 덱

```text
GET    /api/arena/decks
POST   /api/arena/decks
PATCH  /api/arena/decks/{deck_id}
DELETE /api/arena/decks/{deck_id}
POST   /api/arena/decks/{deck_id}/validate
```

### 빠른대전

```text
POST /api/arena/matchmaking/quick/join
GET  /api/arena/matchmaking/quick/status
GET  /api/arena/matchmaking/quick/events
POST /api/arena/matchmaking/quick/cancel
```

### AI 연습게임

```text
POST /api/arena/bot-matches
POST /api/arena/matches/{match_id}/rounds/commit
```

### 매치/리플레이

```text
GET /api/arena/matches/active
GET /api/arena/matches/{match_id}
GET /api/arena/matches/{match_id}/replay
GET /api/arena/matches/recent
POST /api/arena/matches/{match_id}/surrender
```

리플레이 이벤트는 `replay_version: 2` 기준으로 체력/실드 상태(`hp_before`, `hp_after`, `shield_before`, `shield_after`, `alive_after`)와 렌더링 메타데이터(`vfx_kind`, `damage_type`, `skill_id`, `skill_type`, `effect_tags`)를 선택적으로 포함한다. 클라이언트는 렌더링 메타데이터를 우선 사용하고, 필드가 없는 과거 리플레이는 이벤트 타입과 메시지 기반 fallback으로 재생한다.

### MMR/랭킹

```text
GET /api/arena/profile/me
GET /api/arena/profile/{user_id}
GET /api/arena/rankings
```

### 8인 컵

```text
GET  /api/arena/cups/status
POST /api/arena/cups/join
POST /api/arena/cups/queue/join
GET  /api/arena/cups/queue/status
GET  /api/arena/cups/queue/events
POST /api/arena/cups/cancel
POST /api/arena/cups/queue/cancel
GET  /api/arena/cups/{cup_id}  # 로그인한 참가자 또는 관리자만
```

### 관전

```text
POST /api/arena/matches/{match_id}/share
GET /api/arena/spectator/share/{token}
```
### 스트리머 카드 설정

```text
GET   /api/arena/streamer-card/me
PATCH /api/arena/streamer-card/me
POST  /api/arena/streamer-card/me/disable
POST  /api/arena/streamer-card/me/enable
```

### 관리자

```text
GET   /api/admin/arena/system
PATCH /api/admin/arena/system/flags/{flag}
GET   /api/admin/arena/jobs
GET   /api/admin/arena/quick-match
POST  /api/admin/arena/quick-match/recover-queue
GET   /api/admin/arena/cups
POST  /api/admin/arena/cups/recover-queue
GET   /api/admin/arena/stats
GET   /api/admin/arena/stats/overview
GET   /api/admin/arena/stats/balance
PATCH /api/admin/arena/restrictions/{type}/{id}
GET   /api/admin/arena/audit-logs
GET   /api/admin/arena/cosmetics
POST  /api/admin/arena/cosmetics
PATCH /api/admin/arena/cosmetics/{id}
POST  /api/admin/arena/cosmetics/assets
POST  /api/admin/arena/cosmetics/emote-assets  # 이전 클라이언트 호환
POST  /api/admin/arena/stats/rebuild
POST  /api/admin/arena/rankings/rebuild
POST  /api/admin/arena/matches/prune-logs
```

## 4. 최종 Rate Limit

| API | 제한 |
| --- | ---: |
| 카드 목록 조회 | 사용자당 10초 3회, IP당 60회/분 |
| 덱 저장 | 사용자당 10초 2회 |
| 덱 검증 | 사용자당 10초 3회 |
| 빠른대전 참가 | 사용자당 10초 1회 |
| 매칭 상태 조회/SSE 연결 | 상태 조회는 사용자당 3초 1회, SSE는 큐 대기 중 일시 연결 |
| 매칭 취소 | 사용자당 10초 2회 |
| 봇전 생성 | 사용자당 10분 10회 |
| 라운드 확정 | 봇전 생성 제한과 동일한 강도 또는 그 이하 |
| 리플레이 조회 | 사용자당 10초 3회 |
| 공개 전적 명함 조회 | 사용자당 10초 4회, 짧은 public cache 허용 |
| 랭킹 조회 | 사용자당 10초 2회, IP당 60회/분 |
| 아레나 코스메틱 구매/장착 | 사용자당 기본 윈도우 20회 |
| 아레나 이모트 WebSocket | 사용자별 1.5초 내외 쿨다운, DB write 없음 |
| 스트리머 카드 설정 저장 | 채널당 1분 3회 |
| 스트리머 카드 disable/enable | 채널당 1일 5회 |
| 관리자 아레나 운영 API | 관리자당 기본 윈도우 30회 |
| 관리자 이모트 이미지 업로드 | 관리자 아레나 운영 API 제한과 파일 크기 제한을 함께 적용 |

## 5. 최종 성능 목표

| 항목 | 목표 |
| --- | ---: |
| 빠른대전 참가 API | p95 300ms 이하 |
| 매칭 상태 조회 | p95 150ms 이하 |
| 덱 저장 | p95 300ms 이하 |
| 랭킹 조회 | p95 200ms 이하 |
| 리플레이 요약 조회 | p95 300ms 이하 |
| 5판 3선승 라운드 시뮬레이션 CPU 시간 | p95 150ms 이하 |
| 봇전 생성 | p95 300ms 이하 |
| 라운드 확정 | p95 500ms 이하 |

## 6. 구현 금지

- `/api/arena/me/card/opt-out` 신규 구현
- `/api/arena/me/card/opt-in` 신규 구현
- `/api/arena/matchmaking/quick-join` 신규 구현
- 클라이언트 제출 승패 반영
- 내부 난수 시드 공개
- 랭킹 조회 시 매번 전체 정렬
- 공개 전적 명함 조회 시 카드 보유량, 포인트, 방송 상태, 비공개 덱 원본 노출
- 리플레이 원본 JSON 무제한 저장
- 포인트 상품을 전투력, 매칭, MMR, 랭킹, 보상량에 연결
- MVP 전투/매칭 진행을 WebSocket 상시 연결에 의존하는 구현
- 이모트 WebSocket 이벤트를 전투 결과, MMR, 랭킹, 보상, 리플레이 원본에 반영하는 구현
- 밴픽 기능 추가 금지
- 시즌 로테이션 카드 풀 기능 추가 금지
- 실시간 관전 tick stream 구현

## 7. 마이그레이션 규칙

기존 초안 경로가 코드나 문서에 남아 있다면 아래로 통일한다.

| 과거 초안 | 최종 |
| --- | --- |
| `POST /api/arena/me/card/opt-out` | `POST /api/arena/streamer-card/me/disable` |
| `POST /api/arena/me/card/opt-in` | `POST /api/arena/streamer-card/me/enable` |
| `POST /api/arena/matchmaking/quick-join` | `POST /api/arena/matchmaking/quick/join` |
| `GET /api/arena/matchmaking/status` | `GET /api/arena/matchmaking/quick/status` |
| `POST /api/arena/matchmaking/cancel` | `POST /api/arena/matchmaking/quick/cancel` |

## 8. 이탈 및 재접속 API 계약

빠른대전은 상대의 접속 유지 여부에 의존하지 않는다.

필수 계약:

- `GET /api/arena/system-status`는 `disconnect_policy`를 포함한다.
- `POST /api/arena/matchmaking/quick/cancel`은 `WAITING` 큐만 취소한다.
- 이미 `MATCHED`인 큐에 cancel이 들어오면 취소하지 않고 `match_id`와 `resume_available=true`를 반환한다.
- `GET /api/arena/matchmaking/quick/status`는 재접속 후에도 최근 `matched_match_id`를 반환할 수 있어야 한다.
- `GET /api/arena/matches/active`는 시즌과 큐 상태에 의존하지 않고 참가자의 완료되지 않은 match를 반환해야 한다.
- 매칭 확정 후 클라이언트 연결 종료는 이미 확정된 라운드 결과, rating delta, replay 조회 가능 여부를 바꾸지 않는다.
- 아직 확정하지 않은 라운드는 재접속 후 다음 라운드 선택부터 이어간다.
- 참가자 한 명이 라운드 전술을 제출하면 기본 선택 타이머 동안 상대 입력을 기다려야 한다.
- 타이머가 끝나도 상대가 제출하지 않으면 저장된 기본 라운드 플랜으로 자동 처리하며, 이를 항복이나 패배 회피로 표시하지 않는다.
- 양쪽 클라이언트가 모두 이탈한 상태에서도 `arena-worker`가 만료된 라운드 선택을 제한 개수만 스캔해 자동 커밋한다.
- `POST /api/arena/matches/{match_id}/surrender`는 빠른대전과 연습전 참가자 본인에게만 허용한다. 빠른대전은 상대 승리, 본인 패배, MMR을 하나의 트랜잭션에서 멱등 확정한다.
- 8인전 개별 매치 항복은 거부하고 재접속만 제공한다.
- 리플레이 시청 상태는 MVP에서 서버 저장 필드로 만들지 않는다.

금지:

- 브라우저 unload 이벤트에 의존해 큐 정합성을 유지하는 구현
- 상대 접속 상태를 전투 진행 조건으로 삼는 구현
- 페이지 이탈이나 네트워크 단절 자체를 항복 또는 패배 회피로 재해석하는 구현
- 리플레이 미시청을 보상 또는 MMR 조건으로 삼는 구현
- 상대 미제출 상태를 장시간 대기 UX로 노출하는 구현

## 9. 전송 방식 계약

MVP 빠른대전은 HTTP 요청을 기본으로 하고, 큐 대기 중에는 일시 SSE 연결로 상태 변경을 받는다. 빠른대전 매치 형식은 5판 3선승이다.

- 매칭 참가: `POST /api/arena/matchmaking/quick/join`
- 매칭 상태: `GET /api/arena/matchmaking/quick/events` SSE 우선, `GET /api/arena/matchmaking/quick/status`는 재접속/fallback 경로로 사용
- 전투: match id 생성 후 라운드별 커밋 요청에서 해당 라운드만 서버 시뮬레이션
- 리플레이: 저장된 결과 로그를 클라이언트가 재생
- 결과 공개: 클라이언트는 라운드 종료 연출 이후 승패와 점수를 표시

WebSocket은 전투 진행의 필수 구성요소가 아니다. 큐 SSE는 매칭, 취소, 만료 후 서버가 즉시 종료한다. PM2 cluster나 다중 API 인스턴스에서는 sticky routing 또는 Redis Pub/Sub 같은 외부 이벤트 버스 없이는 즉시성이 보장되지 않는다. 관전은 완료된 리플레이/하이라이트 조회로 시작한다.

예외적으로 `/arena/realtime`은 배틀 이모트처럼 전투 판정과 분리된 외형 이벤트만 허용한다. 이 이벤트는 메모리 룸에 브로드캐스트하고 DB에 저장하지 않는다. 소켓 연결 실패나 재접속은 확정된 라운드 결과, rating delta, replay 조회 가능 여부를 바꾸지 않는다.

## 10. 확장 기능 계약

- 빠른대전은 5판 3선승이다.
- 밴픽은 제공하지 않는다.
- 시즌 로테이션 카드 풀은 제공하지 않는다.
- 8인 컵은 기본 랭크 MMR과 분리한다.
- 관전은 완료된 매치/컵 리플레이 기반이다.
- 관리자 통계는 스냅샷 기반이며 요청 시 전체 실시간 집계를 수행하지 않는다.
