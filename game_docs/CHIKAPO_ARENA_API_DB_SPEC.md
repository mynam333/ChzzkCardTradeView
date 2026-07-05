# 치카포 아레나 API 및 DB 구현 명세

- 문서 버전: v1.0.0-rebuild
- 기준일: 2026-07-06
- 상위 문서: `CHIKAPO_ARENA_GDD.md`
- 문서 목적: 전면 재구현되는 치카포 아레나의 서버 API, DB 스키마, 상태 전환, 운영 배치 작업을 구현 단위로 확정한다.

---

## 1. 설계 원칙

1. 기존 아레나 API와 테이블은 재사용하지 않는다.
2. 새 테이블은 `arena_v2_` prefix를 사용한다.
3. 공식 모드 전투 결과는 서버만 확정한다.
4. 클라이언트는 행동 의도만 제출하고, 승패/피해/드로우/보상 결과를 제출하지 않는다.
5. 비공개 정보는 항상 참가자별로 마스킹해 응답한다.
6. 상세 리플레이 이벤트는 매치 종료 후 7일 동안만 보존한다.
7. 시즌 정산에 필요한 요약 결과, MMR 변화, 보상 지급 기록은 7일 제한과 별개로 보존한다.
8. 관리자 작업은 모두 감사 로그를 남긴다.
9. 보상 지급, 시즌 전환, MMR 반영은 멱등성을 보장한다.

---

## 2. 공통 타입

```ts
type ArenaMode = 'bot' | 'quick' | 'battle_royale';

type SeasonStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'locked'
  | 'settling'
  | 'closed'
  | 'cancelled';

type MatchStatus =
  | 'created'
  | 'mulligan'
  | 'planning'
  | 'resolving'
  | 'finished'
  | 'cancelled';

type BoardRow = 'front' | 'back';
type BoardColumn = 0 | 1 | 2;

interface BoardPosition {
  row: BoardRow;
  column: BoardColumn;
}

type ArenaTier =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'challenger';
```

---

## 3. DB 스키마

### 3.1. `arena_v2_seasons`

시즌의 생명주기와 운영 설정을 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 시즌 ID |
| `season_key` | text unique | `2026_s1` 같은 운영 키 |
| `name` | text | 유저에게 보이는 시즌명 |
| `status` | text | `SeasonStatus` |
| `starts_at` | timestamptz | 시즌 시작 시각 |
| `ends_at` | timestamptz | 시즌 종료 시각 |
| `modes_enabled` | jsonb | 모드별 활성화 여부 |
| `card_pool_version` | text | 시즌 고정 카드 풀 버전 |
| `balance_version` | text | 시즌 고정 밸런스 버전 |
| `reward_table` | jsonb | 등급별 시즌 종료 보상 |
| `mmr_tier_table` | jsonb | MMR 등급 기준 |
| `replay_retention_days` | int | 기본 7 |
| `created_by` | uuid | 생성 관리자 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

인덱스:

- unique `season_key`
- `(status, starts_at, ends_at)`

제약:

- `active` 시즌은 동시에 1개만 허용한다.
- `replay_retention_days`는 7로 고정하되, 긴급 운영 변경 가능성을 위해 컬럼으로 둔다.

### 3.2. `arena_v2_card_versions`

시즌에 사용되는 카드 버전을 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 카드 버전 ID |
| `streamer_id` | uuid | 스트리머 ID |
| `display_name` | text | 카드명 |
| `season_id` | uuid fk | 시즌 ID |
| `version` | int | 시즌 내 버전 |
| `card_class` | text | 클래스 |
| `cost` | int | 코스트 |
| `attack` | int | 공격력 |
| `health` | int | 체력 |
| `keywords` | jsonb | 키워드와 파라미터 |
| `balance_score` | numeric | 밸런스 검증 점수 |
| `validation_result` | jsonb | 검증기 결과 |
| `art_asset_id` | text nullable | 카드 일러스트 에셋 |
| `status` | text | `draft`, `active`, `disabled` |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

인덱스:

- `(season_id, status)`
- `(streamer_id, season_id)`

제약:

- 같은 시즌 안에서 덱에는 동일 `streamer_id` 카드가 1장까지만 들어갈 수 있다.
- `status='active'`인 카드만 공식 덱에 사용할 수 있다.

### 3.3. `arena_v2_decks`

플레이어 덱을 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 덱 ID |
| `user_id` | uuid | 소유 유저 |
| `season_id` | uuid fk | 대상 시즌 |
| `name` | text | 덱 이름 |
| `mode_scope` | text | `all`, `quick`, `battle_royale`, `bot` |
| `card_version_ids` | uuid[] | 30장 카드 버전 ID |
| `validation_hash` | text | 마지막 검증 결과 해시 |
| `is_valid` | boolean | 공식 대전 사용 가능 여부 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

인덱스:

- `(user_id, season_id)`
- `(season_id, is_valid)`

제약:

- 카드 수는 30장이다.
- 동일 `card_version_id`는 1장까지만 허용한다.
- 동일 `streamer_id`는 1장까지만 허용한다.
- 덱의 모든 카드는 같은 `season_id`의 `active` 카드여야 한다.

### 3.4. `arena_v2_matches`

1:1 전투와 8인전 내부 라운드 전투의 공통 매치 정보를 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 매치 ID |
| `season_id` | uuid fk nullable | 봇전은 nullable 가능 |
| `mode` | text | `ArenaMode` |
| `status` | text | `MatchStatus` |
| `battle_royale_id` | uuid nullable | 8인전 소속 ID |
| `round_no` | int | 8인전 라운드 또는 1:1 턴 묶음 |
| `turn_no` | int | 현재 턴 |
| `rng_seed` | text | 결정론 seed |
| `rules_version` | text | 룰 엔진 버전 |
| `card_pool_version` | text | 카드 풀 버전 |
| `started_at` | timestamptz | 시작 시각 |
| `finished_at` | timestamptz nullable | 종료 시각 |
| `winner_user_id` | uuid nullable | 승자 |
| `result_summary` | jsonb | 승패, 턴 수, MMR 변화 요약 |
| `replay_expires_at` | timestamptz nullable | 종료 후 7일 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

인덱스:

- `(season_id, mode, status)`
- `(battle_royale_id, round_no)`
- `(replay_expires_at)`
- `(finished_at)`

### 3.5. `arena_v2_match_players`

매치 참가자별 공개/비공개 상태 요약을 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 행 ID |
| `match_id` | uuid fk | 매치 ID |
| `user_id` | uuid nullable | 봇이면 nullable 가능 |
| `seat_no` | int | 좌석 번호 |
| `deck_id` | uuid nullable | 사용 덱 |
| `player_health` | int | 현재 플레이어 체력 |
| `initial_deck_order` | uuid[] | 서버 확정 덱 순서 |
| `hand_card_instance_ids` | uuid[] | 현재 손패 |
| `deck_card_instance_ids` | uuid[] | 남은 덱 |
| `graveyard_card_instance_ids` | uuid[] | 묘지 |
| `board_state` | jsonb | 2x3 필드 요약 |
| `mulligan_state` | jsonb | 멀리건 상태 |
| `final_rank` | int nullable | 최종 순위 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

인덱스:

- unique `(match_id, seat_no)`
- `(match_id, user_id)`

응답 원칙:

- 자기 자신에게만 손패와 덱 순서를 반환한다.
- 상대에게는 공개 필드, 공개 묘지, 체력, 남은 손패 수, 남은 덱 수만 반환한다.

### 3.6. `arena_v2_card_instances`

매치 안에서 생성된 카드 인스턴스 상태를 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 카드 인스턴스 ID |
| `match_id` | uuid fk | 매치 ID |
| `owner_seat_no` | int | 소유 좌석 |
| `card_version_id` | uuid fk | 카드 버전 |
| `zone` | text | `deck`, `hand`, `board`, `graveyard`, `removed` |
| `position` | jsonb nullable | 필드 위치 |
| `current_attack` | int | 현재 공격력 |
| `current_health` | int | 현재 체력 |
| `damage_taken` | int | 누적 피해 |
| `status_effects` | jsonb | 일시 효과 |
| `created_turn` | int | 생성 턴 |
| `updated_at` | timestamptz | 수정 시각 |

인덱스:

- `(match_id, owner_seat_no, zone)`
- `(match_id, card_version_id)`

### 3.7. `arena_v2_action_submissions`

턴별 행동 제출 내역을 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 제출 ID |
| `match_id` | uuid fk | 매치 ID |
| `user_id` | uuid | 제출 유저 |
| `seat_no` | int | 좌석 |
| `turn_no` | int | 턴 |
| `revision` | int | 같은 턴 내 제출 버전 |
| `action_payload` | jsonb | 배치, 이동, 교체, 종료 |
| `validation_result` | jsonb | 검증 결과 |
| `is_final` | boolean | 확정 제출 여부 |
| `submitted_at` | timestamptz | 제출 시각 |

인덱스:

- unique `(match_id, seat_no, turn_no, revision)`
- `(match_id, turn_no, is_final)`

### 3.8. `arena_v2_replay_events`

전투 재생용 이벤트를 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | bigserial pk | 이벤트 ID |
| `match_id` | uuid fk | 매치 ID |
| `seq` | int | 매치 내 순번 |
| `turn_no` | int | 턴 |
| `event_type` | text | 이벤트 타입 |
| `payload` | jsonb | 이벤트 데이터 |
| `created_at` | timestamptz | 생성 시각 |
| `expires_at` | timestamptz | 종료 후 7일 |

인덱스:

- unique `(match_id, seq)`
- `(expires_at)`

보존 정책:

- `expires_at < now()`이고 증거 보존 플래그가 없는 이벤트는 삭제한다.
- 삭제 후에도 `arena_v2_matches.result_summary`는 유지한다.

### 3.9. `arena_v2_ratings`

시즌별 빠른대전 MMR을 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 행 ID |
| `season_id` | uuid fk | 시즌 ID |
| `user_id` | uuid | 유저 ID |
| `mmr` | int | 현재 MMR |
| `peak_mmr` | int | 시즌 최고 MMR |
| `tier` | text | 현재 등급 |
| `peak_tier` | text | 시즌 최고 등급 |
| `wins` | int | 승 |
| `losses` | int | 패 |
| `draws` | int | 무 |
| `last_match_id` | uuid nullable | 마지막 반영 매치 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

인덱스:

- unique `(season_id, user_id)`
- `(season_id, mmr desc)`
- `(season_id, peak_mmr desc)`

### 3.10. `arena_v2_reward_grants`

시즌 종료 보상 지급 기록을 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 지급 ID |
| `season_id` | uuid fk | 시즌 ID |
| `user_id` | uuid | 유저 ID |
| `reward_basis` | jsonb | peak MMR, peak tier, 승패 |
| `reward_items` | jsonb | 지급 아이템 |
| `status` | text | `pending`, `held`, `granted`, `failed`, `cancelled` |
| `hold_reason` | text nullable | 보류 사유 |
| `idempotency_key` | text unique | 중복 지급 방지 키 |
| `granted_at` | timestamptz nullable | 지급 시각 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |

인덱스:

- unique `(season_id, user_id)`
- `(season_id, status)`

### 3.11. `arena_v2_battle_royales`

8인전 방과 전체 진행 상태를 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | uuid pk | 8인전 ID |
| `season_id` | uuid fk nullable | 시즌 ID |
| `status` | text | `forming`, `active`, `finished`, `cancelled` |
| `current_round_no` | int | 현재 라운드 |
| `participant_state` | jsonb | 생존, 체력, 순위, 휴식 내역 |
| `match_ids` | uuid[] | 라운드별 매치 ID |
| `winner_user_id` | uuid nullable | 최종 우승자 |
| `created_at` | timestamptz | 생성 시각 |
| `updated_at` | timestamptz | 수정 시각 |
| `finished_at` | timestamptz nullable | 종료 시각 |

인덱스:

- `(season_id, status)`
- `(created_at)`

### 3.12. `arena_v2_admin_audit_logs`

관리자 변경 이력을 저장한다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | bigserial pk | 로그 ID |
| `admin_user_id` | uuid | 관리자 |
| `action` | text | 작업명 |
| `target_type` | text | 대상 타입 |
| `target_id` | text | 대상 ID |
| `before_value` | jsonb nullable | 변경 전 |
| `after_value` | jsonb nullable | 변경 후 |
| `reason` | text nullable | 사유 |
| `created_at` | timestamptz | 생성 시각 |

인덱스:

- `(target_type, target_id)`
- `(admin_user_id, created_at desc)`

---

## 4. 공개 API

모든 API는 인증된 유저 기준이다. 봇전 일부 조회 API는 비로그인 허용 여부를 별도 정책으로 결정할 수 있으나, 공식 기록 저장은 로그인 유저만 허용한다.

### 4.1. 현재 시즌 조회

```http
GET /api/arena/season/current
```

응답:

```ts
interface CurrentSeasonResponse {
  season: {
    id: string;
    seasonKey: string;
    name: string;
    status: SeasonStatus;
    startsAt: string;
    endsAt: string;
    modesEnabled: Record<ArenaMode, boolean>;
    tiers: Array<{ tier: ArenaTier; minMmr: number; rewardPreview: unknown }>;
  } | null;
}
```

### 4.2. 카드 목록 조회

```http
GET /api/arena/cards?seasonId={seasonId}&cursor={cursor}&limit=40
```

필터:

- `class`
- `costMin`
- `costMax`
- `keyword`
- `streamerName`

응답 원칙:

- `active` 카드만 기본 노출한다.
- 관리자 모드에서만 `draft`, `disabled`를 함께 조회할 수 있다.

### 4.3. 덱 목록 조회

```http
GET /api/arena/decks?seasonId={seasonId}
```

응답:

- 덱 이름
- 카드 수
- 유효 여부
- 유효하지 않은 이유
- 최근 수정 시각

### 4.4. 덱 저장

```http
POST /api/arena/decks
```

요청:

```ts
interface SaveDeckRequest {
  deckId?: string;
  seasonId: string;
  name: string;
  modeScope: 'all' | 'quick' | 'battle_royale' | 'bot';
  cardVersionIds: string[];
}
```

검증:

1. 시즌이 `draft`, `scheduled`, `active` 중 하나인지 확인한다.
2. 카드 수가 30장인지 확인한다.
3. 동일 카드 버전이 없는지 확인한다.
4. 동일 스트리머 카드가 1장까지만 있는지 확인한다.
5. 모든 카드가 해당 시즌의 `active` 카드인지 확인한다.
6. 카드 데이터 사전의 비용/키워드 제약을 통과했는지 확인한다.

### 4.5. 덱 검증

```http
POST /api/arena/decks/validate
```

요청은 덱 저장과 동일하지만 저장하지 않는다. 덱 빌더의 실시간 오류 표시에 사용한다.

### 4.6. 매치 생성

```http
POST /api/arena/matches
```

요청:

```ts
interface CreateMatchRequest {
  mode: ArenaMode;
  seasonId?: string;
  deckId: string;
  botDifficulty?: 'beginner' | 'normal' | 'hard' | 'expert';
}
```

처리:

- `bot`: 즉시 봇 매치를 생성한다.
- `quick`: 매칭 큐에 등록하거나 이미 매칭된 상대와 매치를 생성한다.
- `battle_royale`: 8인전 대기열 API 사용을 권장하며, 이 endpoint에서는 직접 생성하지 않는다.

### 4.7. 멀리건 제출

```http
POST /api/arena/matches/{matchId}/mulligan
```

요청:

```ts
interface SubmitMulliganRequest {
  replaceCardInstanceIds: string[];
}
```

제약:

- `mulligan` 상태에서만 가능하다.
- 한 플레이어는 한 번만 제출할 수 있다.
- 제출 대상은 자기 시작 손패 안에 있어야 한다.

### 4.8. 턴 행동 제출

```http
POST /api/arena/matches/{matchId}/turn-action
```

요청:

```ts
interface SubmitTurnActionRequest {
  turnNo: number;
  revision: number;
  isFinal: boolean;
  actions: Array<
    | { type: 'place'; cardInstanceId: string; to: BoardPosition }
    | { type: 'move'; cardInstanceId: string; from: BoardPosition; to: BoardPosition }
    | { type: 'replace'; handCardInstanceId: string; target: BoardPosition }
    | { type: 'end' }
  >;
}
```

서버 검증:

- 현재 상태가 `planning`인지 확인한다.
- 제출 유저가 참가자인지 확인한다.
- `turnNo`가 현재 턴과 일치하는지 확인한다.
- `revision`이 이전 제출보다 큰지 확인한다.
- 코스트, 배치 가능 칸, 이동 가능 카드, 교체 비용을 검증한다.
- 검증 실패 시 현재 임시 제출은 갱신하지 않는다.

### 4.9. 매치 상태 조회

```http
GET /api/arena/matches/{matchId}
```

응답:

```ts
interface MatchStateResponse {
  matchId: string;
  mode: ArenaMode;
  status: MatchStatus;
  turnNo: number;
  serverNow: string;
  deadlineAt?: string;
  self: PlayerView;
  opponentViews: PublicPlayerView[];
  battleLogPreview: unknown[];
}
```

마스킹:

- `self`에는 자기 손패와 덱 수를 포함한다.
- `opponentViews`에는 상대 손패 장수, 덱 장수, 공개 필드만 포함한다.

### 4.10. 리플레이 조회

```http
GET /api/arena/matches/{matchId}/replay
```

응답:

- 리플레이 보존 기간 안이면 이벤트 목록을 반환한다.
- 7일이 지나 삭제된 경우 `ArenaReplayExpired`를 반환하되, 결과 요약은 별도 `matches/{matchId}`에서 조회 가능하게 한다.

### 4.11. 랭킹 조회

```http
GET /api/arena/rankings?seasonId={seasonId}&limit=100
```

응답:

- 순위
- 표시명
- MMR
- 현재 등급
- 시즌 최고 등급
- 승패

### 4.12. 내 보상 조회

```http
GET /api/arena/rewards/current?seasonId={seasonId}
```

응답:

- 현재 MMR
- 현재 등급
- 시즌 최고 등급
- 예상 시즌 종료 보상
- 지급 완료/보류 상태

---

## 5. 8인전 API

### 5.1. 8인전 참가

```http
POST /api/arena/battle-royales/join
```

요청:

```ts
interface JoinBattleRoyaleRequest {
  seasonId?: string;
  deckId: string;
}
```

처리:

- 같은 유저의 중복 대기열 등록을 막는다.
- 8명이 모이면 `arena_v2_battle_royales`를 만들고 첫 라운드 매치를 생성한다.

### 5.2. 8인전 상태 조회

```http
GET /api/arena/battle-royales/{battleRoyaleId}
```

응답:

- 참가자 8명 상태
- 생존 여부
- 현재 체력
- 현재 라운드
- 내 현재 라운드 매치 ID
- 탈락자 최종 순위

### 5.3. 8인전 턴 행동 제출

8인전의 개별 전투 행동 제출은 `POST /api/arena/matches/{matchId}/turn-action`을 재사용한다.

---

## 6. 위키 API

위키는 게임 플레이 룰을 읽기 전용으로 제공한다. 기술 구현 문서는 포함하지 않는다.

### 6.1. 위키 문서 목록

```http
GET /api/arena/wiki
```

응답:

- 문서 ID
- 제목
- 분류
- 상태: `planned`, `active`, `changed`
- 마지막 갱신일

### 6.2. 위키 문서 상세

```http
GET /api/arena/wiki/{slug}
```

응답:

- 제목
- 본문
- 관련 키워드
- 관련 카드
- 관련 문서 링크

제약:

- 일반 유저 수정 API는 제공하지 않는다.
- 관리자 수정은 별도 CMS 또는 관리자 API로만 수행한다.

---

## 7. 관리자 API

관리자 API는 모두 관리자 인증과 감사 로그를 요구한다.

### 7.1. 시즌 생성

```http
POST /api/admin/arena/seasons
```

요청:

```ts
interface CreateSeasonAdminRequest {
  seasonKey: string;
  name: string;
  startsAt: string;
  endsAt: string;
  modesEnabled: Record<ArenaMode, boolean>;
  cardPoolVersion: string;
  balanceVersion: string;
  mmrTierTable: Array<{ tier: ArenaTier; minMmr: number }>;
  rewardTable: Array<{ tier: ArenaTier; items: unknown[] }>;
}
```

### 7.2. 시즌 설정 수정

```http
PATCH /api/admin/arena/seasons/{seasonId}
```

허용:

- `draft`, `scheduled` 상태에서는 대부분 수정 가능하다.
- `active` 상태에서는 종료일 연장, 모드 비활성화, 긴급 공지, 보상 미리보기만 수정 가능하다.
- `locked` 이후에는 보상 지급 관련 작업 외 수정 불가다.

### 7.3. 시즌 상태 전환

```http
POST /api/admin/arena/seasons/{seasonId}/transition
```

요청:

```ts
interface TransitionSeasonRequest {
  toStatus: SeasonStatus;
  reason: string;
}
```

허용 전환:

```text
draft -> scheduled
scheduled -> active
active -> locked
locked -> settling
settling -> closed
draft/scheduled -> cancelled
```

전환 부수 효과:

- `active`: 카드 풀, 밸런스 버전, 등급표를 고정한다.
- `locked`: 새 빠른대전 매칭을 차단하고 진행 중 매치만 완료시킨다.
- `settling`: 보상 산정 job을 시작한다.
- `closed`: 지급 완료 상태를 고정하고 시즌 종료 화면을 노출한다.

### 7.4. 보상 미리보기

```http
GET /api/admin/arena/seasons/{seasonId}/reward-preview
```

응답:

- 등급별 인원
- 총 지급 재화량
- 보류 예상 계정
- 중복 지급 위험 여부

### 7.5. 보상 지급 실행

```http
POST /api/admin/arena/seasons/{seasonId}/grant-rewards
```

요청:

```ts
interface GrantRewardsRequest {
  dryRun: boolean;
  reason: string;
}
```

처리:

- `dryRun=true`이면 지급 기록을 만들지 않고 예상 결과만 반환한다.
- `dryRun=false`이면 `arena_v2_reward_grants`를 생성하고 실제 보상 시스템에 지급 요청한다.
- `idempotency_key`로 중복 지급을 방지한다.

### 7.6. 보상 보류/해제

```http
POST /api/admin/arena/rewards/{grantId}/hold
POST /api/admin/arena/rewards/{grantId}/release
```

용도:

- 어뷰징 의심 계정 보상 보류
- 검토 완료 후 지급 재개

### 7.7. 리플레이 증거 보존

```http
POST /api/admin/arena/matches/{matchId}/replay-hold
```

용도:

- 신고, 어뷰징 조사, 운영 분쟁이 있는 매치의 리플레이 삭제를 일시 정지한다.

### 7.8. Kill switch

```http
POST /api/admin/arena/ops/flags
```

대상:

- 빠른대전 매칭 중지
- 8인전 매칭 중지
- 보상 지급 중지
- 리플레이 조회 중지
- 카드 직접 설정 중지

---

## 8. 에러 코드

| 코드 | HTTP | 의미 |
| --- | --- | --- |
| `ArenaSeasonClosed` | 409 | 시즌이 대전 가능한 상태가 아님 |
| `ArenaModeDisabled` | 409 | 해당 모드가 비활성화됨 |
| `ArenaDeckInvalid` | 400 | 덱이 공식 규칙을 통과하지 못함 |
| `ArenaDuplicateStreamerCard` | 400 | 동일 스트리머 카드가 2장 이상 포함됨 |
| `ArenaCardVersionInvalid` | 400 | 시즌에 사용할 수 없는 카드 버전 |
| `ArenaMatchNotFound` | 404 | 매치를 찾을 수 없음 |
| `ArenaNotParticipant` | 403 | 매치 참가자가 아님 |
| `ArenaInvalidMatchStatus` | 409 | 현재 상태에서 허용되지 않는 행동 |
| `ArenaMulliganAlreadyDone` | 409 | 이미 멀리건을 제출함 |
| `ArenaActionDeadlinePassed` | 409 | 턴 제출 시간이 지남 |
| `ArenaActionValidationFailed` | 400 | 행동이 룰 검증에 실패함 |
| `ArenaActionRevisionConflict` | 409 | 제출 revision이 최신이 아님 |
| `ArenaReplayExpired` | 410 | 리플레이 보존 기간 만료 |
| `ArenaRewardAlreadyGranted` | 409 | 이미 보상이 지급됨 |
| `ArenaRewardHeld` | 409 | 보상이 운영 검토로 보류됨 |

---

## 9. 상태별 허용 행동

| 상태 | 유저 행동 | 관리자 행동 |
| --- | --- | --- |
| `draft` 시즌 | 없음 | 시즌 수정, 예약, 취소 |
| `scheduled` 시즌 | 덱 준비 | 시즌 수정 일부, 오픈, 취소 |
| `active` 시즌 | 대전, 덱 저장, 랭킹 조회 | 모드 중지, 종료 예약, 긴급 공지 |
| `locked` 시즌 | 진행 중 매치 완료, 결과 조회 | 정산 준비 |
| `settling` 시즌 | 결과 조회 | 보상 미리보기, 지급, 보류 |
| `closed` 시즌 | 최종 결과/보상 조회 | 보상 이력 조회 |
| `mulligan` 매치 | 멀리건 제출 | 매치 취소 |
| `planning` 매치 | 행동 제출, 재접속 | 매치 취소 |
| `resolving` 매치 | 상태 조회 | 매치 진단 |
| `finished` 매치 | 결과/리플레이 조회 | 리플레이 보존, 신고 처리 |

---

## 10. MMR 처리

빠른대전 매치 종료 시 서버는 다음 순서로 MMR을 반영한다.

```text
매치 종료
-> result_summary 생성
-> 두 플레이어 rating row 잠금
-> 기존 MMR과 결과로 delta 계산
-> mmr, peak_mmr, tier, peak_tier 갱신
-> last_match_id 기록
-> 랭킹 캐시 갱신 이벤트 발행
-> 매치 finished 확정
```

원칙:

- 같은 매치는 한 번만 MMR에 반영한다.
- 탈주 패배도 일반 패배와 동일하게 MMR에 반영한다.
- 시즌 종료 보상은 `peak_tier` 기준이다.
- 봇전과 8인전은 빠른대전 MMR을 변경하지 않는다.

---

## 11. 리플레이 삭제 배치

실행 주기:

- 1시간마다 실행한다.

처리:

```text
arena_v2_replay_events where expires_at < now()
and match_id not in evidence_hold
-> batch delete
-> 삭제 건수 운영 로그 기록
```

주의:

- `arena_v2_matches.result_summary`는 삭제하지 않는다.
- `arena_v2_action_submissions`는 운영 정책에 따라 리플레이 이벤트와 함께 삭제하거나 요약만 남긴다.
- 신고/분쟁 매치는 `replay-hold`로 삭제 대상에서 제외한다.

---

## 12. 시즌 보상 정산

정산은 `locked -> settling` 전환 이후 실행한다.

```text
시즌 lock
-> 진행 중 빠른대전 종료 대기
-> rating snapshot 생성
-> reward-preview 계산
-> 보류 대상 표시
-> 관리자 dry-run 확인
-> reward_grants 생성
-> 보상 시스템 지급 요청
-> granted/held/failed 상태 기록
-> 시즌 closed 전환
```

멱등성:

- `idempotency_key = arena-season:{seasonId}:user:{userId}`를 사용한다.
- 이미 `granted`인 유저에게 같은 시즌 보상을 다시 지급하지 않는다.
- 실패한 지급은 같은 `idempotency_key`로 재시도한다.

보류 기준:

- 시즌 중 비정상 매칭 패턴
- 탈주/시간 끌기 누적
- 동일 상대 반복 승패 교환
- 운영자가 수동 지정한 계정

---

## 13. 구현 완료 조건

API/DB 구현은 다음 조건을 만족해야 완료로 본다.

1. `arena_v2_` 스키마가 기존 아레나 테이블과 충돌하지 않는다.
2. 덱 검증에서 동일 스트리머 카드 1장 제한을 강제한다.
3. 매치 결과는 서버 시뮬레이터 결과만 저장된다.
4. 상대 비공개 정보가 상태 조회 응답에 노출되지 않는다.
5. 빠른대전 MMR은 같은 매치에 중복 반영되지 않는다.
6. 시즌 종료 보상은 멱등적으로 지급된다.
7. 리플레이 이벤트는 7일 후 삭제된다.
8. 관리자 시즌 상태 전환은 허용된 그래프만 통과한다.
9. 모든 관리자 변경은 감사 로그에 남는다.
10. 주요 API는 통합 테스트와 권한 테스트를 가진다.
