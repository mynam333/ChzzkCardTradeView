# 치카포 아레나 매칭, MMR, 운영 부하 기획서

## 1. 목적

이 문서는 치카포 아레나의 빠른대전, AI 봇 연습전, MMR, 아레나 전용 랭킹, 백엔드/DB 부하 제한 정책을 정의한다.

운영 환경은 백엔드와 MySQL이 같은 서버에서 동작하며, 메모리는 6GB RAM과 4GB swap이다. 따라서 아레나는 처음부터 저부하 구조로 설계해야 한다. 기능보다 중요한 제약은 서버가 장시간 게임 상태를 메모리에 들고 있거나, DB에 과도한 실시간 갱신/집계를 발생시키지 않는 것이다.

이 문서는 `01-chikapo-arena-plan.md`의 원칙을 따른다.

- 아레나 전투력은 치카포 시세, 팔로워, 방송 중 여부, 채팅량, 포인트, 마켓 구매력과 연결하지 않는다.
- 치카포 본편 리소스는 이미지와 코스메틱 중심으로 사용한다.
- 같은 스트리머 카드는 모든 유저에게 같은 능력을 가진다.
- 스트리머가 설정하지 않은 카드도 `channel_id` 기반 결정적 랜덤 템플릿으로 기본 능력을 가진다.
- 스트리머는 자신의 카드가 아레나에 쓰이지 않도록 비활성화할 수 있다.

## 2. 기본 PvP: 빠른대전

아레나의 기본 PvP는 빠른대전이다. 유저는 덱과 라운드별 전술 플랜을 선택해 큐에 등록하고, 비슷한 MMR의 상대와 5판 3선승 세트 매치를 진행한다.

중요한 전제:

- 빠른대전은 실시간 액션 게임이 아니다.
- 서버는 유저별 상주 매치룸을 유지하지 않는다.
- 매칭이 성사되면 서버는 덱 스냅샷, 전장 규칙, 매치 시드만 고정한다.
- 각 라운드는 양쪽 선택 또는 기본 선택 타이머 종료 후 라운드 종료 시점에 확정된다.
- 클라이언트는 확정된 라운드 로그를 순서대로 재생해 7~12분 체감 전투로 보여준다.

이 구조는 WebSocket 기반 실시간 전투방보다 메모리와 DB 부하가 낮고, 현재 서버 사양에 맞다.

## 3. 빠른대전 흐름

1. 유저가 덱과 라운드별 전술 플랜을 선택하고 빠른대전 큐에 등록한다.
2. 서버는 유저의 현재 시즌 MMR을 조회한다.
3. 서버는 비슷한 MMR 범위의 큐 엔트리를 찾는다.
4. 상대가 있으면 양쪽 큐 엔트리를 매칭 완료 처리한다.
5. 양쪽 덱 스냅샷과 라운드별 전술 플랜을 고정한다.
6. 서버는 match id를 반환하고 1라운드 선택 단계로 진입한다.
7. 각 라운드 선택이 제출되거나 타이머가 끝나면 해당 라운드만 deterministic seed로 계산한다.
8. 세트가 끝나면 최종 결과, MMR 변화, 요약 로그를 저장한다.
9. 상세 리플레이 로그는 짧은 보존 기간 후 삭제한다.

상대가 없을 때:

- 클라이언트는 큐 대기 중 일시 SSE를 우선 사용하고, 연결 실패나 재접속 시에만 3초 이상 간격의 HTTP fallback 상태 조회를 사용한다.
- 큐 대기 시간이 길어지면 MMR 검색 범위를 점진적으로 넓힌다.
- 일정 시간 이후에는 AI 봇 연습전으로 전환할지 선택하게 한다.
- 랭크 빠른대전에서 AI 봇을 자동 대체 상대로 넣는 것은 권장하지 않는다.

### 3.1 이탈 및 연결 끊김 정책

특정 유저가 게임 중 브라우저를 닫거나 네트워크가 끊겨도 다른 유저의 경험이 멈추면 안 된다. 따라서 빠른대전은 다음 상태 경계를 반드시 지킨다.

큐 대기 중:

- 유저가 화면을 나가거나 명시적으로 취소하면 본인의 큐 엔트리만 `CANCELLED` 또는 `EXPIRED` 처리한다.
- 아직 상대가 확정되지 않은 상태이므로 다른 유저에게 패배, 대기 지연, 보상 손실을 주지 않는다.
- 클라이언트 연결 종료만으로 즉시 DB write를 반복하지 않는다. 짧은 TTL과 상태 조회 시 정리로 처리한다.
- 반복 취소와 반복 만료는 큐 악용 신호로만 기록하며, 전투 패배로 처리하지 않는다.

매칭 확정 직후:

- 두 큐 엔트리가 `MATCHED`로 원자 전환되는 순간 양쪽 덱 스냅샷과 라운드 플랜을 고정한다.
- 서버는 세트 전체를 즉시 시뮬레이션하지 않고 라운드 커밋 시점마다 해당 라운드만 확정한다.
- 이 시점 이후 브라우저 종료, 새로고침, 네트워크 단절은 이미 확정된 라운드 결과에 영향을 주지 않는다.
- 한쪽 유저가 먼저 라운드 전술을 제출하면 기본 선택 타이머 동안 상대 입력을 기다린다.
- 타이머 종료 후에도 미제출 상태라면 저장된 기본 라운드 플랜으로 자동 처리한다.

리플레이 재생 중:

- 리플레이는 이미 저장된 결과를 재생하는 화면이므로 중간 이탈은 로컬 UX 이벤트일 뿐이다.
- 리플레이 중 나가기는 상대에게 알림을 보내지 않고, MMR이나 보상에 추가 영향을 주지 않는다.
- 재접속 시 최근 완료 match id 또는 전투 기록에서 결과와 리플레이를 다시 열 수 있어야 한다.

항복:

- 빠른대전의 화면 이탈은 항복이나 패배 회피로 해석하지 않는다. 전투 화면의 `나가기`는 화면 종료로만 처리한다.
- 진행 중 빠른대전은 아레나 메인에서 재접속하거나 명시적으로 항복할 수 있다.
- 항복은 확인 단계를 거친 참가자 본인의 요청만 인정하고, 상대 승리와 본인 패배 및 MMR 변동을 일반 종료와 같은 원자 트랜잭션으로 한 번만 확정한다.
- 연습전은 화면 이탈 시 즉시 종료한다. 8인전 개별 매치 항복은 전체 대회 이탈 정책이 확정되기 전까지 제공하지 않는다.

패널티 범위:

- 이탈 패널티는 `큐 등록 후 반복 취소`, `큐 만료 반복`, `매칭 직전 악의적 회피` 같은 큐 악용에만 적용한다.
- 매칭 확정 후 미시청, 리플레이 중 이탈, 결과 화면 미확인은 패널티 대상이 아니다.
- 큐 악용 패널티도 낮은 단계에서는 짧은 재큐 쿨다운으로 시작하고, MMR 손실로 바로 연결하지 않는다.

## 4. AI 봇 연습전

AI 봇과 연습게임을 지원한다. 봇전은 MMR과 랭킹에 영향을 주지 않는다.

목적:

- 신규 유저 튜토리얼
- 덱 테스트
- 카드 스킬 이해
- 매칭 상대가 부족한 시간대의 이탈 방지
- 서버 전투 엔진 검증

봇전 원칙:

- MMR 변화 없음
- 랭킹 반영 없음
- 시즌 승패 기록 반영 없음
- 포인트 보상 없음 또는 매우 제한
- 봇 덱은 미리 생성된 템플릿을 사용
- 봇도 라운드별 전술 플랜을 가진다.
- 매 요청마다 복잡한 AI 탐색을 하지 않음
- 봇은 전투 중 의사결정을 거의 하지 않는 정적 상대에 가깝게 설계

권장 봇 유형:

- 입문 봇: 시너지 낮음, 기본 배치
- 일반 봇: 완성된 기본 시너지
- 상급 봇: 카운터 태그 포함, 좋은 배치
- 메타 봇: 현재 시즌 인기 조합을 모사

봇 덱은 시즌 시작 또는 카드 사용 가능 상태 갱신 시 미리 생성해 저장한다. 봇전 요청마다 3,000장 카드 풀을 훑어서 덱을 만들면 안 된다.

## 4.5 8인 아레나 컵

8인 컵은 빠른대전과 분리된 별도 모드다. 기본 랭크 MMR에는 반영하지 않는다.

흐름:

1. 유저가 컵 전용 덱, 라운드별 전술 플랜, 전술 칩을 선택한다.
2. 컵 큐에 등록한다.
3. 8명이 모이면 `arena_cups`를 생성한다.
4. 참가자 8명의 덱/플랜 스냅샷을 고정한다.
5. 별도 컵 워커가 최대 12세트를 순서대로 계산한다.
6. 컵 등수, 컵 포인트, 요약 로그를 저장한다.
7. 참가자는 자기 경기, 결승전, 하이라이트 리플레이를 조회한다.

부하 제한:

- 컵 동시 처리 수는 0~1개로 시작한다.
- 컵 큐와 빠른대전 큐를 분리한다.
- 컵은 서버 부하가 높으면 즉시 생성 중단할 수 있어야 한다.
- 컵 전체 상세 리플레이를 모두 저장하지 않는다.
- 참가자 본인 경기, 결승전, 관리자 선정 하이라이트만 상세 로그 보존 대상이다.
- 컵 통계는 실시간 갱신하지 않고 스냅샷으로 집계한다.
## 5. MMR 시스템

아레나는 치카포 본편과 별도의 MMR을 가진다.

원칙:

- 랭크 빠른대전 결과만 MMR에 반영한다.
- 봇전, 친선전, 커스텀 룸, 8인 컵은 기본 랭크 MMR에 반영하지 않는다.
- MMR은 유저 단위로 관리한다.
- 시즌이 바뀌면 soft reset을 적용한다.
- 표시 등급은 MMR을 그대로 노출하지 않고 티어/점수 형태로 보여줄 수 있다.

권장 필드:

```text
user_id
season_id
mmr
rating_points
tier
wins
losses
draws
streak
last_played_at
updated_at
```

MMR 계산은 Elo 또는 Glicko 계열로 시작할 수 있다. MVP에서는 단순 Elo 기반으로 충분하다.

초기 권장값:

- 기본 MMR: 1000
- 최소 MMR: 0
- 일반 K값: 24~32
- 배치 경기 K값: 40
- 시즌 soft reset: 
ew_mmr = 1000 + (old_mmr - 1000) * 0.5`

MMR 업데이트는 매치 결과 저장과 함께 짧은 트랜잭션으로 처리한다.

## 6. 아레나 전용 랭킹

아레나는 치카포 본편 랭킹과 분리된 랭킹을 가진다.

랭킹 원칙:

- 본편 카드 가치 랭킹, 보유 자산 랭킹과 섞지 않는다.
- 랭킹 조회는 캐시 또는 스냅샷 테이블을 우선 사용한다.
- 매 전투마다 전체 랭킹을 재계산하지 않는다.
- 일정 주기 또는 변경분 기반으로 랭킹 스냅샷을 갱신한다.
- 승률 랭킹에는 최소 판수 조건을 둔다.

권장 랭킹:

- 시즌 MMR 랭킹
- 티어별 랭킹
- 승률 랭킹
- 연승 랭킹
- 인기 덱/클래스 통계. 단, 운영자용 통계에서 먼저 시작

랭킹 API는 실시간 집계 쿼리를 직접 수행하지 않고 `arena_rank_snapshots`를 읽는다.

## 6.5 컵 랭킹과 통계

8인 컵은 별도 컵 포인트와 이벤트 랭킹을 가진다.

- 1:1 랭크 MMR과 컵 포인트를 합치지 않는다.
- 컵 랭킹도 스냅샷 기반으로 조회한다.
- 컵 등수별 조합, 클래스, 스킬, 전술 칩 통계는 관리자 통계 스냅샷으로 제공한다.
## 7. 부하 제한 원칙

현재 서버 사양에서는 다음 구조를 피해야 한다.

- 유저별 상주 게임룸을 메모리에 오래 유지
- 전투를 tick 단위로 실시간 브로드캐스트
- 매칭 대기열 전체를 DB에서 초당 반복 조회
- 매 전투마다 전체 랭킹 재계산
- 상세 전투 로그를 무기한 DB 저장
- 3,000장 카드 능력을 요청마다 즉석 생성/검증
- 카드 풀 전체를 매 요청마다 풀스캔
- 봇 덱을 매 요청마다 새로 탐색 생성

권장 구조:

- 5판 3선승 세트 전투는 요청 시 짧게 계산하고 즉시 종료
- 매칭 큐는 짧은 TTL을 가진 가벼운 테이블로 운영
- 카드 능력은 시즌 시작 또는 카드 사용 가능 상태 갱신 시 미리 생성
- 전투에는 덱 스냅샷과 사전 저장된 라운드별 전술 플랜만 사용
- 랭킹은 별도 스냅샷 테이블 사용
- 상세 전투 로그는 짧은 기간만 보존
- 오래된 리플레이는 요약 결과만 남기고 삭제
- 관리자 통계는 실시간 집계보다 배치/스냅샷 우선
- 8인 컵과 관전은 별도 kill switch로 즉시 제한 가능
- 관리자 화면은 대량 GROUP BY를 요청 시 직접 실행하지 않음

## 8. 매칭 큐 설계

큐 엔트리는 작고 짧게 유지한다.

권장 필드:

```text
id
user_id
season_id
deck_id
round_plan_hash
mmr
status
queued_at
expires_at
matched_match_id
```

상태값:

```text
WAITING
MATCHED
CANCELLED
EXPIRED
```

필수 제약:

- 한 유저는 하나의 활성 큐 엔트리만 가질 수 있다.
- 큐 등록 전에 덱과 라운드별 전술 플랜이 유효해야 한다.
- 큐 엔트리는 30~60초 TTL을 가진다.
- 만료된 큐는 주기적으로 소량 삭제한다.
- 매칭 조회는 인덱스를 반드시 사용한다.

필수 인덱스:

```text
(season_id, status, mmr, queued_at)
(user_id, status)
(expires_at)
```

초기 버전에서는 상시 WebSocket 룸을 만들지 않는다. 큐 대기 중에는 일시 SSE를 우선 사용하고, 실패 시에만 3초 이상 간격의 HTTP fallback 상태 조회를 사용한다.

## 9. 전투 시뮬레이션 부하 제한

전투 시뮬레이션은 CPU와 메모리를 예측 가능하게 제한해야 한다.

필수 제한:

- 덱 크기 상한. 예: 저장 덱 10장, 라운드별 출전 6장
- 최대 라운드 수. 기본 5
- 라운드별 최대 전투 시간
- 라운드별 최대 tick 수
- 세트 전체 최대 tick 수
- 소환수 수량 상한
- 상태 이상과 버프 수량 상한
- 전투 로그 이벤트 수 상한
- 무승부 판정 시간

전투 계산은 DB 트랜잭션 안에서 오래 실행하지 않는다.

권장 처리:

1. 필요한 유저, 덱, 카드, 라운드 플랜 스냅샷을 짧게 조회한다.
2. DB 트랜잭션 밖에서 5판 3선승 세트를 계산한다.
3. 결과 저장 시에만 짧은 트랜잭션을 사용한다.
4. MMR 변경과 match result 저장은 원자적으로 처리한다.

## 10. 전투 로그 보존

전투 로그는 빠르게 커질 수 있으므로 보존 정책이 필요하다.

권장 보존:

- 세트 매치 결과 요약: 시즌 종료 후에도 보존 가능
- 상세 리플레이 로그: 7~14일 보존
- 상위 랭커/대회 리플레이: 별도 플래그가 있을 때만 장기 보존
- 봇전 리플레이: 저장하지 않거나 매우 짧게 보존

상세 로그는 별도 테이블에 저장해 오래된 로그 삭제가 쉽도록 한다. JSON payload에는 크기 제한을 둔다.

## 10.5 관전 로그 보존

관전은 완료된 매치/컵 리플레이를 대상으로 한다.

- 실시간 tick 브로드캐스트 관전은 제공하지 않는다.
- 관전용 공유 링크는 토큰과 만료 시각을 가진다.
- 관전 리플레이는 summary 또는 압축/요약 로그를 우선 사용한다.
- 비활성화된 스트리머 카드는 관전 리플레이에서 비식별 또는 대체 표시한다.
- 관전자별 진행 위치는 서버에 저장하지 않는다.
## 11. 데이터 모델 초안

### 11.1 arena_match_queue

```text
id PK
user_id
season_id
deck_id
round_plan_hash
mmr
status
queued_at
expires_at
matched_match_id
```

### 11.2 arena_matches

```text
id PK
season_id
match_type
player_a_id
player_b_id
player_a_deck_snapshot_json
player_b_deck_snapshot_json
player_a_round_plans_json
player_b_round_plans_json
winner_user_id
match_seed
summary_json
round_results_json
rating_delta_json
created_at
```

`match_type` 예시:

- `RANKED`
- `CASUAL`
- `BOT_PRACTICE`
- `CUSTOM`

### 11.3 arena_battle_logs

```text
match_id PK
log_json
expires_at
created_at
```

### 11.4 arena_player_ratings

```text
user_id
season_id
mmr
rating_points
tier
wins
losses
draws
streak
last_played_at
updated_at
```

기본 키:

```text
(season_id, user_id)
```

랭킹용 인덱스:

```text
(season_id, mmr)
(season_id, rating_points)
```

### 11.5 arena_rank_snapshots

```text
season_id
rank_type
rank_no
user_id
score
snapshot_at
```

### 11.6 arena_cups

```text
id PK
season_id
cup_type
status
participant_count
rules_json
winner_user_id
summary_json
created_at
completed_at
```

### 11.7 arena_cup_entries

```text
cup_id
user_id
deck_snapshot_json
strategy_plan_snapshot_json
seed_no
final_rank
cup_points_delta
```

### 11.8 arena_cup_matches

```text
cup_id
match_id
bracket_round
placement_group
player_a_id
player_b_id
winner_user_id
summary_json
```

### 11.9 arena_spectator_links

```text
id PK
match_id nullable
cup_id nullable
visibility
created_by
expires_at
created_at
```

### 11.10 arena_balance_stat_snapshots

```text
season_id
snapshot_type
metric_key
sample_count
wins
losses
draws
win_rate
payload_json
snapshot_at
```
## 12. API 초안

빠른대전:

- `POST /api/arena/matchmaking/quick/join`
- `GET /api/arena/matchmaking/quick/status`
- `POST /api/arena/matchmaking/quick/cancel`

봇 연습전:

- `POST /api/arena/matches/bot-practice`

매치/리플레이:

- `GET /api/arena/matches/:match_id`
- `GET /api/arena/matches/:match_id/replay`

MMR/랭킹:

- `GET /api/arena/me/rating`
- `GET /api/arena/rankings`

관리자:

- `POST /api/admin/arena/rankings/rebuild`
- `POST /api/admin/arena/matches/prune-logs`
- `GET /api/admin/arena/matchmaking/stats`

8인 컵:

- `POST /api/arena/cups/queue/join`
- `GET /api/arena/cups/queue/status`
- `POST /api/arena/cups/queue/cancel`
- `GET /api/arena/cups/:cup_id`

관전:

- `POST /api/arena/matches/:match_id/share`
- `GET /api/arena/spectator/share/:token`
- 공개 match_id 직접 조회는 제공하지 않는다.

관리자 통계:

- `GET /api/admin/arena/stats/overview`
- `GET /api/admin/arena/stats/balance`
- `POST /api/admin/arena/stats/rebuild`
- `POST /api/admin/arena/cups/kill-switch`
- `POST /api/admin/arena/spectator/kill-switch`
## 13. MVP 범위 반영

MVP에 포함:

- 빠른대전
- 5판 3선승 세트 매치
- 1~5라운드 사전 전술 플랜과 라운드별 직접 선택
- AI 봇 연습전
- 아레나 전용 MMR
- 아레나 전용 랭킹 스냅샷
- 짧은 TTL 기반 매칭 큐
- 서버 전투 시뮬레이션
- 세트 전투 리플레이
- 상세 전투 로그 보존 기간 관리
- 8인 컵 별도 모드
- 완료 리플레이 기반 관전
- 관리자 통계 스냅샷과 운영 페이지

MVP에서 제외:

- 상주 실시간 매치룸
- 라운드 사이 실시간 전술 수정
- 밴픽
- 시즌 로테이션 카드 풀
- tick 단위 실시간 브로드캐스트
- 무제한 리플레이 보관
- 실시간 전체 랭킹 재계산
- 봇전 MMR 반영
- 치카포 본편 랭킹과 아레나 랭킹 통합

## 14. 반드시 지켜야 할 결정 사항

1. 기본 PvP는 빠른대전으로 제공한다.
2. 빠른대전은 5판 3선승 세트 매치로 제공한다.
3. 빠른대전은 실시간 상주 매치룸 구조로 만들지 않는다.
4. 라운드 사이 전술 수정은 제한 시간 안에서만 제공하며, 미입력 시 기본 플랜으로 자동 진행한다.
5. AI 봇 연습전은 MMR과 랭킹에 영향을 주지 않는다.
6. 아레나는 치카포 본편과 분리된 MMR 및 랭킹을 가진다.
7. 매 전투마다 전체 랭킹을 재계산하지 않는다.
8. 3,000장 카드 능력을 요청마다 즉석 생성하지 않는다.
9. 전투 로그는 보존 기간과 크기 제한을 둔다.
10. 매칭 큐는 짧은 TTL과 인덱스 기반 조회를 사용한다.
11. 전투 계산은 긴 DB 트랜잭션 안에서 수행하지 않는다.
12. 6GB RAM, 4GB swap 환경에서 백엔드와 MySQL을 함께 운영할 수 있도록 DB 조회, 전투 로그 저장, 랭킹 갱신, 매칭 큐, 컵 시뮬레이션, 관전 조회, 관리자 통계를 모두 저부하 구조로 제한한다.
13. 밴픽과 시즌 로테이션 카드 풀은 도입하지 않는다.
14. 8인 컵은 기본 랭크 MMR과 분리한다.
15. 관리자 통계는 스냅샷/배치 기반으로만 제공한다.




