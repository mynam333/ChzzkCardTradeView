# 치카포 아레나 카드 생성 규칙 기획서

## 1. 목적

이 문서는 치카포 아레나에서 약 3,000명 규모의 스트리머 카드를 전투용 아레나 카드로 생성하는 규칙을 정의한다.

목표는 다음과 같다.

- 모든 등록 스트리머가 기본적으로 아레나 카드를 가진다.
- 스트리머가 직접 설정하지 않아도 카드는 고유한 능력을 가진다.
- 같은 스트리머 카드는 모든 유저에게 항상 같은 능력을 가진다.
- 자동 생성 카드는 랜덤처럼 다양하지만 재현 가능해야 한다.
- 스트리머 직접 설정 카드와 자동 생성 카드는 같은 밸런스 검증을 통과해야 한다.
- 3,000장을 개별 수작업 밸런싱하지 않고 템플릿, 파워 예산, 금지 조합으로 관리한다.

## 2. 핵심 원칙

### 2.1 전투력 독립

카드 생성에는 치카포 본편의 인기/경제 데이터를 사용하지 않는다.

사용 금지:

- 카드 시세
- 팔로워 수
- 방송 중 여부
- 방송 시간
- 채팅량
- 포인트
- 카드 보유량
- 마켓 거래가
- 스트리머 인기도

사용 가능:

- `channel_id`
- 스트리머 이름
- 카드 이미지
- 커스텀 카드 이미지
- 코스메틱 표시 정보
- 아레나 전용 설정값

`channel_id`는 결정적 랜덤 seed를 만들기 위해서만 사용한다. 특정 `channel_id`가 강하거나 약해지는 외부 데이터 기반 보정은 하지 않는다.

### 2.2 같은 스트리머는 같은 능력

같은 `channel_id`의 아레나 카드는 모든 유저에게 같은 전투 능력을 가진다.

영향을 주면 안 되는 것:

- 유저가 해당 치카포 카드를 보유했는지
- 유저가 몇 장 보유했는지
- 카드 별 등급
- 카드 구매 가격
- 카드 장착 코스메틱
- 유저의 포인트

치카포 본편 자산은 아레나에서 외형, 팬 표시, 프로필 장식, 수집 만족감으로만 사용한다.

### 2.3 자동 생성과 직접 설정의 동등성

자동 생성 카드는 직접 설정 카드보다 약해서도 강해서도 안 된다.

모든 카드는 다음 과정을 통과해야 한다.

1. 구성 요소 선택
2. 파워 예산 계산
3. 금지 조합 검사
4. 전투 엔진 유효성 검사
5. 밸런스 허용 범위 검사
6. 카드 버전 고정

## 3. 카드 생성 결과물

아레나 카드는 다음 전투 구성을 가진다.

```text
channel_id
generation_version
config_source
arena_status
role_id
class_id
stat_profile_id
active_skill_id
passive_skill_id
synergy_tags
base_stats
power_score
forbidden_combo_flags
effective_season_id
```

표시 구성:

```text
display_name
image_url
cosmetic_refs
flavor_text
```

`display_name`, `image_url`, `cosmetic_refs`는 전투력에 영향을 주지 않는다.

## 4. 생성 방식

### 4.1 결정적 랜덤 seed

자동 생성 카드는 `channel_id`와 생성 버전을 기반으로 seed를 만든다.

```text
seed_source = "chikapo-arena-card:" + generation_version + ":" + channel_id
seed = sha256(seed_source)
```

예시:

```text
generation_version = "v1"
channel_id = "abc123"
seed_source = "chikapo-arena-card:v1:abc123"
```

이 seed로 역할군, 클래스, 스탯 프로필, 스킬, 태그를 선택한다. 같은 version과 같은 `channel_id`는 항상 같은 결과를 만든다.

### 4.2 RNG 분리

선택 단계별로 seed stream을 분리한다.

```text
role_rng = hash(seed + ":role")
class_rng = hash(seed + ":class")
stat_rng = hash(seed + ":stat")
active_skill_rng = hash(seed + ":active")
passive_skill_rng = hash(seed + ":passive")
tag_rng = hash(seed + ":tags")
fallback_rng = hash(seed + ":fallback")
```

이렇게 하면 한 단계의 후보 목록이 바뀌어도 다른 단계의 결과가 과도하게 흔들리는 것을 줄일 수 있다.

### 4.3 생성 파이프라인

자동 생성 순서:

1. 카드가 아레나 비활성 상태인지 확인
2. seed 생성
3. 역할군 선택
4. 역할군에 허용된 클래스 후보 선택
5. 클래스에 허용된 스탯 프로필 선택
6. 클래스/역할군에 허용된 액티브 스킬 후보 선택
7. 클래스/역할군에 허용된 패시브 스킬 후보 선택
8. 시너지 태그 후보 선택
9. 기본 스탯 산출
10. 파워 예산 계산
11. 금지 조합 검사
12. 전투 엔진 유효성 검사
13. 실패 시 fallback 후보 재선택
14. 결과 저장

## 5. 구성 요소

### 5.1 역할군

역할군은 카드의 전투 방향을 결정한다.

MVP 역할군:

```text
TANK
BRUISER
DAMAGE
CASTER
SUPPORT
TRICKSTER
```

역할군별 기본 성향:

- `TANK`: 높은 체력, 방어, 도발, 보호막
- `BRUISER`: 중상급 체력, 중상급 공격, 지속 교전
- `DAMAGE`: 높은 공격, 낮은 방어, 단일 처치
- `CASTER`: 스킬 중심, 광역/상태이상
- `SUPPORT`: 회복, 보호, 버프, 해제
- `TRICKSTER`: 위치 교란, 침묵, 회피, 조건부 발동

### 5.2 클래스

클래스는 역할군보다 구체적인 전투 콘셉트다.

클래스는 다음 메타데이터를 가진다.

```text
class_id
name
role_id
allowed_stat_profiles
allowed_active_skill_tags
allowed_passive_skill_tags
preferred_synergy_tags
forbidden_skill_tags
base_power_modifier
description
```

예시:

```text
class_id: shield_knight
role_id: TANK
allowed_stat_profiles: [high_hp, high_defense, balanced_guard]
allowed_active_skill_tags: [taunt, shield, guard]
allowed_passive_skill_tags: [damage_reduce, start_shield, ally_protect]
preferred_synergy_tags: [guardian, order, front_line]
forbidden_skill_tags: [assassin, burst_execute]
```

### 5.3 스탯 프로필

스탯 프로필은 기본 스탯 분배 템플릿이다.

스탯 프로필 메타데이터:

```text
stat_profile_id
name
role_tags
hp_weight
attack_weight
defense_weight
attack_speed_weight
range_value
crit_chance
crit_damage
energy_gain
skill_cost_modifier
status_resist
power_cost
```

스탯 프로필은 직접 숫자를 자유 입력하지 않고, 전투 시스템 문서의 스탯 범위 안에서 산출한다.

### 5.4 액티브 스킬

액티브 스킬은 에너지를 소모해 발동하는 카드의 주요 능력이다.

메타데이터:

```text
active_skill_id
name
skill_tags
allowed_roles
allowed_classes
targeting_rule
effect_template
effect_params
skill_cost
cooldown_ms
power_cost
counter_tags
forbidden_combo_tags
description
```

### 5.5 패시브 스킬

패시브 스킬은 특정 조건에서 자동 발동하는 능력이다.

메타데이터:

```text
passive_skill_id
name
skill_tags
allowed_roles
allowed_classes
trigger_rule
effect_template
effect_params
max_triggers_per_battle
max_triggers_per_tick
power_cost
counter_tags
forbidden_combo_tags
description
```

### 5.6 시너지 태그

시너지 태그는 덱 구성의 핵심이다.

메타데이터:

```text
tag_id
name
category
effect_tiers
allowed_roles
preferred_classes
power_cost
conflict_tags
description
```

권장 태그 수:

- MVP: 30종
- 1차 시즌: 50종
- 장기 목표: 80~100종

카드당 태그 수:

- 기본 2개
- 일부 클래스는 3개 가능
- 3개 태그 카드는 다른 곳에서 파워 예산을 더 소모해야 함

## 6. 파워 예산

### 6.1 기본 예산

모든 카드는 총 파워 예산 안에서 생성된다.

MVP 권장:

```text
TOTAL_POWER_BUDGET = 100
```

구성별 기준:

```text
stat_budget = 45
active_skill_budget = 30
passive_skill_budget = 15
synergy_budget = 10
```

실제 카드의 `power_score`는 각 구성 요소의 비용 합계다.

```text
power_score =
  stat_profile.power_cost
  + active_skill.power_cost
  + passive_skill.power_cost
  + sum(synergy_tag.power_cost)
  + class.base_power_modifier
```

허용 범위:

```text
MIN_POWER_SCORE = 95
MAX_POWER_SCORE = 105
```

95 미만이면 약한 카드, 105 초과면 강한 카드로 간주하고 재생성 또는 보정한다.

### 6.2 파워 보정

후보 조합이 95~105를 벗어나면 다음 순서로 보정한다.

너무 강할 때:

1. 액티브 스킬 계수 낮은 variant 선택
2. 패시브 발동 횟수 제한 variant 선택
3. 시너지 태그 비용 낮은 후보로 교체
4. 스탯 프로필을 낮은 비용 variant로 교체
5. 실패 시 fallback 프리셋 사용

너무 약할 때:

1. 스탯 프로필 상향 variant 선택
2. 액티브 스킬 계수 상향 variant 선택
3. 패시브 스킬 조건 완화 variant 선택
4. 시너지 태그를 더 유효한 후보로 교체
5. 실패 시 fallback 프리셋 사용

### 6.3 Variant 시스템

스킬과 스탯 프로필은 variant를 가질 수 있다.

예:

```text
fireball_low: power_cost 24, 계수 1.2
fireball_mid: power_cost 30, 계수 1.45
fireball_high: power_cost 36, 계수 1.7
```

Variant를 사용하면 같은 콘셉트를 유지하면서 파워 예산을 맞출 수 있다.

## 7. 후보 선택 규칙

### 7.1 역할군 선택

자동 생성에서는 역할군을 균등하게 분포시키는 것이 목표다.

단순 seed random만 쓰면 3,000장 규모에서 약간의 편차는 허용된다. 그러나 특정 역할군 쏠림이 심하면 generation batch 단계에서 분포 보정을 한다.

권장 목표 분포:

```text
TANK: 16~18%
BRUISER: 16~18%
DAMAGE: 16~18%
CASTER: 16~18%
SUPPORT: 14~17%
TRICKSTER: 14~17%
```

서포터와 트릭스터는 과도하면 전투가 길어지거나 불쾌감이 커질 수 있어 약간 낮게 잡는다.

### 7.2 클래스 선택

클래스는 선택된 역할군 안에서 고른다.

가중치:

- 기본은 균등
- 신규 클래스는 시즌 초기에 약간 높은 노출 가능
- 문제 클래스는 다음 시즌에서 낮은 가중치 가능

가중치 조절은 생성 버전 또는 카드 능력 재생성 배치 시점에만 적용한다. 시즌 중 무작위로 카드 클래스가 바뀌면 안 된다.

### 7.3 스킬 선택

액티브/패시브 스킬은 다음 조건을 모두 만족해야 후보가 된다.

- 역할군 허용
- 클래스 허용
- 금지 태그 없음
- 현재 선택된 스탯 프로필과 충돌 없음
- 현재 선택된 다른 스킬과 forbidden combo 없음
- 파워 예산 안에 들어올 가능성 있음

### 7.4 시너지 태그 선택

태그는 다음 조건을 본다.

- 클래스의 preferred tag 우선
- 역할군과 어울리는 태그 우선
- 동일 카드 안에서 conflict tag 동시 선택 금지
- 전체 활성 카드의 태그 분포 고려

태그 분포 목표:

- 특정 태그가 전체 활성 카드의 20%를 넘지 않도록 한다.
- 특정 태그가 전체 활성 카드의 3% 미만이면 시너지 구성이 너무 어려울 수 있다.
- 핵심 시너지 태그는 전체 활성 카드 안에 최소 12~20장 이상 있어야 한다.

## 8. 금지 조합 검사

카드 생성 시 다음을 검사한다.

### 8.1 스킬 간 금지

예:

- 에너지 획득 패시브 + 고빈도 광역 스킬 + 스킬 적중 시 에너지 회복
- 사망 회피 패시브 + 대량 회복 액티브 + 보호막 증폭 태그
- 기절 액티브 + 기절 시간 증가 패시브 + 상태이상 지속 증가 태그

### 8.2 역할군 불일치

예:

- 탱커가 고계수 후열 암살 스킬 보유
- 서포터가 최상급 단일 폭딜 보유
- 딜러가 최상급 광역 회복 보유

완전 금지하지 않고 약한 variant로 허용할 수도 있지만, MVP에서는 복잡도를 낮추기 위해 금지하는 편이 낫다.

### 8.3 전투 엔진 위험

차단:

- 무한 소환 가능성
- 무한 에너지 루프
- 무한 회복 루프
- 전투 시간 초과를 과도하게 유발하는 조합
- 로그 이벤트를 폭증시키는 조합

## 9. Fallback 규칙

생성이 실패할 수 있는 경우:

- 후보 스킬이 없음
- 파워 점수가 허용 범위를 벗어남
- 금지 조합에 걸림
- 태그 분포 제한에 걸림
- 전투 엔진 유효성 검사 실패

Fallback 순서:

1. 같은 역할군 안에서 다른 클래스 선택
2. 같은 클래스 안에서 스킬 variant 변경
3. 패시브 스킬 교체
4. 시너지 태그 교체
5. 안정형 프리셋 사용

안정형 프리셋은 역할군별로 최소 3개 이상 준비한다.

예:

```text
TANK_SAFE_01
TANK_SAFE_02
TANK_SAFE_03
SUPPORT_SAFE_01
...
```

Fallback도 seed 기반으로 선택한다. 실패 상황에서도 같은 `channel_id`는 항상 같은 fallback 결과를 가져야 한다.

## 10. 스트리머 직접 설정

### 10.1 설정 권한

스트리머 본인은 자신의 아레나 카드 콘셉트를 설정할 수 있다.

필수:

- 치카포 계정 연동으로 본인 확인
- 해당 `channel_id`의 스트리머 본인인지 검증
- 관리자 강제 비활성 상태가 아니어야 함

### 10.2 설정 가능 범위

스트리머가 직접 설정할 수 있는 항목:

- 클래스 선택
- 전투 성향
- 대표 스탯 성향 선택
- 클래스 안에서 스킬 최대 3개 선택
- 콘셉트 태그 최대 4개 선택
- 플레이버 텍스트
- 아레나 사용 여부

직접 숫자 입력은 허용하지 않는다.

허용하지 않는 항목:

- 체력/공격력 직접 입력
- 스킬 계수 직접 입력
- 쿨다운 직접 입력
- 파워 예산 초과 조합
- 금지 조합
- 전투 엔진 제한을 넘는 효과

운영 제한:

- MVP에서는 완전 자유 조합이나 수치 편집을 제공하지 않는다.
- 클래스는 현재 구현된 8종 중 하나만 선택한다.
- 스킬은 선택한 클래스에 허용된 스킬 풀 안에서만 최대 3개 선택한다.
- 대표 스탯과 전투 성향은 총 스탯 예산 300 안에서 재분배하는 방식으로만 반영한다.
- 콘셉트 태그와 플레이버 텍스트는 전투 계수로 직접 사용하지 않는다.
- 설정 저장 후에도 자동 시뮬레이션에서 클래스, 스킬, 태그, 스탯 성향별 승률을 검증해야 한다.
- 인기 스트리머 카드라도 파워 예산과 금지 조합을 우회할 수 없다.
- 시즌 중 직접 설정 변경은 카드 목록 캐시 무효화 후 반영하되, 정식 시즌에서는 운영 정책에 따라 갱신 주기 또는 다음 시즌 반영으로 제한할 수 있다.

### 10.3 설정 UX

추천 방식:

1. 스트리머가 카드 설정 페이지 진입
2. 현재 자동 생성 카드 확인
3. 클래스, 대표 스탯, 전투 성향 선택
4. 선택한 클래스의 스킬 중 최대 3개 선택
5. 콘셉트 태그와 플레이버 텍스트 설정
6. 서버가 허용 범위로 정규화
7. 저장 후 실제 카드 미리보기 갱신
8. 필요하면 자동 템플릿으로 되돌리기

### 10.4 설정 검증

설정 제출 시 즉시 서버 검증을 수행한다.

검증:

- 권한 검증
- 선택지 유효성 검증
- 파워 예산 검증
- 클래스별 스킬 허용 검증
- 태그 허용 목록 검증
- 텍스트 정책 검증
- 전투 엔진 유효성 검증

검증 실패 시 저장하지 않고 이유를 반환한다.

### 10.5 반영 시점

권장:

- 외형/플레이버 텍스트: 검토 후 빠르게 반영 가능
- 클래스/스킬/태그: 다음 시즌부터 반영
- 아레나 비활성화: 즉시 반영
- 재활성화: 다음 카드 사용 가능 상태 갱신 시 반영

## 11. 비활성화 처리

스트리머가 opt-out하면 해당 카드는 아레나에서 사용되지 않는다.

비활성 상태:

```text
ACTIVE
OPTED_OUT
ADMIN_DISABLED
PENDING_REVIEW
```

비활성 처리:

- 전체 활성 카드 사용 가능 상태에서 제외
- 빠른대전 덱 편성 불가
- 봇 덱에서 제외
- 추천 카드에서 제외
- 커스텀 룸 기본 카드 풀에서 제외
- 기존 덱에 포함되어 있으면 덱 사용 불가 상태로 표시

과거 기록:

- 매치 무결성을 위해 match summary는 유지
- 리플레이 표시 정책은 별도 운영 정책에 따른다
- 필요 시 카드명 대신 비활성 카드로 익명 표시

## 12. 버전 관리

### 12.1 Generation Version

자동 생성 규칙이 바뀌면 generation version을 올린다.

현재 자동 생성 규칙은 `cards-v2`, 예산 및 상한 규칙은 `balance-v2`다. 준비 상태(`draft`, `scheduled`) 시즌의 기존 자동 생성 카드는 같은 ID와 버전 번호를 유지한 채 다시 계산한다. 시즌의 생성·밸런스 버전 표시는 전수 동기화가 끝까지 성공한 뒤에만 승격한다. 스트리머가 직접 설정한 카드는 자동으로 덮어쓰지 않는다.

Arena worker는 시작 직후 준비 시즌 카드 풀의 전수 동기화를 시작하고, 실패하면 주기적으로 다시 시도한다. 이미 열린 `cards-v2` 시즌은 기존 행을 바꾸지 않고 누락된 자동 카드만 복구한다. API 요청 경로도 페이지·보유 카드 단위의 누락 복구만 수행해 전체 동기화 때문에 응답이 지연되지 않게 하며, 잠김·정산·종료 시즌에는 동기화하지 않는다.

`pursuit`와 `grave_buff`는 발동 결과 또는 조건이 아직 완전히 정의되지 않았으므로 자동 생성 풀에서 제외한다. 기존 데이터 표시 호환을 위해 키워드 ID와 검증 비용은 유지하지만, 카드 편집기의 신규 선택과 서버 저장 검증에서도 차단한다. 전투 규칙을 확정한 새 생성 버전에서만 다시 배정할 수 있다.

예:

```text
v1: MVP 생성 규칙
v2: 클래스 12종 추가, 태그 분포 보정 변경
v3: 파워 예산 계산식 변경
```

같은 `channel_id`라도 version이 바뀌면 자동 생성 결과가 바뀔 수 있다. 단, 잠김·정산·종료 시즌과 이전 생성 버전으로 이미 시작된 활성 시즌의 카드는 최신 전역 규칙으로 다시 계산하지 않는다.

### 12.2 Card Version

개별 카드 능력이 확정될 때 card version을 기록한다.

```text
card_version = generation_version + ":" + config_source + ":" + revision
```

전투 스냅샷에는 card version을 저장해 리플레이와 결과 재현성을 유지한다.

### 12.3 시즌 고정

시즌 시작 시 룰 버전과 각 카드 능력 버전을 고정한다. 시즌 로테이션 카드 풀은 만들지 않는다.

시즌 중 변경 가능한 것:

- 비활성화
- 버그성 긴급 비활성
- 명백한 오류 수정

시즌 중 일반적으로 변경하지 않는 것:

- 클래스
- 스킬
- 태그
- 스탯 프로필
- 파워 점수

## 13. 저장 전략

3,000장 카드 능력을 요청마다 DB에서 개별 조회하거나 저장하면 안 된다.

현재 MVP 구현:

- 자동 생성 능력은 `channel_id` 기반 deterministic seed로 계산한다.
- 스트리머 직접 설정과 비활성화 상태는 `system_configs`의 단일 JSON 키에 저장한다.
- 카드 목록 조회 시 스트리머 목록과 설정 맵을 각각 1회 로드한 뒤 메모리에서 카드를 생성한다.
- 카드 목록, 카드 상세, 봇 카드 풀은 TTL 캐시를 사용한다.
- 전투에는 매치 시작 시점의 카드 능력/사용 가능 상태 스냅샷을 사용한다.

장기 확장 권장:

- 시즌 시작 시 전체 확정 능력을 batch로 생성해 `arena_cards`에 저장
- 카드 버전 이력을 별도 테이블에 저장
- 대량 생성은 chunk 단위로 처리

캐시:

- 전체 활성 카드 사용 가능 상태
- 클래스 정의
- 스킬 정의
- 태그 정의
- 봇 덱 템플릿

캐시 무효화:

- generation version 변경
- 카드 사용 가능 상태 재검증
- 스트리머 opt-out
- 스트리머 직접 설정 저장
- 관리자 비활성화

## 14. Batch 생성 프로세스

관리자 또는 배치 작업으로 카드 생성/갱신을 수행한다.

권장 흐름:

1. 대상 스트리머 목록 조회
2. 비활성 카드 제외
3. generation version 확인
4. 카드별 자동 생성 실행
5. 분포 통계 계산
6. 파워 점수 통계 계산
7. 실패 카드 fallback 처리
8. 결과 저장
9. 관리자 리포트 생성

생성 리포트:

```text
total_cards
generated_count
configured_count
opted_out_count
failed_count
role_distribution
class_distribution
tag_distribution
power_score_avg
power_score_min
power_score_max
fallback_count
```

배치는 대량 DB write를 유발하므로 chunk 단위로 처리한다.

권장:

```text
GENERATION_CHUNK_SIZE = 100
```

## 15. 관리자 검수 화면

운영자는 생성 결과를 검수할 수 있어야 한다.

필수 기능:

- 카드 검색
- 역할군 필터
- 클래스 필터
- 태그 필터
- 파워 점수 범위 필터
- fallback 사용 카드 필터
- 금지 조합 경고
- 비활성 상태 필터
- 스트리머 직접 설정 카드 필터

관리자 액션:

- 카드 재생성
- 특정 카드 safe preset 지정
- 특정 카드 일시 비활성화
- generation 리포트 확인
- 카드 사용 가능 상태 제한/해제

## 16. API 초안

공개/유저:

- `GET /api/arena/cards`
- `GET /api/arena/cards/{card_id}`
- `GET /api/arena/cards/availability`

스트리머:

- `GET /api/arena/streamer-card/me`
- `PATCH /api/arena/streamer-card/me`
- `POST /api/arena/streamer-card/me/disable`
- `POST /api/arena/streamer-card/me/enable`

관리자:

- `POST /api/admin/arena/cards/generate`
- `GET /api/admin/arena/cards/generation-report`
- `POST /api/admin/arena/cards/{card_id}/regenerate`
- `POST /api/admin/arena/cards/{card_id}/assign-safe-preset`
- `PATCH /api/admin/arena/cards/{card_id}`
- `POST /api/admin/arena/cards/availability/rebuild`

## 17. 데이터 모델 초안

### 17.1 arena_cards

```text
channel_id PK
arena_status
config_source
generation_version
card_version
role_id
class_id
stat_profile_id
active_skill_id
passive_skill_id
synergy_tags_json
base_stats_json
power_score
flavor_text
configured_by
configured_at
effective_from_season
updated_at
```

### 17.2 arena_card_generation_logs

```text
id PK
generation_version
started_at
finished_at
total_cards
generated_count
configured_count
opted_out_count
failed_count
fallback_count
summary_json
created_by
```

### 17.3 arena_card_config_requests

```text
id PK
channel_id
requested_by
requested_config_json
validation_result_json
status
created_at
reviewed_at
reviewed_by
```

상태:

```text
PENDING
APPROVED
REJECTED
CANCELLED
AUTO_APPROVED
```

### 17.4 arena_card_versions

장기적으로는 카드 버전 이력을 별도 테이블로 저장할 수 있다.

```text
id PK
channel_id
card_version
generation_version
config_source
card_config_json
effective_from
effective_to
created_at
```

MVP에서는 `arena_cards`만 사용하고, 시즌 안정화 후 버전 이력 테이블을 추가해도 된다.

## 18. 테스트 기준

기능 테스트:

- 같은 `channel_id`와 같은 version은 항상 같은 카드 생성
- version이 바뀌면 결과 변경 가능
- opt-out 카드는 사용 가능 상태에서 제외
- 직접 설정 카드도 파워 예산 검증 통과 필요
- 금지 조합 차단
- fallback 결과도 deterministic

분포 테스트:

- 역할군 분포가 목표 범위 안에 있음
- 태그 분포가 과도하게 쏠리지 않음
- 파워 점수 평균이 100 근처
- 95 미만/105 초과 카드가 없음
- fallback 비율이 과도하지 않음

부하 테스트:

- 3,000장 batch 생성이 제한 시간 안에 완료
- batch 중 MySQL 연결을 오래 점유하지 않음
- chunk write가 정상 동작
- 생성 결과 조회가 인덱스를 사용

## 19. MVP 결정값

```text
generation_version: v1
fixed_stat_budget: 300
classes: 8종
skills: 40종
card_skills_per_card: 3개
custom_tags_per_card: 최대 4개
generated_tags_per_card: 최대 10개
config_storage: system_configs 단일 JSON + TTL cache
card_catalog_cache_ttl_ms: 기본 300000
```

MVP에서는 너무 많은 클래스와 스킬을 처음부터 넣지 않는다. 먼저 전투 엔진과 생성 규칙이 안정적으로 동작하는지 검증한 뒤 시즌 단위로 확장한다.

## 20. 반드시 지켜야 할 결정 사항

1. 같은 스트리머 카드는 모든 유저에게 같은 능력을 가진다.
2. 스트리머가 설정하지 않은 카드도 기본 능력을 가진다.
3. 자동 생성은 `channel_id` 기반 deterministic seed를 사용한다.
4. 치카포 시세, 팔로워, 방송 중 여부, 채팅량, 포인트, 카드 보유량은 카드 능력 생성에 사용하지 않는다.
5. 자동 생성 카드와 직접 설정 카드는 같은 파워 예산과 금지 조합 검사를 통과해야 한다.
6. 3,000장 카드는 요청마다 DB 개별 조회하지 않고, 스트리머 목록과 설정 맵을 캐시한 뒤 결정적으로 생성한다.
7. 스트리머 opt-out 카드는 아레나 사용 가능 상태에서 제외한다.
8. 시즌 중 카드 능력 변경은 최소화하고, 원칙적으로 다음 시즌에 반영한다.




