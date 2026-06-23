# 데이터/API/구현 초안

## 1. 목표

이 문서는 `치카포 프론티어` 구현을 위한 데이터 모델, API, 서버 계산 원칙, 구현 순서를 정리한다.

아직 상세 마이그레이션 파일이 아니라 설계 초안이다.

## 2. 핵심 구현 원칙

- 클래스/패시브 정의는 서버 기준 데이터다.
- 클라이언트는 계산 결과를 요청할 수 있지만 결과를 직접 확정할 수 없다.
- 원정/전투 시작 시 카드 빌드를 스냅샷으로 저장한다.
- 원정 결과 수령은 멱등 처리한다.
- 보상 지급은 기존 자산 감사 로그와 연결한다.
- 전투/원정 계산기는 서버의 단일 모듈로 둔다.

## 3. 주요 테이블

### 3.1 `frontier_seasons`

- `id`
- `code`
- `name`
- `starts_at`
- `ends_at`
- `status`: draft/active/ended
- `rules_json`
- `created_at`
- `updated_at`

### 3.2 `rpg_classes`

- `id`
- `code`
- `name`
- `role_group`
- `description`
- `difficulty`: easy/normal/advanced
- `base_action_json`
- `allowed_tags_json`
- `recommended_stats_json`
- `stat_weights_json`
- `is_active`
- `season_added`
- `sort_order`
- `created_at`
- `updated_at`

### 3.3 `rpg_passives`

- `id`
- `code`
- `name`
- `description`
- `tags_json`
- `effect_json`
- `effect_axis`
- `risk_level`: low/medium/high
- `passive_type`: combat/support/explore/variable
- `is_active`
- `season_added`
- `sort_order`
- `created_at`
- `updated_at`

### 3.4 `streamer_class_builds`

- `id`
- `channel_id`
- `season_id`
- `class_id`
- `stat_vitality`
- `stat_attack`
- `stat_defense`
- `stat_speed`
- `stat_technique`
- `stat_resonance`
- `passive_1_id`
- `passive_2_id`
- `status`: draft/active/locked
- `change_count`
- `updated_at`
- `locked_at`

유니크:

- `(channel_id, season_id)`

검증:

- 스탯 총합 20
- 스탯별 최대치 준수
- 같은 패시브 2회 선택은 허용하지 않되, 서로 다른 패시브 조합은 금지하지 않음
- 클래스 허용 태그와 패시브 태그 매칭
- 같은 효과 축 중첩 시 점감/상한 규칙 적용

### 3.5 `frontier_expeditions`

- `id`
- `user_id`
- `season_id`
- `region_id`
- `duration_minutes`
- `started_at`
- `finishes_at`
- `claimed_at`
- `status`: started/completed/cancelled/expired
- `party_snapshot_json`
- `seed`
- `result_json`
- `reward_json`
- `created_at`
- `updated_at`

인덱스:

- `(user_id, status)`
- `(user_id, finishes_at)`
- `(season_id, region_id)`

### 3.6 `frontier_regions`

- `id`
- `code`
- `name`
- `description`
- `difficulty`
- `score_axis_weights_json`
- `event_pool_json`
- `reward_table_json`
- `is_active`
- `sort_order`

### 3.7 `frontier_reward_logs`

- `id`
- `user_id`
- `season_id`
- `source_type`: expedition/raid/league/season
- `source_id`
- `reward_json`
- `status`: success/failed
- `idempotency_key`
- `created_at`

유니크:

- `idempotency_key`

### 3.8 `frontier_user_stats`

- `user_id`
- `season_id`
- `stat_key`
- `stat_value`
- `metadata_json`
- `updated_at`

예:

- `expedition.completed.count`
- `expedition.great_success.count`
- `role.vanguard.contribution`
- `role.support.healing`
- `season.investigation_score`

## 4. 파티 스냅샷 구조

원정 시작 시 저장하는 JSON 예시:

```json
{
  "cards": [
    {
      "user_card_id": 123,
      "channel_id": "channel-id",
      "streamer_name": "스트리머",
      "star": 3,
      "class": {
        "id": 1,
        "code": "iron_host",
        "name": "철벽 진행자",
        "role_group": "vanguard",
        "base_action": {}
      },
      "stats": {
        "vitality": 7,
        "attack": 1,
        "defense": 8,
        "speed": 1,
        "technique": 0,
        "resonance": 3
      },
      "passives": [
        {
          "id": 1,
          "code": "solid_first_impression",
          "effect": {}
        },
        {
          "id": 2,
          "code": "last_shield",
          "effect": {}
        }
      ],
      "effect_axes": ["protect", "survival"]
    }
  ],
  "role_groups": ["vanguard", "support", "strike", "explore"],
  "created_at": "2026-06-24T00:00:00.000Z"
}
```

스냅샷에는 결과 계산에 필요한 최소 정보만 넣는다. 이미지 URL 같은 표시 정보는 필요하면 별도 조회한다.

## 5. 주요 API 초안

### 5.1 스트리머 빌드 조회

`GET /api/frontier/streamers/me/build`

응답:

- 현재 시즌
- 내 채널 정보
- 현재 빌드
- 추천 클래스
- 변경 가능 여부

### 5.2 스트리머 빌드 저장

`POST /api/frontier/streamers/me/build`

요청:

- `class_id`
- `stats`
- `passive_1_id`
- `passive_2_id`

서버 검증:

- 본인 채널 여부
- 시즌 변경 가능 여부
- 스탯 총합
- 클래스/패시브 조합
- 변경 횟수/쿨다운

### 5.3 클래스/패시브 카탈로그

`GET /api/frontier/catalog`

응답:

- 활성 클래스 목록
- 활성 패시브 목록
- 역할군 메타데이터
- 현재 시즌 보너스

### 5.4 내 원정 목록

`GET /api/frontier/expeditions`

응답:

- 진행 중 원정
- 완료 대기 원정
- 최근 완료 원정

### 5.5 원정 시작

`POST /api/frontier/expeditions/start`

요청:

- `region_id`
- `duration_minutes`
- `user_card_ids`

서버 처리:

1. 유저 보유 카드 확인
2. 중복 카드 확인
3. 카드별 스트리머 빌드 조회
4. 미설정 스트리머는 기본 빌드 적용
5. 효과 축 중첩과 점감 규칙 계산
6. 스냅샷 생성
7. 원정 row 생성

### 5.6 원정 결과 수령

`POST /api/frontier/expeditions/:id/claim`

서버 처리:

1. 소유권 확인
2. 상태 확인
3. 완료 시각 확인
4. 결과 계산
5. 보상 지급
6. 멱등 로그 기록
7. 원정 완료 처리

### 5.7 원정 취소

`POST /api/frontier/expeditions/:id/cancel`

초기 정책:

- 시작 후 1분 이내 무료 취소
- 이후 취소 시 보상 없음
- 완료 가능 원정은 취소 불가

## 6. 서버 계산기

계산기는 별도 서비스 모듈로 둔다.

예:

- `frontierClassService`
- `frontierBuildValidator`
- `frontierPartySnapshotService`
- `frontierExpeditionSimulator`
- `frontierRewardService`

### 6.1 입력

- region
- duration
- party snapshot
- seed
- season rules

### 6.2 출력

- result grade: great_success/success/partial/fail
- contribution by card
- triggered passives
- event logs
- reward
- stat deltas

### 6.3 결정론

같은 입력과 seed는 같은 결과를 내야 한다.

이유:

- 재시도 안전성
- 디버깅
- 보상 중복 방지
- 유저 문의 대응

## 7. 기본 빌드

스트리머가 빌드를 설정하지 않아도 카드가 죽으면 안 된다.

기본 빌드 규칙:

- 스트리머 미설정 시 `기본 모험가` 같은 숨겨진 공용 클래스 적용
- 또는 활동 지표 기반 추천 클래스 자동 적용
- 유저 화면에는 `기본 빌드` 배지 표시
- 스트리머가 설정하면 즉시 다음 원정부터 반영

추천은 자동 적용하되, 스트리머가 직접 선택한 빌드와 구분한다.

## 8. 관리자 기능

필수:

- 클래스 목록 관리
- 패시브 목록 관리
- 클래스 활성/비활성
- 패시브 활성/비활성
- 점감/상한 규칙 관리
- 시즌 보너스 설정
- 지역별 판정 축 비중 설정
- 보상 테이블 설정
- 클래스/패시브 선택률 통계
- 원정 보상 지급량 통계

## 9. 보안/어뷰징

- 클라이언트가 원정 결과를 직접 제출하지 않는다.
- 클라이언트는 원정 시작과 결과 수령만 요청한다.
- 결과는 서버가 snapshot과 seed로 계산한다.
- 보상 지급은 idempotency key로 1회만 처리한다.
- 유저가 보유하지 않은 카드로 원정 시작 불가.
- 같은 카드 인스턴스를 같은 파티에 중복 편성 불가.
- 진행 중인 다른 원정에 이미 사용 중인 카드는 편성 제한 여부를 정책으로 결정한다.
- 스트리머 빌드 변경은 진행 중 원정에 영향 없음.

## 10. 구현 단계

### 10.1 1단계: 카탈로그와 빌드

- 클래스/패시브 테이블
- 기본 클래스/패시브 seed
- 스트리머 빌드 저장 API
- 빌드 검증기
- 스트리머 빌드 설정 UI

### 10.2 2단계: 파티와 원정

- 원정 지역 테이블
- 파티 스냅샷 생성
- 원정 시작 API
- 원정 목록 API
- 결과 수령 API
- 원정 결과 화면

### 10.3 3단계: 보상과 시즌

- 프론티어 재화/재료
- 보상 로그
- 시즌 점수
- 역할별 기여 통계
- 기본 랭킹

### 10.4 4단계: 운영 도구

- 관리자 클래스/패시브 관리
- 선택률 통계
- 보상 지급량 통계
- 시즌 보너스 조정
- 점감/상한 규칙 관리

### 10.5 5단계: 확장 콘텐츠

- 주간 보스
- 비동기 오토리그
- 지역 점령전
- 로그라이트 던전

## 11. 테스트 필수 항목

- 스탯 총합이 20이 아니면 저장 실패
- 허용 태그가 맞지 않는 패시브 선택 실패
- 같은 효과 축 중첩 시 점감/상한 규칙이 적용된다
- 스트리머가 아닌 유저는 빌드 저장 실패
- 원정 시작 시 보유하지 않은 카드 사용 실패
- 같은 카드 인스턴스 중복 편성 실패
- 완료 전 claim 실패
- 같은 원정 claim 동시 요청 시 보상 1회만 지급
- 같은 seed와 snapshot은 같은 결과 반환
- 빌드 변경 후 진행 중 원정 결과가 바뀌지 않음

