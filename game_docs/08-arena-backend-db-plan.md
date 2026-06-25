# 치카포 아레나 백엔드 및 DB 상세 설계서

## 1. 목적

이 문서는 치카포 아레나의 백엔드 API, DB 스키마, 인덱스, 캐시, 배치 작업, 보존 정책, 부하 제한을 정의한다.

운영 전제:

```text
서버: 백엔드와 MySQL이 같은 서버에서 동작
메모리: 6GB RAM + 4GB swap
목표: 상용 서비스 수준의 기능을 제공하되 DB/백엔드에 과도한 부하를 만들지 않음
```

핵심 원칙:

- 상주 실시간 매치룸을 만들지 않는다.
- 빠른대전은 5판 3선승 세트 매치지만 서버는 매칭 시 덱/시드만 고정하고 각 라운드 커밋 시점에 해당 라운드만 계산한다.
- 매칭 큐는 짧은 TTL, MMR bucket, 인덱스 기반 조회를 사용한다.
- 카드 능력은 요청마다 생성하지 않고 batch로 생성해 저장한다.
- 시즌 로테이션 카드 풀은 사용하지 않는다. 비활성/관리자 제한을 제외한 전체 활성 카드를 대상으로 한다.
- 8인 컵은 별도 큐/워커/테이블로 분리한다.
- 관전은 완료 리플레이/하이라이트 조회로 시작한다.
- 관리자 통계는 스냅샷 테이블을 조회하고 요청 시 대량 집계하지 않는다.
- 랭킹은 실시간 전체 계산이 아니라 스냅샷 기반으로 제공한다.
- 상세 리플레이 로그는 보존 기간과 크기 제한을 둔다.
- 전투 계산은 긴 DB 트랜잭션 안에서 수행하지 않는다.

## 2. 아키텍처 개요

```text
Next.js Client
  -> Express API
    -> Arena Controllers
    -> Arena Services
    -> Arena Repositories
      -> MySQL
```

권장 모듈:

```text
backend/src/controllers/arenaController.ts
backend/src/controllers/adminArenaController.ts
backend/src/services/arenaCardGenerationService.ts
backend/src/services/arenaBattleSimulator.ts
backend/src/services/arenaMatchmakingService.ts
backend/src/services/arenaRatingService.ts
backend/src/services/arenaRankingSnapshotService.ts
backend/src/services/arenaCupService.ts
backend/src/services/arenaSpectatorService.ts
backend/src/services/arenaBalanceStatsSnapshotService.ts
backend/src/repositories/mysql/arena.repository.ts
```

전투 시뮬레이터는 DB에 직접 접근하지 않는다. 필요한 스냅샷을 service가 넘겨주고, simulator는 순수 함수에 가깝게 동작해야 한다.

## 3. 주요 데이터 흐름

### 3.1 카드 생성

1. 관리자 또는 배치가 카드 생성 요청
2. 스트리머 목록 조회
3. opt-out/admin disabled 제외
4. `channel_id` 기반 deterministic generation
5. power score 및 금지 조합 검증
6. chunk 단위 upsert
7. generation log 저장

대량 처리 기준:

```text
GENERATION_CHUNK_SIZE = 100
```

### 3.2 빠른대전

1. 유저가 덱/라운드 플랜 선택
2. 덱 유효성 검증
3. 큐 등록 또는 기존 큐 갱신
4. MMR 범위에 맞는 상대 조회
5. 매칭 성공 시 큐 row 2개를 `MATCHED` 처리
6. 덱/플랜 스냅샷 로드
7. DB 트랜잭션 밖에서 세트 시뮬레이션
8. 짧은 트랜잭션으로 match, battle log, rating 저장
9. match id 반환

### 3.3 리플레이 조회

1. match summary 조회
2. battle log가 존재하면 반환
3. 만료되었으면 summary만 반환

### 3.4 랭킹 조회

1. 최신 snapshot 조회
2. 내 rating은 별도 row 조회
3. 전체 랭킹을 실시간 계산하지 않음

### 3.5 8인 컵

1. 컵 큐 등록 요청
2. 컵 전용 덱/전술 플랜 검증
3. 8명 충족 시 `arena_cups` 생성
4. 참가자 스냅샷 고정
5. 컵 워커가 최대 12세트를 순차 계산
6. 컵 결과, 컵 매치 요약, 컵 포인트 저장
7. 상세 로그는 본인 경기/결승/하이라이트만 제한 저장

### 3.6 관전

1. 완료된 match 또는 cup 조회
2. 토큰 링크 범위와 만료 시각 확인
3. 요약 또는 압축 리플레이 로그 반환
4. 관전자 진행 위치는 서버에 저장하지 않음

### 3.7 관리자 통계

1. 매치 결과는 compact fact로 저장
2. 배치 작업이 클래스/스킬/태그/스탯/전술 칩/전장 규칙 승률을 집계
3. 관리자 화면은 `arena_balance_stat_snapshots`만 조회
4. 운영자가 필요할 때 수동 재생성 API 호출
## 4. 테이블 설계

### 4.1 arena_cards

아레나 카드의 최신 확정 능력.

```sql
CREATE TABLE arena_cards (
  channel_id VARCHAR(128) PRIMARY KEY,
  arena_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  config_source VARCHAR(32) NOT NULL DEFAULT 'AUTO_GENERATED',
  generation_version VARCHAR(32) NOT NULL,
  card_version VARCHAR(64) NOT NULL,
  role_id VARCHAR(64) NOT NULL,
  class_id VARCHAR(64) NOT NULL,
  stat_profile_id VARCHAR(64) NOT NULL,
  active_skill_id VARCHAR(64) NOT NULL,
  passive_skill_id VARCHAR(64) NOT NULL,
  synergy_tags_json JSON NOT NULL,
  base_stats_json JSON NOT NULL,
  power_score DECIMAL(6,2) NOT NULL,
  flavor_text VARCHAR(280) NULL,
  configured_by VARCHAR(128) NULL,
  configured_at DATETIME NULL,
  effective_from_season BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arena_cards_status (arena_status),
  INDEX idx_arena_cards_class (class_id),
  INDEX idx_arena_cards_role (role_id),
  INDEX idx_arena_cards_generation (generation_version)
);
```

### 4.2 arena_card_config_requests

스트리머 카드 설정 요청.

```sql
CREATE TABLE arena_card_config_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  channel_id VARCHAR(128) NOT NULL,
  requested_by VARCHAR(128) NOT NULL,
  requested_config_json JSON NOT NULL,
  validation_result_json JSON NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  reviewed_by VARCHAR(128) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arena_config_requests_channel (channel_id, status),
  INDEX idx_arena_config_requests_status (status, created_at),
  INDEX idx_arena_config_requests_user (requested_by, created_at)
);
```

### 4.3 arena_card_generation_logs

카드 생성 batch 결과.

```sql
CREATE TABLE arena_card_generation_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  generation_version VARCHAR(32) NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  total_cards INT NOT NULL DEFAULT 0,
  generated_count INT NOT NULL DEFAULT 0,
  configured_count INT NOT NULL DEFAULT 0,
  opted_out_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  fallback_count INT NOT NULL DEFAULT 0,
  summary_json JSON NULL,
  created_by VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arena_generation_logs_version (generation_version, created_at)
);
```

### 4.4 arena_seasons

```sql
CREATE TABLE arena_seasons (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  rules_json JSON NOT NULL,
  rules_version VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arena_seasons_status (status, starts_at, ends_at)
);
```

상태:

```text
DRAFT
ACTIVE
ENDED
ARCHIVED
```

### 4.5 arena_card_availability

카드 사용 가능 상태 테이블. 시즌 로테이션 카드 풀을 의미하지 않는다.

```sql
CREATE TABLE arena_card_availability (
  channel_id VARCHAR(128) NOT NULL,
  season_id BIGINT NULL,
  availability_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  disabled_reason VARCHAR(255) NULL,
  updated_by VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, season_id),
  INDEX idx_arena_availability_status (availability_status),
  INDEX idx_arena_availability_season (season_id, availability_status)
);
```

원칙:

- `ACTIVE` 카드는 랭크, 컵, 봇 덱 후보가 될 수 있다.
- `STREAMER_OPTED_OUT`, `ADMIN_DISABLED`, `RULE_DISABLED` 카드는 모든 신규 편성에서 제외한다.
- 주간/시즌 로테이션 하위 풀을 만들지 않는다.

### 4.6 arena_decks

유저 저장 덱.

```sql
CREATE TABLE arena_decks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  season_id BIGINT NOT NULL,
  name VARCHAR(80) NOT NULL,
  cards_json JSON NOT NULL,
  round_plans_json JSON NOT NULL,
  deck_hash VARCHAR(128) NOT NULL,
  validation_status VARCHAR(32) NOT NULL DEFAULT 'VALID',
  validation_result_json JSON NULL,
  last_used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arena_decks_user (user_id, season_id, updated_at),
  INDEX idx_arena_decks_hash (deck_hash),
  INDEX idx_arena_decks_validation (season_id, validation_status)
);
```

주의:

- `cards_json`과 `round_plans_json`은 덱 정의다.
- 실제 매치에는 이 데이터를 다시 snapshot으로 복사해 저장한다.

### 4.7 arena_match_queue

빠른대전 큐.

```sql
CREATE TABLE arena_match_queue (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  season_id BIGINT NOT NULL,
  deck_id BIGINT NOT NULL,
  deck_hash VARCHAR(128) NOT NULL,
  round_plan_hash VARCHAR(128) NOT NULL,
  mmr INT NOT NULL,
  mmr_bucket INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'WAITING',
  queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  matched_match_id BIGINT NULL,
  INDEX idx_arena_queue_match (season_id, status, mmr, queued_at),
  INDEX idx_arena_queue_bucket (season_id, status, mmr_bucket, queued_at),
  INDEX idx_arena_queue_user (user_id, status),
  INDEX idx_arena_queue_expire (expires_at)
);
```

중요:

- 한 유저는 하나의 활성 `WAITING` 큐만 가져야 한다.
- MySQL에서 partial unique index가 어려우므로 application lock 또는 트랜잭션 검증으로 막는다.
- 큐 row는 짧게 살고 자주 정리된다.

### 4.8 arena_matches

세트 매치 요약.

```sql
CREATE TABLE arena_matches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  season_id BIGINT NOT NULL,
  match_type VARCHAR(32) NOT NULL,
  match_format VARCHAR(32) NOT NULL DEFAULT 'BEST_OF_5',
  rounds_to_win TINYINT NOT NULL DEFAULT 3,
  round_count TINYINT NOT NULL,
  player_a_id VARCHAR(128) NOT NULL,
  player_b_id VARCHAR(128) NULL,
  player_a_deck_snapshot_json JSON NOT NULL,
  player_b_deck_snapshot_json JSON NOT NULL,
  player_a_round_plans_json JSON NOT NULL,
  player_b_round_plans_json JSON NOT NULL,
  winner_user_id VARCHAR(128) NULL,
  player_a_round_wins TINYINT NOT NULL DEFAULT 0,
  player_b_round_wins TINYINT NOT NULL DEFAULT 0,
  draw_rounds TINYINT NOT NULL DEFAULT 0,
  match_seed VARCHAR(128) NOT NULL,
  summary_json JSON NOT NULL,
  round_results_json JSON NOT NULL,
  rating_delta_json JSON NULL,
  result_reason VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arena_matches_season_created (season_id, created_at),
  INDEX idx_arena_matches_player_a (player_a_id, created_at),
  INDEX idx_arena_matches_player_b (player_b_id, created_at),
  INDEX idx_arena_matches_winner (season_id, winner_user_id)
);
```

봇전:

- `player_b_id`는 null 가능
- 봇 정보는 `player_b_deck_snapshot_json`과 summary에 포함

### 4.9 arena_match_replays

상세 리플레이 로그는 `arena_matches` 본문과 분리해 저장한다. `arena_matches.replay_json`은 레거시 fallback으로만 유지하고, 신규 저장은 `arena_match_replays`를 사용한다.

MVP에서는 압축 파일 저장까지 가지 않고, 이벤트 수와 바이트 상한을 적용한 JSON을 별도 테이블에 저장한다. 이 구조는 최근 전적, 매치 요약, 랭킹, 관리자 통계가 큰 리플레이 JSON을 읽지 않게 하기 위한 것이다.

```sql
CREATE TABLE arena_match_replays (
  match_id BIGINT NOT NULL PRIMARY KEY,
  replay_json JSON NOT NULL,
  replay_bytes INT NOT NULL DEFAULT 0,
  event_count INT NOT NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arena_match_replays_expire (expires_at)
);
```

보존:

```text
기본: MVP 7일 이하부터 시작. 안정화 후 7~14일
봇전: 기본 저장하지 않음. 필요 시 0~1일
대회/상위권 리플레이: 별도 보존 플래그 추가 가능
```

정리:

- `arena-worker`의 `replay_prune` 작업은 `arena_match_replays`, `arena_cup_replays`, 레거시 inline `replay_json` 만료 데이터를 제한 개수로 삭제한다.
- 기존 `arena_matches.replay_json`에 남은 레거시 데이터는 같은 정리 작업에서 null 처리한다.
- 리플레이 조회는 새 테이블을 먼저 조회하고, 없을 때만 레거시 컬럼을 fallback으로 본다.

### 4.10 arena_player_ratings

```sql
CREATE TABLE arena_player_ratings (
  season_id BIGINT NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  mmr INT NOT NULL DEFAULT 1000,
  rating_points INT NOT NULL DEFAULT 0,
  tier VARCHAR(32) NOT NULL DEFAULT 'BRONZE',
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  streak INT NOT NULL DEFAULT 0,
  last_played_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (season_id, user_id),
  INDEX idx_arena_rating_mmr (season_id, mmr),
  INDEX idx_arena_rating_points (season_id, rating_points),
  INDEX idx_arena_rating_tier (season_id, tier, rating_points)
);
```

### 4.11 arena_rank_snapshots

랭킹 조회용 스냅샷.

```sql
CREATE TABLE arena_rank_snapshots (
  season_id BIGINT NOT NULL,
  rank_type VARCHAR(32) NOT NULL,
  rank_no INT NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  score INT NOT NULL,
  extra_json JSON NULL,
  snapshot_at DATETIME NOT NULL,
  PRIMARY KEY (season_id, rank_type, rank_no),
  INDEX idx_arena_rank_user (season_id, rank_type, user_id),
  INDEX idx_arena_rank_snapshot_at (snapshot_at)
);
```

### 4.12 arena_simulation_runs

밸런스 시뮬레이션 결과.

```sql
CREATE TABLE arena_simulation_runs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  simulation_type VARCHAR(32) NOT NULL,
  generation_version VARCHAR(32) NOT NULL,
  season_id BIGINT NULL,
  match_count INT NOT NULL,
  input_config_hash VARCHAR(128) NOT NULL,
  result_summary_json JSON NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  created_by VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arena_sim_type (simulation_type, created_at),
  INDEX idx_arena_sim_season (season_id, created_at)
);
```

MVP에서는 파일 저장으로 대체 가능하지만, 운영 안정화 후 DB 저장을 권장한다.

### 4.13 arena_cup_replays

8인 컵 상세 리플레이는 `arena_cups` 본문 행과 분리한다. 컵 목록, 관리자 최근 컵, 큐 상태 조회는 이 테이블을 읽지 않는다.

```sql
CREATE TABLE arena_cup_replays (
  cup_id BIGINT NOT NULL PRIMARY KEY,
  replay_json JSON NOT NULL,
  replay_bytes INT NOT NULL DEFAULT 0,
  event_count INT NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_arena_cup_replays_expire (expires_at)
);
```

### 4.14 arena_cups

```sql
CREATE TABLE arena_cups (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  season_id BIGINT NOT NULL,
  cup_type VARCHAR(32) NOT NULL DEFAULT 'EIGHT_PLAYER',
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  participant_count TINYINT NOT NULL DEFAULT 8,
  rules_json JSON NOT NULL,
  winner_user_id VARCHAR(128) NULL,
  summary_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_arena_cups_status (season_id, status, created_at)
);
```

### 4.14 arena_cup_entries

```sql
CREATE TABLE arena_cup_entries (
  cup_id BIGINT NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  seed_no TINYINT NOT NULL,
  deck_snapshot_json JSON NOT NULL,
  strategy_plan_snapshot_json JSON NOT NULL,
  final_rank TINYINT NULL,
  cup_points_delta INT NOT NULL DEFAULT 0,
  PRIMARY KEY (cup_id, user_id),
  INDEX idx_arena_cup_entries_user (user_id, cup_id)
);
```

### 4.15 arena_cup_matches

```sql
CREATE TABLE arena_cup_matches (
  cup_id BIGINT NOT NULL,
  match_id BIGINT NOT NULL,
  bracket_round TINYINT NOT NULL,
  placement_group VARCHAR(16) NOT NULL,
  player_a_id VARCHAR(128) NOT NULL,
  player_b_id VARCHAR(128) NOT NULL,
  winner_user_id VARCHAR(128) NULL,
  summary_json JSON NOT NULL,
  PRIMARY KEY (cup_id, match_id),
  INDEX idx_arena_cup_matches_round (cup_id, bracket_round)
);
```

### 4.16 arena_spectator_links

```sql
CREATE TABLE arena_spectator_links (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  match_id BIGINT NULL,
  cup_id BIGINT NULL,
  visibility VARCHAR(32) NOT NULL DEFAULT 'PRIVATE',
  token_hash VARCHAR(128) NULL,
  created_by VARCHAR(128) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_arena_spectator_match (match_id, visibility),
  INDEX idx_arena_spectator_cup (cup_id, visibility),
  INDEX idx_arena_spectator_expires (expires_at)
);
```

### 4.17 arena_balance_stat_snapshots

```sql
CREATE TABLE arena_balance_stat_snapshots (
  season_id BIGINT NOT NULL,
  snapshot_type VARCHAR(64) NOT NULL,
  metric_key VARCHAR(191) NOT NULL,
  sample_count INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  win_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  payload_json JSON NULL,
  snapshot_at DATETIME NOT NULL,
  PRIMARY KEY (season_id, snapshot_type, metric_key),
  INDEX idx_arena_balance_snapshot_at (snapshot_at),
  INDEX idx_arena_balance_win_rate (season_id, snapshot_type, win_rate)
);
```

요청 시 이 테이블을 조회한다. 관리자 화면에서 `arena_matches` 전체를 직접 `GROUP BY` 하면 안 된다.
## 5. API 설계

### 5.1 공개/유저 API

```text
GET  /api/arena/seasons/current
GET  /api/arena/cards
GET  /api/arena/cards/{card_id}
GET  /api/arena/cards/availability

GET  /api/arena/decks
POST /api/arena/decks
GET  /api/arena/decks/:id
PUT  /api/arena/decks/:id
DELETE /api/arena/decks/:id
POST /api/arena/decks/:id/validate

POST /api/arena/matchmaking/quick/join
GET  /api/arena/matchmaking/quick/status
GET  /api/arena/matchmaking/quick/events
POST /api/arena/matchmaking/quick/cancel

POST /api/arena/matches/bot-practice
GET  /api/arena/matches/:match_id
GET  /api/arena/matches/:match_id/replay

GET  /api/arena/me/rating
GET  /api/arena/rankings
GET  /api/arena/me/history

POST /api/arena/cups/queue/join
GET  /api/arena/cups/queue/status
GET  /api/arena/cups/queue/events
POST /api/arena/cups/queue/cancel
GET  /api/arena/cups/:cup_id  # 로그인한 참가자 또는 관리자만
GET  /api/arena/cups/:cup_id  # 로그인한 참가자 또는 관리자만/replay

```

### 5.2 스트리머 API

```text
GET   /api/arena/streamer-card/me
PATCH /api/arena/streamer-card/me
POST  /api/arena/streamer-card/me/disable
POST  /api/arena/streamer-card/me/enable
```

### 5.3 관리자 API

```text
GET  /api/admin/arena/cards
POST /api/admin/arena/cards/generate
GET  /api/admin/arena/cards/generation-report
POST /api/admin/arena/cards/{card_id}/regenerate
PATCH /api/admin/arena/cards/{card_id}

GET  /api/admin/arena/config-requests
POST /api/admin/arena/config-requests/:id/approve
POST /api/admin/arena/config-requests/:id/reject

POST /api/admin/arena/seasons
POST /api/admin/arena/seasons/:id/card-availability/rebuild

POST /api/admin/arena/rankings/rebuild
POST /api/admin/arena/matches/prune-logs
GET  /api/admin/arena/matchmaking/stats
POST /api/admin/arena/simulations/run
GET  /api/admin/arena/stats/overview
GET  /api/admin/arena/stats/balance
POST /api/admin/arena/stats/rebuild
GET  /api/admin/arena/cups
POST /api/admin/arena/cups/kill-switch
POST /api/admin/arena/spectator/kill-switch
POST /api/admin/arena/rules/strategy-chip/:id/disable
POST /api/admin/arena/rules/battlefield/:id/disable
```

## 6. 매칭 큐 처리

### 6.1 큐 등록

처리:

1. 로그인 확인
2. 현재 시즌 확인
3. 덱 소유권 확인
4. 덱 validation 확인
5. 기존 WAITING 큐 취소 또는 재사용
6. rating 조회
7. 큐 row 생성
8. 즉시 매칭 시도

큐 TTL:

```text
QUEUE_TTL_SECONDS = 60
```

연결 끊김 처리:

- 브라우저 종료나 네트워크 단절만으로 즉시 큐 row를 갱신하지 않는다.
- 활성 `WAITING` row는 TTL, 명시 취소, 다음 상태 조회, 소량 정리 배치로만 정리한다.
- 연결 종료 이벤트마다 DB write를 발생시키면 부하와 lock 경합이 커지므로 금지한다.
- 같은 유저의 새 큐 등록 시 기존 `WAITING` row가 있으면 만료 여부를 확인한 뒤 재사용, 취소, 또는 교체한다.

### 6.2 상대 조회

MMR 범위:

```text
0~10초: ±100
10~20초: ±150
20~40초: ±250
40초 이후: ±400
```

쿼리 조건:

```text
season_id = current
status = WAITING
user_id != self
mmr_bucket IN candidate_buckets
mmr BETWEEN min AND max
expires_at > now
```

정렬:

```text
queued_at
```

주의:

- `ABS(mmr - my_mmr)` 정렬은 인덱스 효율이 낮으므로 MVP 기본 매칭에 사용하지 않는다.
- 먼저 `mmr_bucket`과 `mmr BETWEEN`으로 후보를 좁히고 limit를 작게 둔다.
- 같은 bucket을 먼저 조회하고, 대기 시간이 길어질 때만 인접 bucket으로 확장한다.
- 후보 20개 이내에서 애플리케이션 메모리로 최종 근접도를 계산한다.

### 6.3 동시 매칭 방지

두 요청이 같은 큐 엔트리를 동시에 잡지 않도록 해야 한다.

권장:

- 트랜잭션 안에서 후보 row를 상태 변경
- MySQL 8이면 `SELECT ... FOR UPDATE SKIP LOCKED` 고려
- 지원이 불명확하면 `UPDATE ... WHERE status='WAITING'` 결과 row count로 성공 판정

처리 예:

```text
1. 후보 queue id 선택
2. UPDATE arena_match_queue SET status='MATCHED' WHERE id IN (...) AND status='WAITING'
3. affected rows가 2일 때만 매칭 성공
4. 아니면 재시도 또는 대기
```

### 6.4 이탈 안전 매칭 확정

매칭 확정은 클라이언트 세션이 아니라 DB 상태 전환을 기준으로 한다.

필수 처리:

1. 두 큐 row를 `MATCHED`로 원자 전환한다.
2. `matched_match_id`를 양쪽 큐 row에 저장한다.
3. 양쪽 덱과 라운드 플랜 스냅샷을 match row에 저장한다.
4. DB 트랜잭션 밖에서 세트 전투를 계산한다.
5. 결과와 rating delta를 저장한다.

이탈 안전 조건:

- `MATCHED` 이후에는 cancel API가 match를 취소할 수 없다.
- status API는 `matched_match_id`를 재반환해 재접속 복구를 지원한다.
- 상대가 접속하지 않아도 내 결과 조회와 리플레이 조회는 가능해야 한다.
- 리플레이 시청 상태를 DB에 실시간 저장하지 않는다.
- 시청 완료 여부가 보상 조건이 되면 이탈 UX가 나빠지므로 MVP에서는 사용하지 않는다.

## 7. 전투 시뮬레이션 처리

### 7.1 DB 접근 범위

전투 계산 전에 조회:

- match 참가자
- 덱 스냅샷
- 카드 능력 스냅샷
- 라운드 플랜

전투 계산 중:

- DB 접근 금지

전투 계산 후 저장:

- arena_matches
- arena_battle_logs
- arena_player_ratings
- arena_match_queue 상태

### 7.2 트랜잭션 범위

긴 전투 계산을 트랜잭션 안에 넣으면 안 된다.

권장:

```text
Transaction A: 큐 매칭 확정
DB 밖: 세트 전투 계산
Transaction B: match/log/rating 저장
```

전투 계산 실패 시:

- match row를 만들지 않거나
- `FAILED` 상태를 저장하고 큐를 정리

### 7.3 CPU 제한

시뮬레이터 제한값:

```text
MAX_ROUNDS_PER_MATCH = 5
MAX_ROUND_TICKS = 180
MAX_MATCH_TICKS = 900
MAX_EVENTS_PER_MATCH = 2400
MAX_MATCH_LOG_BYTES = 320KB
```

시뮬레이션 시간이 일정 기준을 넘으면 match를 실패 처리하고 로그를 남긴다.

## 8. 랭킹 스냅샷

### 8.1 갱신 방식

랭킹은 실시간 계산하지 않는다.

권장 갱신:

```text
상위 랭킹 스냅샷: 5분마다. 부하 시 15분 이상으로 증가
전체 랭킹 스냅샷: MVP에서는 60분 또는 수동. 시즌 종료 정산 시 별도 생성
내 정보 rating: 즉시 row 조회
```

MVP에서는 상위 1000명만 snapshot으로 시작한다. 전체 랭킹은 정식 시즌 안정화 후 확장한다.

### 8.2 스냅샷 생성

```sql
SELECT user_id, rating_points
FROM arena_player_ratings
WHERE season_id = ?
ORDER BY rating_points DESC
LIMIT 1000;
```

생성 후 기존 snapshot을 교체한다.

교체 방식:

- 임시 메모리에서 rank 계산
- 기존 `rank_type` 삭제
- batch insert

주의:

- 큰 트랜잭션을 피한다.
- snapshot row 수를 제한한다.

## 9. 캐시 전략

### 9.1 메모리 캐시 대상

서버 메모리 6GB 환경이므로 캐시는 작고 명확해야 한다.

캐시 대상:

- 현재 시즌 정보
- 전체 활성 카드 사용 가능 상태
- arena card definitions
- 클래스/스킬/태그 정적 정의
- 봇 덱 템플릿

캐시하지 않을 것:

- 전체 리플레이 로그
- 전체 랭킹
- 전체 유저 rating
- 오래된 카드 사용 가능 상태 전체

### 9.2 TTL

권장:

```text
currentSeasonCache: 30~60초
cardPoolCache: 5~10분 또는 version invalidation
staticDefinitions: 서버 시작 후 고정
botDeckTemplates: 5~10분
rankingSnapshotCache: 30~60초
```

### 9.3 무효화

무효화 이벤트:

- 시즌 변경
- 카드 풀 재생성
- 카드 opt-out
- 관리자 disable
- generation version 변경
- 스킬/태그 정의 변경 후 배포

## 10. 배치 작업

필수 배치:

```text
arena:expire-queue
arena:prune-battle-logs
arena:refresh-rank-snapshots
arena:refresh-balance-stat-snapshots
arena:expire-spectator-links
arena:generate-card-availability
arena:finish-season
```

### 10.1 큐 만료

주기:

```text
30초~1분
```

처리:

```sql
UPDATE arena_match_queue
SET status = 'EXPIRED'
WHERE status = 'WAITING'
  AND expires_at < NOW()
LIMIT 500;
```

### 10.2 리플레이 로그 삭제

주기:

```text
1시간마다
```

처리:

```sql
DELETE FROM arena_battle_logs
WHERE expires_at < NOW()
LIMIT 500;
```

반복 실행하되 한 번에 너무 많이 지우지 않는다.

### 10.3 랭킹 스냅샷

주기:

```text
5분~30분
```

시즌 초반/피크 시간에는 5분, 일반 시간에는 15분 이상도 가능하다.

## 11. Rate Limit

API별 제한 권장:

```text
quick join: 유저당 10초 1회
matchmaking/quick/status: 유저당 3초 1회
matchmaking/quick/events: 큐 대기 중 일시 SSE 연결, 매칭/취소/만료 후 서버 종료
cancel: 유저당 10초 2회
bot-practice: 유저당 10분 10회
replay 조회: 유저당 10초 3회
deck validate: 유저당 10초 3회
card list: 사용자당 10초 3회, IP당 60회/분, 캐시 권장
ranking: 사용자당 10초 2회, IP당 60회/분, 캐시 권장
```

봇전은 전투 시뮬레이션을 실행하므로 반드시 제한한다.

## 12. 실패 및 복구 정책

### 12.1 매칭 중 실패

가능한 실패:

- 상대 큐가 이미 매칭됨
- 덱이 비활성 카드 포함
- 시즌 종료
- 전투 계산 실패

처리:

- 큐 상태를 명확히 정리
- 유저에게 재시도 가능 메시지 제공
- 실패 match가 MMR에 반영되지 않도록 함

### 12.2 전투 로그 저장 실패

match summary와 rating 저장이 성공했지만 log 저장이 실패할 수 있다.

정책:

- match summary는 유지
- 리플레이는 제공하지 못할 수 있음
- 사용자에게 결과 화면은 제공
- 오류 로그와 관리자 통계에 기록

### 12.3 rating 업데이트 실패

rating 업데이트 실패는 랭크 무결성 문제다.

정책:

- match/rating 저장은 같은 트랜잭션으로 처리
- rating 실패 시 match도 실패 처리 또는 재시도
- 중복 반영 방지를 위한 match id 기반 idempotency 필요

## 13. Idempotency

중복 요청에 대비한다.

필요 대상:

- quick join
- bot-practice
- match result save 내부 처리
- config request
- opt-out/opt-in

권장:

- 클라이언트 요청 id
- 서버 match id
- unique key 또는 처리 로그

MVP에서는 quick join과 match save에 우선 적용한다.

## 14. 보안 및 악용 방지

검증:

- 덱 소유권
- 카드 풀 포함 여부
- 비활성 카드 사용 여부
- 라운드 플랜 좌표
- 같은 스트리머 중복
- match 접근 권한
- replay 접근 권한. 공개 여부 정책 필요

악용 대응:

- 큐 저격 방지: 반복 매칭 제한
- 다계정 어뷰징 감시: 같은 상대 반복 기록
- 봇전 스팸 제한
- replay scraping 제한
- 관리자 액션 감사 로그

## 15. 관리자 통계

관리자가 볼 수 있어야 하는 값:

- 현재 큐 대기 수
- 평균 매칭 시간
- 매칭 실패율
- 봇전 실행 수
- 평균 전투 계산 시간
- p95 전투 계산 시간
- 평균 로그 크기
- 로그 삭제량
- 랭킹 스냅샷 갱신 시각
- 카드 opt-out 수
- 에러 발생률

## 16. 성능 목표

초기 목표:

```text
quick join API p95: 300ms 이하. 매칭/계산 포함 시 예외 가능
status API p95: 150ms 이하
ranking API p95: 200ms 이하
card list API p95: 300ms 이하. 캐시 전제
bot-practice p95: 800ms 이하
set simulation p95: 500ms 이하
set simulation p99: 1200ms 이하
ranked simulation workers: 1~2
bot simulation workers: 0~1
```

실측 후 조정한다.

## 17. MVP 구현 순서

1. 정적 class/skill/tag definition 작성
2. arena_cards 생성 batch
3. arena_seasons/card_availability
4. arena_decks 저장/검증
5. arenaBattleSimulator 순수 함수 구현
6. bot-practice API
7. arena_player_ratings
8. quick join matchmaking
9. arena_matches/battle_logs 저장
10. replay 조회
11. ranking snapshot
12. admin 관리 API
13. prune/expire batch
14. cup queue/service
15. spectator replay links
16. admin stats snapshots/page

봇전 API를 빠른대전보다 먼저 만드는 이유:

- 매칭 큐 없이 전투 엔진 검증 가능
- 부하 측정 가능
- 리플레이 UI 개발 가능

## 18. 반드시 지켜야 할 결정 사항

1. 5판 3선승 세트 매치는 서버가 짧게 계산하고 종료한다.
2. 서버는 매치 상태를 7~12분 동안 메모리에 들고 있지 않는다.
3. 전투 계산 중 DB 접근을 하지 않는다.
4. match summary와 rating 업데이트는 원자적으로 처리한다.
5. 랭킹은 스냅샷 기반으로 제공한다.
6. 상세 리플레이 로그는 보존 기간과 크기 제한을 둔다.
7. 큐는 짧은 TTL과 인덱스 기반 조회를 사용한다.
8. 카드 능력은 요청마다 생성하지 않는다.
9. 봇전도 rate limit 대상이다.
10. 6GB RAM + MySQL 동시 운영 환경을 넘는 구조는 MVP에 넣지 않는다.
11. 시즌 로테이션 카드 풀과 밴픽은 구현하지 않는다.
12. 8인 컵은 별도 큐/워커로 제한 운영한다.
13. 관전은 완료 리플레이/하이라이트 조회로 시작한다.
14. 관리자 통계는 스냅샷 테이블 기반으로 조회한다.


























