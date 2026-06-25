# 치카포 아레나 클래스, 스킬, 태그 데이터 사전

## 1. 목적

이 문서는 치카포 아레나 MVP에서 사용할 역할군, 클래스, 스탯 프로필, 액티브 스킬, 패시브 스킬, 시너지 태그의 데이터 사전이다.

이 문서는 다음 기획서를 따른다.

- `03-arena-battle-system.md`: 5판 3선승 세트 전투, 2행 x 4열 보드, 6장 출전, 서버 시뮬레이션
- `04-arena-card-generation-system.md`: `channel_id` 기반 결정적 자동 생성, 파워 예산, 금지 조합, fallback

MVP 목표 수량:

```text
역할군: 6종
클래스: 24종
스탯 프로필: 16종
액티브 스킬: 40종
패시브 스킬: 60종
시너지 태그: 30종
```

## 2. 공통 데이터 규칙

### 2.1 ID 규칙

ID는 영문 소문자와 `_`만 사용한다.

예:

```text
shield_knight
arcane_burst
start_barrier
guardian
```

### 2.2 Power Cost 범위

기본 파워 예산:

```text
TOTAL_POWER_BUDGET = 100
STAT_BUDGET = 45
ACTIVE_SKILL_BUDGET = 30
PASSIVE_SKILL_BUDGET = 15
SYNERGY_BUDGET = 10
```

권장 cost 범위:

```text
stat_profile.power_cost: 38~52
active_skill.power_cost: 22~38
passive_skill.power_cost: 8~22
tag.power_cost: 2~6
```

최종 카드 허용 범위:

```text
95 <= power_score <= 105
```

### 2.3 세트 매치 고려

치카포 아레나는 5판 3선승이다. 따라서 한 라운드만 강한 카드보다, 플랜별 배치를 바꿨을 때 성격이 달라지는 카드가 좋다.

데이터 설계 기준:

- 1라운드 전용 초반 폭발 카드가 과도하게 강하면 안 된다.
- 3라운드까지 갈 때만 강해지는 효과는 너무 느리면 안 된다.
- 라운드 간 누적 스택은 MVP에서 금지한다.
- 모든 효과는 라운드 단위로 초기화한다.
- 세트 스코어를 직접 참조하는 스킬은 MVP에서 만들지 않는다.

## 3. 역할군 6종

| role_id | 이름 | 핵심 역할 | 권장 위치 | 밸런스 주의 |
|---|---|---|---|---|
| `tank` | 탱커 | 전열 유지, 도발, 피해 흡수 | 전열 | 회복/보호막과 결합 시 전투 지연 주의 |
| `bruiser` | 브루저 | 버티며 누적 피해 | 전열 | 딜러보다 순간 화력이 높으면 안 됨 |
| `damage` | 딜러 | 단일 처치, 후열 압박 | 후열/전열 | 생존 유틸을 과하게 주면 안 됨 |
| `caster` | 캐스터 | 광역 피해, 상태이상 | 후열 | 광역 CC와 고계수 피해 결합 주의 |
| `support` | 서포터 | 회복, 보호, 버프, 해제 | 후열 | 유지력이 과하면 세트 시간이 길어짐 |
| `trickster` | 트릭스터 | 위치 교란, 침묵, 회피 | 유동 | 불쾌한 행동불능 연쇄 주의 |

## 4. 클래스 24종

### 4.1 탱커 클래스

| class_id | 이름 | 콘셉트 | 권장 스탯 | 권장 태그 | 금지/주의 |
|---|---|---|---|---|---|
| `shield_knight` | 방패기사 | 도발과 보호막으로 전열 고정 | `high_defense`, `high_hp` | `guardian`, `order`, `frontline` | 고계수 광역 피해 금지 |
| `iron_wall` | 철벽수호자 | 피해 감소와 상태 저항 | `fortress`, `tenacity` | `guardian`, `stone`, `frontline` | 회복 패시브 중첩 주의 |
| `vanguard` | 선봉대장 | 전투 시작 돌파, 아군 보호 | `balanced_guard`, `tempo_guard` | `frontline`, `command`, `order` | 시작 기절과 조합 주의 |
| `ward_keeper` | 결계지기 | 광역 보호막과 피해 분산 | `high_hp`, `barrier` | `guardian`, `arcane`, `support_link` | 보호막 총량 상한 엄수 |

### 4.2 브루저 클래스

| class_id | 이름 | 콘셉트 | 권장 스탯 | 권장 태그 | 금지/주의 |
|---|---|---|---|---|---|
| `duelist` | 결투가 | 같은 대상을 오래 때릴수록 강함 | `balanced_fighter`, `crit_fighter` | `duel`, `focus`, `blade` | 후열 즉사 금지 |
| `berserker` | 폭주전사 | 체력이 낮을수록 공격적 | `high_attack`, `low_guard` | `rage`, `blade`, `frontline` | 흡혈 과다 주의 |
| `pursuer` | 추격자 | 약한 적 마무리 | `speed_fighter`, `balanced_fighter` | `hunt`, `speed`, `duel` | 처치 후 재행동 제한 |
| `breaker` | 파쇄자 | 보호막/방어 카운터 | `heavy_attack`, `tenacity` | `breaker`, `stone`, `frontline` | 탱커 완전 무력화 금지 |

### 4.3 딜러 클래스

| class_id | 이름 | 콘셉트 | 권장 스탯 | 권장 태그 | 금지/주의 |
|---|---|---|---|---|---|
| `sniper` | 저격수 | 후열 단일 고화력 | `long_range`, `crit_glass` | `focus`, `precision`, `backline` | 타겟 확정 즉사 금지 |
| `assassin` | 암살자 | 약한 후열 급습 | `speed_glass`, `crit_glass` | `shadow`, `hunt`, `speed` | 회피+무적 중첩 주의 |
| `rapid_gunner` | 속사수 | 빠른 기본 공격 | `high_speed`, `long_range` | `precision`, `speed`, `machine` | on-hit 패시브 폭주 주의 |
| `executioner` | 처형자 | 낮은 체력 대상 마무리 | `high_attack`, `focus_fire` | `hunt`, `duel`, `shadow` | 처형 기준 엄격히 제한 |

### 4.4 캐스터 클래스

| class_id | 이름 | 콘셉트 | 권장 스탯 | 권장 태그 | 금지/주의 |
|---|---|---|---|---|---|
| `fire_mage` | 화염술사 | 광역 지속 피해 | `skill_power`, `low_guard` | `flame`, `arcane`, `backline` | 화상 중첩 상한 엄수 |
| `frost_mage` | 서리술사 | 둔화와 제한적 빙결 | `control_caster`, `tenacity_caster` | `frost`, `arcane`, `control` | 장시간 행동불능 금지 |
| `storm_caller` | 폭풍소환사 | 무작위 연쇄 피해 | `skill_power`, `energy_caster` | `storm`, `arcane`, `chain` | 연쇄 이벤트 수 제한 |
| `curse_weaver` | 저주술사 | 약화, 취약, 중독 | `control_caster`, `low_guard` | `curse`, `poison`, `control` | 회복 감소 과다 주의 |

### 4.5 서포터 클래스

| class_id | 이름 | 콘셉트 | 권장 스탯 | 권장 태그 | 금지/주의 |
|---|---|---|---|---|---|
| `healer` | 치유사 | 단일/광역 회복 | `support_core`, `backline_safe` | `healing`, `light`, `support_link` | 초당 회복 상한 엄수 |
| `bard` | 음유지원가 | 공격 속도/에너지 보조 | `support_core`, `energy_support` | `song`, `command`, `light` | 에너지 루프 금지 |
| `tactician` | 전술가 | 배치와 집중 공격 보조 | `balanced_support`, `tempo_support` | `command`, `focus`, `order` | 저격수와 폭딜 중첩 주의 |
| `purifier` | 정화자 | 디버프 해제와 상태 저항 | `tenacity_support`, `backline_safe` | `light`, `guardian`, `cleanse` | CC 카운터가 과하면 안 됨 |

### 4.6 트릭스터 클래스

| class_id | 이름 | 콘셉트 | 권장 스탯 | 권장 태그 | 금지/주의 |
|---|---|---|---|---|---|
| `trapper` | 함정공 | 전투 시작/시간차 함정 | `tempo_trick`, `control_trick` | `trap`, `machine`, `control` | 시작 광역 기절 금지 |
| `illusionist` | 환영술사 | 회피, 분신성 교란 | `evasion_trick`, `energy_trick` | `shadow`, `arcane`, `trick` | 분신 수 제한 |
| `disruptor` | 교란자 | 침묵, 에너지 감소 | `control_trick`, `speed_trick` | `control`, `shadow`, `storm` | 침묵 지속시간 제한 |
| `switcher` | 위치술사 | 위치 교환과 끌어오기 | `tempo_trick`, `balanced_trick` | `trick`, `command`, `space` | 강제 이동 빈도 제한 |

## 5. 스탯 프로필 16종

| stat_profile_id | 이름 | 권장 역할군 | 성향 | power_cost |
|---|---|---|---|---|
| `high_hp` | 고체력 | 탱커, 브루저 | 높은 hp, 낮은 공격 | 45 |
| `high_defense` | 고방어 | 탱커 | 높은 defense/status_resist | 46 |
| `fortress` | 요새형 | 탱커 | 매우 높은 방어, 낮은 속도 | 48 |
| `balanced_guard` | 균형 수비 | 탱커, 서포터 | 체력/방어 균형 | 44 |
| `balanced_fighter` | 균형 전투 | 브루저 | 공방 균형 | 45 |
| `high_attack` | 고공격 | 브루저, 딜러 | 높은 attack, 낮은 방어 | 46 |
| `heavy_attack` | 중타격 | 브루저 | 낮은 속도, 높은 한방 | 45 |
| `speed_fighter` | 속도 전투 | 브루저, 트릭스터 | 높은 attack_speed | 47 |
| `crit_glass` | 치명 유리대포 | 딜러 | 높은 crit, 낮은 hp | 48 |
| `long_range` | 장거리 | 딜러, 캐스터 | range 4, 낮은 방어 | 46 |
| `skill_power` | 주문 화력 | 캐스터 | 높은 스킬 계수 보정 | 47 |
| `energy_caster` | 에너지 주문 | 캐스터 | 높은 energy_gain | 46 |
| `control_caster` | 제어 주문 | 캐스터 | 상태 적용, 낮은 공격 | 45 |
| `support_core` | 지원 핵심 | 서포터 | 생존/에너지 균형 | 44 |
| `backline_safe` | 후열 안정 | 서포터, 캐스터 | 낮은 공격, 높은 생존 | 43 |
| `tempo_trick` | 템포 교란 | 트릭스터 | 속도/에너지 중심 | 46 |

## 6. 액티브 스킬 40종

| skill_id | 이름 | 역할군 | 효과 요약 | target | power_cost | 주의 |
|---|---|---|---|---|---:|---|
| `guard_stance` | 수호 태세 | tank | 6초간 피해 감소, 도발 | self | 30 | 회복과 중첩 주의 |
| `shield_bash` | 방패 가격 | tank | 단일 피해, 짧은 기절 | front_enemy | 31 | 기절 1.25초 이하 |
| `team_barrier` | 단체 보호막 | tank/support | 아군 3명 보호막 | lowest_allies | 34 | 보호막 상한 |
| `damage_share` | 피해 분산 | tank | 5초간 아군 피해 일부 대신 받음 | allies | 32 | 무적 조합 금지 |
| `taunting_roar` | 도발의 외침 | tank | 전열 광역 도발 | enemy_front | 28 | 지속 3초 이하 |
| `iron_recovery` | 강철 회복 | tank | 자신 회복, 받는 회복 감소 적용 | self | 27 | 초당 회복 상한 |
| `duel_mark` | 결투 표식 | bruiser | 대상 표식, 자신 피해 증가 | single_enemy | 29 | 표식 중복 불가 |
| `wild_swing` | 난폭한 일격 | bruiser | 전열 2명 피해 | enemy_front_two | 30 | 광역 흡혈 제한 |
| `pursuit_strike` | 추격 타격 | bruiser | 가장 낮은 체력 적 공격 | lowest_enemy | 31 | 처형과 중첩 주의 |
| `armor_break` | 갑옷 파쇄 | bruiser | 피해, 방어 감소 | single_enemy | 30 | 방어 감소 상한 |
| `counter_ready` | 반격 준비 | bruiser/tank | 다음 피해 후 반격 | self | 26 | 반격 1회 |
| `blood_drive` | 혈기 폭주 | bruiser | 5초간 공속 증가, 방어 감소 | self | 28 | 흡혈 중첩 주의 |
| `precise_shot` | 정밀 사격 | damage | 후열 단일 고피해 | back_enemy | 32 | 확정 즉사 금지 |
| `rapid_fire` | 연속 사격 | damage | 3회 낮은 피해 | single_enemy | 30 | on-hit 제한 |
| `execute` | 마무리 일격 | damage | 낮은 체력 대상 추가 피해 | lowest_enemy | 33 | 기준 30% 이하 |
| `piercing_line` | 관통선 | damage | 같은 열 관통 피해 | column | 31 | 최대 3명 |
| `shadow_step` | 그림자 진입 | damage/trickster | 후열 대상 공격 후 복귀 | back_enemy | 34 | 무적 시간 없음 |
| `focus_burst` | 집중 폭발 | damage | 표식 대상 큰 피해 | marked_enemy | 32 | 표식 필요 |
| `fireball` | 화염구 | caster | 대상 주변 피해, 화상 | cluster | 31 | 화상 2중첩 |
| `flame_field` | 화염 지대 | caster | 5초 지면 피해 | area | 34 | 이벤트 압축 필요 |
| `frost_bind` | 서리 결박 | caster | 피해, 둔화, 낮은 확률 빙결 | single_enemy | 32 | 빙결 1초 |
| `ice_wall` | 얼음 장벽 | caster | 아군 전열 보호막, 적 둔화 | front_area | 30 | 보호막 상한 |
| `chain_lightning` | 연쇄 번개 | caster | 최대 4명 연쇄 피해 | chain_enemy | 33 | 연쇄 수 제한 |
| `storm_zone` | 폭풍 구역 | caster | 무작위 적 반복 피해 | random_enemies | 35 | 로그 폭증 주의 |
| `curse_mark` | 저주 표식 | caster | 취약, 중독 | single_enemy | 30 | 취약 중첩 제한 |
| `mass_weaken` | 집단 약화 | caster | 적 3명 공격 감소 | enemy_three | 31 | 지속 5초 이하 |
| `single_heal` | 집중 치유 | support | 가장 낮은 아군 회복 | lowest_ally | 28 | 회복 상한 |
| `group_heal` | 합창 치유 | support | 아군 전체 소량 회복 | allies | 34 | 초당 회복 제한 |
| `cleanse` | 정화 | support | 아군 2명 디버프 해제 | debuffed_allies | 27 | CC 완전 무력화 금지 |
| `battle_song` | 전투의 노래 | support | 아군 3명 공속 증가 | allies_three | 31 | 에너지 루프 주의 |
| `energy_tune` | 에너지 조율 | support | 아군 2명 에너지 회복 | allies_two | 32 | 발동 빈도 제한 |
| `focus_order` | 집중 명령 | support | 아군이 같은 대상 우선 공격 | enemy_target | 29 | 저격 조합 주의 |
| `trap_trigger` | 함정 발동 | trickster | 전열 적 피해, 속박 | enemy_front | 30 | 시작 발동 금지 |
| `silence_dart` | 침묵 표창 | trickster | 단일 침묵 | caster_or_high_energy | 31 | 침묵 2.5초 |
| `swap_positions` | 위치 교환 | trickster | 아군/적 위치 교환 | unit_pair | 32 | 1초 이동 제한 |
| `pull_backline` | 후열 끌기 | trickster | 후열 1명 앞으로 이동 | back_enemy | 34 | 빈 칸 없으면 실패 |
| `mirror_image` | 환영 생성 | trickster | 약한 분신 1체 | self_adjacent | 32 | 소환수 상한 |
| `smoke_screen` | 연막 | trickster | 아군 2명 회피 증가 | allies_two | 30 | 회피 상한 |
| `mana_burn` | 에너지 소각 | trickster | 피해, 에너지 감소 | high_energy_enemy | 31 | 에너지 35 이하 감소 |
| `time_skip` | 시간 건너뛰기 | trickster/caster | 자신 쿨다운 단축 | self | 29 | 연속 발동 금지 |

## 7. 패시브 스킬 60  종

| passive_id | 이름 | 역할군 | 발동 조건 | 효과 요약 | power_cost | 제한 |
|---|---|---|---|---|---:|---|
| `start_barrier` | 시작 보호막 | tank/support | 라운드 시작 | 자신 보호막 | 14 | hp 25% 이하 |
| `front_guard` | 전열 수비 | tank | 전열 배치 | 피해 감소 | 15 | 후열 무효 |
| `last_stand` | 최후 방어 | tank | hp 35% 이하 1회 | 피해 감소 | 18 | 라운드 1회 |
| `taunt_on_hit` | 응수 도발 | tank | 피격 시 확률 | 공격자 도발 | 16 | 쿨다운 6초 |
| `shield_mastery` | 보호막 숙련 | tank | 보호막 획득 | 보호막 효율 증가 | 16 | 총량 상한 적용 |
| `sturdy_body` | 단단한 몸 | tank | 상시 | 상태 저항 증가 | 12 | CC 면역 불가 |
| `ally_cover` | 엄호 | tank | 인접 아군 피격 | 피해 일부 대신 받음 | 17 | 초당 상한 |
| `slow_but_sure` | 묵직한 전진 | tank | 상시 | 공속 감소, 방어 증가 | 13 | 생성 보정용 |
| `rage_stack` | 분노 축적 | bruiser | 피격 시 | 공격 증가 스택 | 16 | 최대 5 |
| `wound_power` | 상처의 힘 | bruiser | hp 낮을수록 | 공격 증가 | 17 | hp 30% 이하 상한 |
| `duel_focus` | 결투 집중 | bruiser | 같은 대상 연속 공격 | 피해 증가 | 15 | 최대 4스택 |
| `counter_instinct` | 반격 본능 | bruiser | 회피/피격 후 확률 | 기본 반격 | 16 | 5초 쿨다운 |
| `armor_crack_hit` | 균열 타격 | bruiser | 기본 공격 | 낮은 방어 감소 | 14 | 최대 3스택 |
| `battle_tenacity` | 전투 끈기 | bruiser | 상태이상 종료 | 에너지 획득 | 13 | 루프 금지 |
| `finisher_drive` | 마무리 본능 | bruiser | 적 처치 관여 | 공속 증가 | 17 | 1회 5초 |
| `heavy_momentum` | 중량 가속 | bruiser | 공격 간격 길수록 | 다음 피해 증가 | 14 | 최대 30% |
| `backline_focus` | 후열 집중 | damage | 후열 배치 | 공격 증가 | 15 | 전열 무효 |
| `crit_rhythm` | 치명 리듬 | damage | 치명타 실패 연속 | 치명 확률 증가 | 14 | 성공 시 초기화 |
| `first_shot` | 선제 사격 | damage | 라운드 시작 후 첫 공격 | 추가 피해 | 16 | 1회 |
| `marked_damage` | 표식 사냥 | damage | 표식 대상 공격 | 추가 피해 | 15 | 표식 필요 |
| `low_hp_hunter` | 약자 추적 | damage | 낮은 hp 대상 공격 | 피해 증가 | 16 | 기준 40% 이하 |
| `steady_aim` | 조준 유지 | damage | 이동 없음 | 공격 증가 | 13 | 강제 이동 시 해제 |
| `reload_cycle` | 장전 순환 | damage | 3번째 공격 | 추가 피해 | 15 | on-hit 제한 |
| `glass_focus` | 유리 집중 | damage | 상시 | 공격 증가, 받는 피해 증가 | 12 | 생성 보정용 |
| `burning_touch` | 불씨 | caster | 스킬 피해 | 화상 부여 | 15 | 화상 상한 |
| `frost_trace` | 서리 흔적 | caster | 스킬 적중 | 둔화 부여 | 14 | 중첩 제한 |
| `arcane_charge` | 비전 충전 | caster | 시간 경과 | 에너지 소량 획득 | 16 | 초당 상한 |
| `spell_echo` | 주문 메아리 | caster | 스킬 사용 후 확률 | 약한 추가 피해 | 18 | 라운드 3회 |
| `curse_spread` | 저주 확산 | caster | 중독 대상 사망 | 주변 중독 | 17 | 이벤트 제한 |
| `control_focus` | 제어 집중 | caster | 상태 적용 성공 | 에너지 획득 | 14 | 루프 금지 |
| `fragile_magic` | 불안정 마력 | caster | 상시 | 스킬 강함, 체력 낮음 | 12 | 생성 보정용 |
| `area_discipline` | 광역 절제 | caster | 광역 스킬 | 대상 많을수록 계수 감소 | 8 | 밸런스 안전장치 |
| `healing_touch` | 치유 손길 | support | 기본 공격 후 확률 | 아군 소량 회복 | 14 | 초당 상한 |
| `emergency_heal` | 응급 치유 | support | 아군 hp 30% 이하 | 단일 회복 | 18 | 라운드 2회 |
| `clean_start` | 맑은 시작 | support | 라운드 시작 | 아군 상태 저항 | 15 | 6초 |
| `song_memory` | 노래의 여운 | support | 버프 종료 | 소량 에너지 | 14 | 루프 금지 |
| `shared_courage` | 나누는 용기 | support | 아군 사망 | 남은 아군 보호막 | 17 | 라운드 1회 |
| `backline_aura` | 후열 오라 | support | 후열 배치 | 인접 아군 방어 증가 | 15 | 위치 의존 |
| `soft_cleanse` | 약식 정화 | support | 8초마다 | 가장 긴 디버프 단축 | 13 | 완전 해제 아님 |
| `support_focus` | 지원 집중 | support | 치유/보호막 후 | 자신 에너지 획득 | 14 | 초당 상한 |
| `trap_ready` | 매설 준비 | trickster | 라운드 시작 3초 후 | 적 전열 피해 | 16 | 기절 없음 |
| `evasive_step` | 회피 동작 | trickster | 피격 시 확률 | 피해 감소 | 16 | 4초 쿨다운 |
| `silence_edge` | 침묵의 칼날 | trickster | 고에너지 적 공격 | 짧은 침묵 | 17 | 1.5초 |
| `energy_leak` | 에너지 누출 | trickster | 스킬 적중 | 에너지 감소 | 15 | 감소 상한 |
| `position_sense` | 위치 감각 | trickster | 강제 이동 후 | 회피 증가 | 13 | 4초 |
| `mirror_guard` | 환영 방패 | trickster | hp 40% 이하 | 약한 분신 | 18 | 라운드 1회 |
| `trick_chain` | 속임수 연계 | trickster | 상태 적용 후 | 다음 기본공격 강화 | 14 | 중첩 불가 |
| `unstable_plan` | 불안정한 계획 | trickster | 라운드 시작 | 무작위 소버프 | 10 | 낮은 cost 변동 |
| `guardian_bond` | 수호 결속 | any | guardian 2+ | 보호막 효율 증가 | 12 | 태그 조건 |
| `flame_bond` | 화염 결속 | any | flame 2+ | 화상 피해 증가 | 12 | 중첩 상한 |
| `shadow_bond` | 그림자 결속 | any | shadow 2+ | 첫 공격 강화 | 12 | 라운드 1회 |
| `order_bond` | 질서 결속 | any | order 2+ | 전열 방어 증가 | 12 | 위치 조건 |
| `machine_bond` | 기계 결속 | any | machine 2+ | 3번째 공격 강화 | 12 | on-hit 제한 |
| `arcane_bond` | 비전 결속 | any | arcane 2+ | 에너지 획득 증가 | 13 | 루프 검사 |
| `hunt_bond` | 사냥 결속 | any | hunt 2+ | 낮은 hp 대상 피해 증가 | 13 | 처형과 중첩 주의 |
| `command_bond` | 지휘 결속 | any | command 2+ | 같은 대상 공격 시 보너스 | 13 | 저격 조합 주의 |
| `light_bond` | 빛 결속 | any | light 2+ | 회복량 소폭 증가 | 12 | 회복 상한 |
| `control_bond` | 제어 결속 | any | control 2+ | 상태 적용 확률 증가 | 13 | CC 지속 제한 |
| `speed_bond` | 속도 결속 | any | speed 2+ | 공속 증가 | 12 | on-hit 제한 |
| `frontline_bond` | 전열 결속 | any | frontline 2+ | 전열 생존력 증가 | 12 | 탱커 과다 주의 |

## 8. 시너지 태그 30종

시너지 단계는 MVP 기준 2/4/6을 사용한다.

| tag_id | 이름 | 2단계 | 4단계 | 6단계 | power_cost | 주의 |
|---|---|---|---|---|---:|---|
| `guardian` | 수호 | 보호막 +5% | +10% | +16% | 4 | 보호막 상한 |
| `frontline` | 전열 | 전열 방어 +5 | +12 | +20 | 3 | 탱커 과다 |
| `order` | 질서 | 전열 상태저항 +5% | +10% | +18% | 3 | CC 무력화 주의 |
| `command` | 지휘 | 같은 대상 공격 보너스 | 보너스 증가 | 에너지 소량 | 4 | 저격 조합 |
| `duel` | 결투 | 단일 대상 피해 +4% | +8% | +13% | 4 | 탱커 삭제 주의 |
| `focus` | 집중 | 표식 대상 피해 +5% | +10% | +15% | 4 | 표식 필요 |
| `blade` | 검술 | 기본 공격 피해 +4% | +8% | +12% | 3 | 브루저 편향 |
| `rage` | 격노 | 낮은 hp 공격 증가 | 증가 | 증가+저항 | 4 | 흡혈 주의 |
| `hunt` | 사냥 | 낮은 hp 대상 피해 | 증가 | 처치 관여 보너스 | 4 | 처형 중첩 |
| `precision` | 정밀 | 치명 확률 +3% | +7% | +12% | 4 | 치명 상한 |
| `backline` | 후열 | 후열 공격 +4% | +8% | +12% | 3 | 저격 편향 |
| `speed` | 속도 | 공속 +4% | +8% | +13% | 4 | on-hit 제한 |
| `arcane` | 비전 | 에너지 획득 +4% | +8% | +12% | 4 | 에너지 루프 |
| `flame` | 화염 | 화상 피해 +6% | +12% | +20% | 4 | DOT 로그 |
| `frost` | 서리 | 둔화 효율 증가 | 증가 | 빙결 확률 소폭 | 4 | CC 주의 |
| `storm` | 폭풍 | 무작위 피해 +4% | +8% | 연쇄 +1 | 4 | 이벤트 수 |
| `curse` | 저주 | 취약/약화 효율 | 증가 | 지속 증가 | 4 | 불쾌감 |
| `poison` | 독 | 중독 피해 +6% | +12% | 회복 감소 | 4 | 유지력 카운터 |
| `control` | 제어 | 상태 적용 +3% | +7% | +10% | 5 | CC 상한 |
| `healing` | 치유 | 회복 +5% | +10% | +16% | 4 | 회복 상한 |
| `light` | 빛 | 보호/정화 효율 | 증가 | 라운드 시작 저항 | 4 | CC 무력화 |
| `cleanse` | 정화 | 디버프 지속 감소 | 감소 | 1회 해제 | 4 | 카운터 과다 |
| `support_link` | 연결 | 인접 아군 보호 | 증가 | 에너지 보조 | 4 | 배치 의존 |
| `song` | 노래 | 공속 버프 +3% | +7% | +10% | 4 | 에너지 루프 |
| `machine` | 기계 | 3번째 공격 강화 | 강화 | 보호막 파쇄 | 4 | on-hit 제한 |
| `trap` | 함정 | 5초 후 피해 | 피해 증가 | 속박 추가 | 4 | 시작 CC 금지 |
| `shadow` | 그림자 | 첫 공격 피해 | 증가 | 회피 소폭 | 4 | 암살 편향 |
| `trick` | 속임수 | 회피 +3% | +7% | 위치 효과 강화 | 4 | 회피 상한 |
| `space` | 공간 | 강제 이동 후 보너스 | 증가 | 쿨다운 감소 | 4 | 이동 빈도 |
| `stone` | 석갑 | 방어 +4 | +10 | +16 | 3 | 장기전 |

## 9. 금지 조합 태그

스킬과 패시브는 다음 금지 태그를 가질 수 있다.

| forbidden_tag | 설명 |
|---|---|
| `infinite_energy_risk` | 에너지 획득 루프 위험 |
| `infinite_heal_risk` | 회복 루프 위험 |
| `infinite_summon_risk` | 소환 루프 위험 |
| `hard_cc_chain_risk` | 기절/침묵 연쇄 위험 |
| `log_spam_risk` | 이벤트 로그 폭증 위험 |
| `assassin_burst_risk` | 후열 즉사 위험 |
| `stall_risk` | 전투 지연 위험 |
| `untargetable_risk` | 타겟 불가/회피 과다 위험 |

금지 원칙:

- 같은 카드 안에 같은 risk 태그가 2개 이상이면 생성 실패
- 세트 카드 풀에서 특정 risk 조합 승률이 높으면 다음 시즌에서 weight 하향
- `hard_cc_chain_risk`와 `control` 태그 6단계 조합은 별도 시뮬레이션 필수

## 10. 데이터 JSON 기준

실제 구현 데이터는 TypeScript 상수 또는 JSON으로 관리할 수 있다.

권장 구조:

```ts
type ArenaClassDef = {
  id: string;
  name: string;
  role: ArenaRole;
  allowedStatProfiles: string[];
  activeSkillTags: string[];
  passiveSkillTags: string[];
  preferredTags: string[];
  forbiddenSkillTags: string[];
  basePowerModifier: number;
};
```

스킬 정의:

```ts
type ArenaSkillDef = {
  id: string;
  name: string;
  kind: 'active' | 'passive';
  allowedRoles: ArenaRole[];
  allowedClasses?: string[];
  tags: string[];
  effectTemplate: string;
  params: Record<string, number | string | boolean>;
  powerCost: number;
  forbiddenComboTags: string[];
  description: string;
};
```

## 11. MVP 밸런스 주의 항목

특히 조심해야 하는 조합:

- `rapid_gunner` + `speed` 6단계 + `reload_cycle`
- `healer` + `healing` 6단계 + `emergency_heal`
- `frost_mage` + `control` 6단계 + `frost_bind`
- `assassin` + `shadow` 6단계 + `shadow_step`
- `bard` + `arcane` 6단계 + `energy_tune`
- `ward_keeper` + `guardian` 6단계 + `team_barrier`

이 조합은 금지가 아니라 시뮬레이션 우선 검증 대상이다.

## 12. 반드시 지켜야 할 결정 사항

1. 클래스와 스킬은 개별 스트리머 밸런싱이 아니라 템플릿 밸런싱 단위다.
2. 모든 스킬과 태그는 `power_cost`와 금지 조합 태그를 가져야 한다.
3. 라운드 간 누적 스택은 MVP에서 금지한다.
4. 세트 스코어를 직접 참조하는 스킬은 MVP에서 만들지 않는다.
5. 상태이상, 소환, 회복, 보호막, 로그 이벤트는 전투 시스템 문서의 상한을 따라야 한다.
6. 치카포 시세, 팔로워, 방송 중 여부, 채팅량, 포인트, 카드 보유량은 클래스/스킬/태그 효과에 사용하지 않는다.
