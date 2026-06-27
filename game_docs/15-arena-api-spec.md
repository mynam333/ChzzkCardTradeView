# 치카포 아레나 API 명세

## 1. 목적

이 문서는 치카포 아레나 MVP와 정식 시즌에 필요한 API의 책임, 요청/응답 구조, 보안 기준, 부하 제한 기준을 정의한다.

아레나 API 설계 원칙:

- 전투 결과는 서버만 확정한다.
- 클라이언트는 전투 결과를 제출하지 않는다.
- 빠른대전은 5판 3선승 세트 매치다.
- 서버는 실시간 상주 매치룸을 만들지 않는다.
- 매치 시작 시 덱 스냅샷과 전장만 고정하고, 각 라운드 시작 전 유저가 전술 성향, 타겟 우선순위, 전술 칩을 다시 선택할 수 있다.
- 밴픽과 시즌 로테이션 카드 풀은 API 범위에 포함하지 않는다.
- 8인 컵, 완료 리플레이 관전, 관리자 통계 스냅샷 API를 제공한다.
- MMR과 랭킹은 아레나 전용으로 관리한다.
- 치카포 시세, 후원, 방송 상태, 포인트, 보유 카드 수는 전투력에 사용하지 않는다.
- API는 MySQL과 백엔드가 같은 저사양 서버에서 안정적으로 동작해야 한다.

## 2. 공통 규칙

### 2.1 인증

로그인이 필요한 API는 기존 치카포 인증 세션 또는 토큰을 사용한다.

권한 구분:

```text
guest: 공개 카드/랭킹 조회
user: 덱, 매칭, 리플레이, 본인 전적
streamer_owner: 본인 스트리머 카드 설정
arena_admin: 운영자 관리 기능
```

### 2.2 응답 형식

```json
{
  "ok": true,
  "data": {},
  "request_id": "req_..."
}
```

오류 응답:

```json
{
  "ok": false,
  "error": {
    "code": "ARENA_QUEUE_DISABLED",
    "message": "현재 빠른대전을 사용할 수 없습니다.",
    "retry_after_sec": 60
  },
  "request_id": "req_..."
}
```

### 2.3 공통 오류 코드

| 코드 | 의미 |
| --- | --- |
| `ARENA_DISABLED` | 아레나 전체 비활성화 |
| `ARENA_QUEUE_DISABLED` | 빠른대전 대기열 비활성화 |
| `ARENA_BOT_DISABLED` | AI 연습게임 비활성화 |
| `ARENA_REPLAY_DISABLED` | 리플레이 조회 비활성화 |
| `ARENA_RANKING_DISABLED` | 랭킹 조회 비활성화 |
| `ARENA_SEASON_NOT_FOUND` | 시즌 없음 |
| `ARENA_DECK_INVALID` | 덱 검증 실패 |
| `ARENA_DECK_VERSION_EXPIRED` | 카드/스킬 버전 만료 |
| `ARENA_MATCH_NOT_FOUND` | 매치 없음 |
| `ARENA_MATCH_NOT_ACCESSIBLE` | 조회 권한 없음 |
| `ARENA_RATE_LIMITED` | 호출 제한 |
| `ARENA_STREAMER_CARD_DISABLED` | 스트리머 카드 비활성화 |
| `ARENA_ADMIN_REQUIRED` | 관리자 권한 필요 |

### 2.4 Rate Limit

권장 제한:

| API | 제한 |
| --- | ---: |
| 카드 목록 조회 | 사용자당 10초 3회 |
| 덱 저장 | 사용자당 10초 2회 |
| 빠른대전 참가 | 사용자당 10초 1회 |
| 매칭 상태 조회/SSE 연결 | 상태 조회는 사용자당 3초 1회, SSE는 큐 대기 중 일시 연결 |
| 리플레이 조회 | 사용자당 10초 3회 |
| 공개 전적 명함 조회 | 사용자당 10초 4회 |
| 랭킹 조회 | 사용자당 10초 2회 |
| 스트리머 카드 설정 저장 | 채널당 1분 3회 |

매칭 상태는 큐 대기 중 SSE를 우선 사용하고, HTTP 상태 조회는 재접속과 fallback에 사용한다. HTTP fallback 폴링 간격은 클라이언트에서 3초 이상으로 제한한다.

## 3. 공통 타입

### 3.1 ArenaCard

```json
{
  "card_id": "arena_streamer_ch_...",
  "channel_id": "ch_...",
  "name": "스트리머명",
  "image_url": "https://...",
  "flavor_text": "전열을 지키는 카드",
  "arena_enabled": true,
  "class": {
    "id": "guardian",
    "name": "가디언",
    "role": "frontline"
  },
  "stats": {
    "hp": 64,
    "attack": 52,
    "defense": 76,
    "speed": 45,
    "focus": 63
  },
  "skills": [
    { "id": "aegis-pop", "name": "방울 방패", "type": "active" }
  ],
  "tags": ["guardian", "tempo"],
  "ability_seed": "9c1...",
  "config_source": "streamer_config"
}
```

`source` 값:

```text
streamer_config
deterministic_template
admin_override
```

### 3.2 ArenaDeck

```json
{
  "deck_id": "deck_...",
  "name": "기본 덱",
  "cards": [
    {
      "slot": 1,
      "card_id": "arena_card_..."
    }
  ],
  "round_plans": [
    {
      "round_no": 1,
      "formation_id": "frontline_default",
      "focus_rule": "lowest_hp",
      "target_priority": "damage_dealer",
      "skill_timing_rule": "early_pressure"
    }
  ],
  "updated_at": "2026-06-24T00:00:00+09:00"
}
```

### 3.3 MatchSummary

```json
{
  "match_id": "match_...",
  "season_id": "season_...",
  "match_format": "best_of_3",
  "rounds_to_win": 2,
  "round_count": 3,
  "result": "win",
  "winner_user_id": "user_...",
  "round_results": [
    {
      "round_no": 1,
      "winner_side": "blue",
      "duration_ms": 52400
    }
  ],
  "rating_delta": 18,
  "created_at": "2026-06-24T00:00:00+09:00"
}
```

주의:

- `match_seed`와 `round_seed` 원본은 일반 API에 노출하지 않는다.
- 클라이언트는 `winner_user_id`, `rating_delta` 등을 제출할 수 없다.

## 4. 시즌 API

### GET `/api/arena/seasons/current`

현재 시즌 정보를 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "season_id": "season_2026_01",
    "name": "프리시즌",
    "status": "active",
    "starts_at": "2026-06-24T00:00:00+09:00",
    "ends_at": "2026-07-24T00:00:00+09:00",
    "match_format": "best_of_3",
    "rounds_to_win": 2
  }
}
```

### GET `/api/arena/system-status`

아레나 기능별 사용 가능 여부를 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "arena_enabled": true,
    "quick_match_enabled": true,
    "bot_match_enabled": true,
    "replay_enabled": true,
    "ranking_enabled": true,
    "message": null
  }
}
```

### GET `/api/arena/rules/catalog`

클라이언트가 전술 칩, 전장 규칙, 클래스/스킬 정의를 같은 버전으로 렌더링하기 위한 규칙 카탈로그를 조회한다.

응답:

```json
{
  "version": "arena-rules-v1",
  "classes": [],
  "skills": [],
  "tactic_chips": [],
  "battlefield_rules": [],
  "forbidden_combat_fields": []
}
```

부하 기준:

- public cache 대상이다.
- 매치 중 실시간으로 조회하지 않고 화면 진입/새로고침 시에만 조회한다.

## 5. 카드 API

### GET `/api/arena/cards`

카드 목록을 페이지 단위로 조회한다.

쿼리:

```text
page
limit
role
class_id
tag
search
enabled_only
```

응답:

```json
{
  "ok": true,
  "data": {
    "items": [],
    "page": 1,
    "limit": 50,
    "total": 2980
  }
}
```

부하 기준:

- 기본 `limit`은 50 이하.
- 최대 `limit`은 100 이하.
- 검색은 인덱스 가능한 컬럼 위주로 제한한다.
- 카드 상세 능력은 캐시한다.

### GET `/api/arena/cards/{card_id}`

카드 상세 정보를 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "card": {}
  }
}
```

### GET `/api/arena/cards/owned`

로그인한 유저가 실제 보유 중인 스트리머 카드만 아레나 카드북 형태로 조회한다.
임시 카드나 목업 카드는 반환하지 않는다.

쿼리:

```text
limit
```

응답:

```json
{
  "ok": true,
  "data": {
    "items": [],
    "total_owned_streamers": 0
  }
}
```

## 6. 덱 API

### GET `/api/arena/decks`

본인 덱 목록을 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "items": []
  }
}
```

### POST `/api/arena/decks`

덱을 생성한다. 클라이언트는 보유 카드 중 덱에 넣을 카드 ID만 전송한다. 라운드별 출전, 배치, 전술 선택은 매치 생성 후 인게임 라운드 선택 API에서 처리한다.

요청:

```json
{
  "name": "랭킹 덱",
  "card_ids": [
    "arena_streamer_channel_a",
    "arena_streamer_channel_b",
    "arena_streamer_channel_c",
    "arena_streamer_channel_d",
    "arena_streamer_channel_e",
    "arena_streamer_channel_f"
  ],
  "strategy_chip_id": "none"
}
```

서버 검증:

- 요청 유저의 보유 카드 여부
- 덱 카드 수 6~10장
- 중복 카드 제한
- 비활성화 카드 포함 여부
- 카드 버전 유효성
- 전술 칩 1개 제한
- 시즌 로테이션 카드 풀 참조 금지
- 금지 조합 여부

서버는 `round_plans`가 없으면 내부 fallback용 기본 플랜을 생성한다. 이 플랜은 인게임 라운드 선택 타이머 만료와 재접속 보호를 위한 값이며, 사전 라운드 플랜 편집 UI로 노출하지 않는다.

### PATCH `/api/arena/decks/{deck_id}`

덱을 수정한다.

주의:

- 매칭 대기 중인 덱은 수정할 수 없다.
- 매치 시작 후 덱 변경은 해당 매치에 반영되지 않는다.

### DELETE `/api/arena/decks/{deck_id}`

덱을 삭제한다.

주의:

- 최근 매치의 스냅샷은 삭제하지 않는다.
- 스냅샷은 리플레이와 전적 검증을 위해 별도 보관한다.

## 7. 매칭 API

### POST `/api/arena/matchmaking/quick/join`

빠른대전에 참가한다.

요청:

```json
{
  "deck_id": "deck_..."
}
```

응답:

```json
{
  "ok": true,
  "data": {
    "queue_ticket_id": "qt_...",
    "status": "queued",
    "poll_after_sec": 3
  }
}
```

서버 처리:

- 덱 스냅샷 생성
- 라운드별 전술 계획 해시 저장
- MMR 범위 기반 상대 검색
- 매칭 성사 시 진행 중인 랭크 매치와 덱 스냅샷, 전장 규칙만 생성
- 각 라운드 결과는 `POST /api/arena/matches/{match_id}/rounds/commit`에서 서버가 확정
- 마지막 라운드가 끝날 때 결과와 MMR을 반영
- 참가자가 선택 타이머 안에 입력하지 않아도 기본 플랜으로 자동 진행

### GET `/api/arena/matchmaking/quick/status`

대기 상태를 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "status": "queued",
    "queue_ticket_id": "qt_...",
    "elapsed_sec": 12,
    "poll_after_sec": 3
  }
}
```

매칭 완료 응답:

```json
{
  "ok": true,
  "data": {
    "status": "matched",
    "match_id": "match_...",
    "resume_available": true,
    "poll_after_sec": null
  }
}
```

상태 조회는 재접속 복구 경로이기도 하다. 유저의 최근 큐가 `MATCHED`이고 `matched_match_id`가 있으면 클라이언트가 이전 요청의 응답을 받지 못했더라도 같은 match id를 반환해야 한다.

### GET `/api/arena/matchmaking/quick/events`

빠른대전 큐 대기 중 상태 변경을 받는 일시 SSE 엔드포인트다. 매칭, 취소, 만료 후 서버가 연결을 닫는다. PM2 cluster나 다중 API 인스턴스에서는 sticky routing 또는 외부 pub/sub 도입 전까지 즉시성을 운영 보장으로 선언하지 않는다.

추가 상태:

```text
queued: 아직 상대 없음
matched: 매칭 완료, match_id 조회 가능
cancelled: 유저가 매칭 전 취소
expired: TTL 만료
none: 활성 큐 없음
```

### POST `/api/arena/matchmaking/quick/cancel`

빠른대전 대기를 취소한다.

취소 규칙:

- `WAITING` 상태에서만 취소된다.
- 이미 `MATCHED` 상태면 취소하지 않고 `match_id`와 `resume_available=true`를 반환한다.
- 클라이언트 연결 종료를 취소 요청으로 간주하지 않는다.
- 반복 취소는 큐 쿨다운 정책에만 사용하고 매치 패배로 처리하지 않는다.

응답:

```json
{
  "ok": true,
  "data": {
    "status": "cancelled"
  }
}
```

## 8. AI 연습게임 API

### POST `/api/arena/bot-matches`

AI 봇 상대 연습게임을 생성한다. 이 시점에는 세트 승패를 계산하지 않고, 1라운드 선택 대기 상태의 매치만 만든다.

요청:

```json
{
  "deck_id": "deck_...",
  "difficulty": "normal"
}
```

응답:

```json
{
  "ok": true,
  "data": {
    "match_id": "match_...",
    "result": "draw",
    "round_count": 0,
    "match": {
      "id": "match_...",
      "summary": {
        "progress_status": "in_progress",
        "current_round_no": 1,
        "rounds_to_win": 3,
        "max_rounds": 5
      }
    }
  }
}
```

정책:

- 봇전은 MMR에 반영하지 않는다.
- 봇전은 랭킹 보상 조건에 반영하지 않는다.
- 봇전 상세 로그는 짧게 보관하거나 저장하지 않을 수 있다.
- 라운드별 확정은 아래 라운드 커밋 API로만 수행한다.

### POST `/api/arena/matches/{match_id}/rounds/commit`

진행 중인 매치의 다음 라운드를 확정한다. 클라이언트가 제출할 수 있는 값은 전투 입력값뿐이며, 승패, 피해량, 라운드 결과, 리플레이 이벤트는 서버가 계산한다. 참가자 한 명이 먼저 제출하면 기본 선택 타이머 동안 상대 입력을 기다리고, 타이머가 끝나도 상대가 제출하지 않으면 미제출 쪽은 저장된 기본 라운드 플랜으로 자동 진행한다.

요청:

```json
{
  "round_no": 2,
  "tactic_style": "tempo",
  "focus_rule": "backline_first",
  "strategy_chip_id": "skill_cycle"
}
```

응답:

```json
{
  "ok": true,
  "data": {
    "match": {
      "id": "match_...",
      "round_count": 2,
      "player_a_round_wins": 1,
      "player_b_round_wins": 1,
      "summary": {
        "progress_status": "in_progress",
        "current_round_no": 3
      }
    },
    "replay": {
      "match_id": "match_...",
      "rounds": []
    }
  }
}
```

부하 기준:

- 매치 생성 1회와 라운드 커밋 최대 5회만 DB write를 수행한다.
- 빠른대전 라운드는 첫 제출 시 대기 상태 저장 1회, 실제 확정 시 결과 저장 1회를 허용한다.
- 같은 매치의 같은 라운드는 `round_count` 조건으로 중복 커밋을 막는다.
- 커밋 요청은 반드시 다음 미확정 라운드 번호만 허용한다.
- 상대 미제출 여부를 별도 실시간 연결 상태로 추적하지 않는다.
- 상대 미제출 때문에 대기 화면을 무기한 유지하지 않는다.
- 리플레이 저장 kill switch가 꺼져 있으면 `replay`는 `null`일 수 있다.

UX 기준:

- 서버 응답에 라운드 결과가 포함되어도 클라이언트는 전투 시작 직후 결과를 표시하지 않는다.
- 라운드 결과, 점수 변화, 세트 종료 문구는 라운드 종료 연출 이후 공개한다.

## 9. 매치 및 리플레이 API

### GET `/api/arena/matches/{match_id}`

매치 요약을 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "match": {}
  }
}
```

접근 권한:

- MVP: 참가자 본인만 조회
- 정식 시즌 확장: 공개 리플레이 정책에 따라 일부 공개 가능

### GET `/api/arena/matches/{match_id}/replay`

리플레이 이벤트를 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "match_id": "match_...",
    "match_format": "best_of_five",
    "rounds_to_win": 3,
    "replay_version": 2,
    "replay_storage": "tick_events",
    "rounds": [
      {
        "round_no": 1,
        "duration_ms": 52400,
        "winner_side": "player",
        "replay_truncated": false,
        "original_event_count": 84,
        "unit_states": [
          {
            "id": "player:card_1",
            "side": "player",
            "card_id": "card_1",
            "channel_id": "channel_1",
            "max_hp": 1520,
            "start_hp": 1520,
            "final_hp": 640,
            "alive": true
          }
        ],
        "events": [
          {
            "t": 1280,
            "type": "DAMAGE",
            "actor": "player:card_1",
            "targets": ["bot:card_2"],
            "value": 218,
            "hp_before": 1400,
            "hp_after": 1182,
            "shield_before": 0,
            "shield_after": 0,
            "alive_after": true,
            "vfx_kind": "skill",
            "damage_type": "magic",
            "skill_id": "active_focus_burst",
            "skill_type": "active",
            "effect_tags": ["skill", "damage"]
          }
        ]
      }
    ]
  }
}
```

부하 기준:

- 응답 크기 상한을 둔다.
- 오래된 상세 로그는 삭제될 수 있다.
- `replay_version: 2`는 이벤트별 체력/실드 상태와 라운드별 최종 유닛 상태를 포함한다.
- `vfx_kind`, `damage_type`, `skill_id`, `skill_type`, `effect_tags`는 클라이언트 전투 렌더러용 선택 메타데이터다.
- 클라이언트는 `vfx_kind`를 우선 사용하되, 필드가 없는 과거 리플레이는 `type`과 `message` 기반 fallback으로 재생한다.
- 이벤트 수 상한으로 일부 이벤트가 생략되면 `replay_truncated`, `original_event_count`, `timeline_summary.omitted_event_count`를 함께 내려준다.
- 리플레이 조회 실패와 경기 결과 반영 실패를 구분한다.

### GET `/api/arena/matches/recent`

로그인한 유저의 최근 완료 매치를 제한 개수만 조회한다.

쿼리:

```text
limit
```

응답:

```json
{
  "ok": true,
  "data": {
    "items": []
  }
}
```

부하 기준:

- `player_a_id`, `player_b_id` 인덱스 기반의 소량 조회만 허용한다.
- 실시간 집계나 전체 매치 스캔은 하지 않는다.

## 10. MMR 및 랭킹 API

### GET `/api/arena/profile/me`

본인 아레나 프로필을 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "rating": 1520,
    "tier": "silver",
    "rank": 1240,
    "wins": 12,
    "losses": 9,
    "sets_played": 21
  }
}
```

### GET `/api/arena/profile/{user_id}`

특정 유저의 공개 아레나 전적 명함 데이터를 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "user_id": "user_...",
    "rating": 1520,
    "rating_points": 1520,
    "tier": "silver",
    "rank": 1240,
    "wins": 12,
    "losses": 9,
    "draws": 0,
    "sets_played": 21,
    "win_rate": 57,
    "recent_matches": []
  }
}
```

정책:

- 랭킹 목록의 유저 행 또는 본인 프로필 카드에서 명함 모달을 열 때 사용한다.
- 공개 전적은 아레나 시즌 MMR, 티어, 승패, 최근 랭크전 요약만 포함한다.
- 최근 매치는 최대 5개만 반환한다.
- 카드 보유량, 포인트, 치카포 본편 자산, 방송 상태, 내부 시드, 비공개 덱 원본은 반환하지 않는다.
- 응답은 짧은 public cache와 stale 응답을 허용한다.
- 프로필의 rank는 `arena_rank_snapshots`에 있는 값만 표시한다. 스냅샷이 없으면 rank를 비워 두며, 요청 시 rating row count 보정 쿼리를 수행하지 않는다.

### GET `/api/arena/rankings`

랭킹 목록을 조회한다.

쿼리:

```text
season_id
page
limit
tier
```

응답:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "rank": 1,
        "user_id": "user_...",
        "display_name": "닉네임",
        "rating": 2180,
        "tier": "master",
        "wins": 120,
        "losses": 74
      }
    ],
    "updated_at": "2026-06-24T00:00:00+09:00"
  }
}
```

정책:

- 랭킹은 실시간 쿼리가 아니라 `arena_rank_snapshots`만 조회한다.
- 스냅샷 갱신 주기는 1~5분 단위로 시작한다.
- 트래픽 증가 시 갱신 주기를 늘릴 수 있다.

## 11. 스트리머 카드 설정 API

### GET `/api/arena/streamer-card/me`

본인 스트리머 카드 설정을 조회한다.

응답:

```json
{
  "ok": true,
  "data": {
    "channel_id": "ch_...",
    "is_enabled": true,
    "config_status": "configured",
    "state": {
      "is_enabled": true,
      "config": {
        "class_id": "guardian",
        "stat_focus": "defense",
        "combat_style": "guard",
        "skill_ids": ["aegis-pop", "soft-taunt", "last-cookie"],
        "tag_ids": ["shield", "frontline"],
        "flavor_text": "전열을 지키는 카드"
      }
    },
    "card": {},
    "config_options": {}
  }
}
```

### PATCH `/api/arena/streamer-card/me`

본인 스트리머 카드 설정을 저장한다.

요청:

```json
{
  "is_enabled": true,
  "class_id": "guardian",
  "stat_focus": "defense",
  "combat_style": "guard",
  "skill_ids": ["aegis-pop", "soft-taunt", "last-cookie"],
  "tag_ids": ["shield", "frontline"],
  "flavor_text": "전열을 지키는 카드"
}
```

자동 템플릿으로 되돌리기:

```json
{
  "reset_config": true
}
```

서버 검증:

- 본인 채널 권한
- 클래스 ID 허용 목록
- 선택 클래스의 스킬만 최대 3개 허용
- 허용 태그만 최대 4개 허용
- 플레이버 텍스트 길이 제한
- 직접 숫자 스탯 편집 차단
- 고정 스탯 예산 300 안에서만 재분배
- 변경 쿨다운

부하 기준:

- 설정과 비활성화 상태는 `system_configs` 단일 JSON 키에 저장한다.
- 카드 목록, 카드 상세, 봇 카드 풀 캐시는 설정 저장 시 무효화한다.
- 카드별 개별 DB 조회나 대량 write 없이 스트리머 목록과 설정 맵을 한 번씩 읽어 생성한다.

### POST `/api/arena/streamer-card/me/disable`

본인 카드를 아레나 신규 매치에서 비활성화한다.

응답:

```json
{
  "ok": true,
  "data": {
    "is_enabled": false,
    "effective_at": "2026-06-24T00:00:00+09:00"
  }
}
```

정책:

- 신규 매치 카드 풀에서 제외한다.
- 이미 종료된 경기 결과는 유지한다.
- 리플레이 표시는 개인정보 및 리플레이 정책을 따른다.

### POST `/api/arena/streamer-card/me/enable`

본인 카드를 아레나 카드 풀 편입 후보로 다시 활성화한다.

응답:

```json
{
  "ok": true,
  "data": {
    "is_enabled": true,
    "effective_policy": "next_card_availability_refresh"
  }
}
```

정책:

- 재활성화는 즉시 신규 매치에 반영하지 않는다.
- 다음 카드 사용 가능 상태 갱신 또는 다음 시즌부터 반영한다.
- 반복 enable/disable은 쿨다운과 감사 로그 대상이다.

## 11.5 8인 컵 API

### POST /api/arena/cups/join

8인 컵 큐에 참가한다.

요청:

```json
{
  "deck_id": "123"
}
```

응답:

```json
{
  "status": "queued",
  "cup_queue_ticket_id": "9001",
  "poll_after_sec": 5
}
```

### GET /api/arena/cups/queue/status

컵 큐 또는 생성된 컵 상태를 조회한다. 재접속과 fallback에 사용한다.

### GET /api/arena/cups/queue/events

컵 큐 대기 중 상태 변경을 받는 일시 SSE 엔드포인트다. 매칭, 취소, 만료 후 서버가 연결을 닫는다.

### POST /api/arena/cups/cancel

아직 컵이 생성되지 않은 큐 엔트리를 취소한다.

### POST /api/arena/cups/queue/join

`POST /api/arena/cups/join`과 같은 핸들러를 사용하는 호환 경로다.

### POST /api/arena/cups/queue/cancel

`POST /api/arena/cups/cancel`과 같은 핸들러를 사용하는 호환 경로다.

### GET /api/arena/cups/{cup_id}

인증: 로그인한 컵 참가자 또는 관리자만 조회할 수 있다.

8인 컵 브래킷, 내 경기, 최종 순위를 조회한다.

## 11.6 관전 API

### GET /api/arena/spectator/share/{token}

완료된 매치의 토큰 링크 기반 관전 리플레이를 조회한다. match_id만으로 공개 조회하는 엔드포인트는 제공하지 않는다.

관전 API 금지:

- 실시간 tick stream
- 관전자 진행 위치 저장
- 비공개 match 무단 조회
## 12. 관리자 API

관리자 API는 별도 권한과 감사 로그를 요구한다.

### GET `/api/admin/arena/system`

아레나 운영 상태를 조회한다.

### PATCH `/api/admin/arena/system/flags/{flag}`

기능별 kill switch를 변경한다.

요청:

```json
{
  "enabled": false
}
```

허용 flag:

- `quick_match_enabled`
- `cup_enabled`
- `ranked_rating_writes`
- `replay_writes`

운영 설정은 `system_config`에 저장하고, 매치 계산 경로는 짧은 캐시의 설정만 읽는다.

### GET `/api/admin/arena/matches/{match_id}`

관리자용 매치 상세를 조회한다.

### POST `/api/admin/arena/matches/{match_id}/invalidate`

비정상 매치를 무효 처리한다.

요청:

```json
{
  "reason": "중복 결과 반영",
  "recalculate_rating": true
}
```

### POST `/api/admin/arena/rankings/rebuild`

랭킹 스냅샷을 재생성한다.

요청:

```json
{
  "season_id": "season_2026_01",
  "reason": "보정 후 랭킹 재산정"
}
```

### PATCH `/api/admin/arena/cards/{card_id}`

카드 상태를 운영자 권한으로 변경한다.

요청:

```json
{
  "is_enabled": false,
  "reason": "스트리머 요청 처리"
}
```

### 12.6 관리자 통계 API

관리자 통계 API는 스냅샷을 조회한다. 요청 시 `arena_matches` 전체를 직접 집계하지 않는다.

```text
GET  /api/admin/arena/stats
GET  /api/admin/arena/stats/overview
GET  /api/admin/arena/stats/balance
POST /api/admin/arena/stats/rebuild
```

조회 가능 통계:

- 유저 승패/최근 덱 요약
- 카드별 픽률/승률
- 클래스별 픽률/승률/상성
- 스킬별 픽률/승률/발동량
- 스탯 프로필별 승률
- 태그 조합별 승률
- 전술 칩별 승률
- 전장 규칙별 승률
- 라운드 전술별 승률
- 타겟 우선순위별 승률
- 8인 컵 등수별 조합 분포

### 12.7 관리자 컵/관전 운영 API

```text
GET  /api/admin/arena/cups
POST /api/admin/arena/cups/recover-queue
GET  /api/admin/arena/quick-match
POST /api/admin/arena/quick-match/recover-queue
PATCH /api/admin/arena/system/flags/{flag}
```

모든 요청은 관리자 감사 로그를 남긴다.
모든 관리자 API는 다음을 기록한다.

```text
admin_user_id
action
target_type
target_id
before
after
reason
created_at
```

## 13. 아레나 실시간 외형 이벤트

### WS `/arena/realtime`

배틀 이모트 전용 WebSocket이다.

클라이언트 송신:

```json
{ "type": "join", "match_id": "123" }
{ "type": "emote", "match_id": "123", "item_id": 10, "slot": 1 }
```

서버 브로드캐스트:

```json
{
  "type": "arena_emote",
  "match_id": "123",
  "user_id": "user_...",
  "username": "닉네임",
  "item": { "id": 10, "type": "emote", "name": "반짝", "style_json": "{}" },
  "slot": 1,
  "sent_at": "2026-06-25T00:00:00.000Z"
}
```

계약:

- 장착된 `emote` 타입 아이템만 송신할 수 있다.
- 이모트 슬롯 방향은 1=상, 2=우, 3=하, 4=좌로 고정한다.
- 사용자별 짧은 쿨다운을 둔다.
- 이벤트는 DB, 리플레이 로그, 랭킹, 관리자 전투 통계에 저장하지 않는다.
- 소켓 연결 실패는 match result, rating delta, replay 조회 가능 여부에 영향을 주지 않는다.
- 전투는 이미 확정된 서버 결과를 클라이언트가 재생하고, 이모트는 그 위에 표시되는 외형 레이어다.

### POST `/api/admin/arena/cosmetics/emote-assets`

관리자가 아레나 이모트 상품용 이미지를 업로드한다.

요청:

```text
multipart/form-data
image: JPG/PNG/WebP/AVIF/GIF
```

응답:

```json
{
  "ok": true,
  "data": {
    "image_url": "/uploads/arena-emotes/arena_emote_....gif",
    "mime_type": "image/gif",
    "animated": true
  }
}
```

업로드된 URL은 `shop_items.style_json.image_url`에 연결한다. GIF는 움짤 보존을 위해 원본 파일을 저장한다.

## 14. 비동기 처리 기준

즉시 처리:

- 카드 목록 조회
- 덱 검증 및 저장
- 대기열 참가
- 봇전 생성
- 매치 요약 조회

비동기 또는 지연 처리:

- 랭킹 스냅샷 갱신
- 대량 카드 능력 재생성
- 시즌 종료 보상 지급
- 밸런스 통계 스냅샷 생성
- 오래된 일반 매치/8인 컵 리플레이 로그 삭제

## 15. 성능 목표

MVP 목표:

| 항목 | 목표 |
| --- | ---: |
| 빠른대전 참가 API | p95 300ms 이하 |
| 매칭 상태 조회/fallback | p95 150ms 이하 |
| 5판 3선승 세트 시뮬레이션 CPU 시간 | p95 500ms 이하 |
| 덱 저장 | p95 300ms 이하 |
| 랭킹 조회 | p95 200ms 이하 |
| 리플레이 요약 조회 | p95 300ms 이하 |

서버 보호 기준:

- 매치 시뮬레이션 동시 실행 수 제한. MVP 기본값은 랭킹전 1~2, 봇전 0~1
- 큐 워커 수 제한
- 랭킹 스냅샷 조회 우선
- 오래된 상세 로그 자동 삭제
- 봇전 상세 리플레이 기본 미저장
- MMR bucket 기반 매칭 후보 제한
- 장애 시 빠른대전부터 중단

## 16. 구현 금지 사항

- 클라이언트 제출 전투 결과 반영
- 실시간 상주 매치룸 필수 구조
- 밴픽 API
- 시즌 로테이션 카드 풀 API
- 실시간 관전 tick stream
- 매칭 상태 1초 미만 fallback 조회
- 카드 시세 기반 전투력 계산
- 방송 중 버프
- 후원 기반 버프
- 카드 보유량 기반 전투력 증가
- 리플레이 API에서 내부 시드 공개
- 랭킹 조회 시 매번 전체 정렬 쿼리 수행




