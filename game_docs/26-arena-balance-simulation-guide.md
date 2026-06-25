# 치카포 아레나 밸런스 시뮬레이션 가이드

## 1. 목적

이 문서는 카드 클래스, 스탯, 스킬, 태그, 전술 칩, 라운드 플랜, 전장 규칙이 실제 전투 시뮬레이터에서 작동하는지 확인하고 밸런스 위험 신호를 찾는 방법을 정의한다.

시뮬레이션은 오프라인으로 실행한다. DB를 읽거나 쓰지 않으며, 포인트, 시세, 방송 상태, 보유량, 유료 코스메틱은 전투 입력으로 사용하지 않는다.

## 2. 실행

루트에서 실행한다.

```powershell
npm run arena:balance
```

기본값:

```text
ARENA_BALANCE_CARD_COUNT=480
ARENA_BALANCE_DECK_COUNT=160
ARENA_BALANCE_MATCHES=800
ARENA_BALANCE_ELITE_MATCHES=6000 또는 match_count 중 작은 값
ARENA_BALANCE_ELITE_PERCENT=0.2
ARENA_BALANCE_SIDE_SWAP=true
ARENA_BALANCE_MIN_SAMPLE=30
ARENA_BALANCE_UPPER_WARN=0.58
ARENA_BALANCE_LOWER_WARN=0.42
```

더 크게 돌릴 때:

```powershell
$env:ARENA_BALANCE_CARD_COUNT="3000"
$env:ARENA_BALANCE_DECK_COUNT="1200"
$env:ARENA_BALANCE_MATCHES="20000"
$env:ARENA_BALANCE_ELITE_MATCHES="8000"
$env:ARENA_BALANCE_MIN_SAMPLE="200"
$env:ARENA_BALANCE_SEED="arena-balance-final-a"
npm run arena:balance
```

## 3. 출력

결과는 `reports` 폴더에 저장된다.

```text
reports/arena-balance-simulation-*.json
reports/arena-balance-simulation-*.csv
```

JSON은 상세 진단용이다.

CSV는 클래스, 스킬, 태그, 스탯 성향, 전술 칩별 승률 비교용이다.

CSV의 `metric_scope`:

- `overall`: 전체 생성 덱 풀에서 측정한 일반 메타 지표
- `elite`: `overall` 결과에서 승률 상위 비율(`ARENA_BALANCE_ELITE_PERCENT`) 덱만 다시 대전시킨 상위권 메타 지표

## 4. 측정 지표

스크립트는 다음 단위로 승률을 집계한다.

- `class_single`
- `class_combo`
- `skill_single`
- `tag_single`
- `stat_focus`
- `strategy_chip`
- `tactic_style`
- `focus_rule`
- `battlefield_rule`

각 지표는 덱 결과 기반 attribution이다. 특정 클래스나 스킬이 들어간 덱이 얼마나 자주 이겼는지를 보는 방식이므로, 라이브 서비스 최종 밸런스가 아니라 위험 후보를 찾는 용도다.

`ARENA_BALANCE_SIDE_SWAP=true`이면 같은 pairing을 양쪽 진영으로 한 번씩 실행한다. 이 값은 기본 활성화한다. 선공, 타겟팅 tie-break, 플레이어/상대 side 편향을 줄이기 위한 검증용 설정이다.

밸런스 패치 우선순위:

1. `elite`에서 여러 seed에 걸쳐 반복되는 `class_single`, `skill_single`, `stat_focus`, `strategy_chip`
2. `overall`과 `elite`가 같은 방향으로 튀는 항목
3. `overall`만 튀지만 신규/일반 유저 경험을 크게 해칠 수 있는 항목
4. `class_combo`는 조합 수가 많고 표본이 갈라지므로 단독 패치 근거로 쓰지 않는다.

## 5. 판정 기준

기본 판정:

| flag | 기준 |
| --- | --- |
| `OVERPERFORMING` | 표본 충족, 승률 58% 이상 |
| `UNDERPERFORMING` | 표본 충족, 승률 42% 이하 |
| `WATCH` | 정상 범위지만 50%에서 6%p 이상 이탈 |
| `LOW_SAMPLE` | 표본 부족 |
| `NORMAL` | 즉시 조정 불필요 |

정식 밸런스 패치 후보는 단일 실행 결과가 아니라 여러 seed와 실데이터 스냅샷을 함께 보고 결정한다.

## 6. 현재 구현상 주의점

전투 시뮬레이터는 다음을 실제 계산에 반영한다.

- 클래스별 스탯 경향
- 액티브 스킬 타입 일부
- 서포터 회복
- 가디언 보호막
- 공격형 클래스 피해 계수
- 전술 성향
- 타겟 우선순위
- 전술 칩
- 전장 규칙
- 5판 3선승 조기 종료

현재 상대적으로 단순화된 부분:

- 모든 스킬 태그가 개별 고유 효과로 작동하지는 않는다.
- 패시브/ultimate는 설명 데이터로 존재하지만 전투 엔진에서는 일부 클래스/행동 패턴으로 압축 반영된다.
- 태그 승률은 태그 자체 효과라기보다 해당 태그를 가진 카드/스킬 조합의 결과다.
- 전장 규칙은 양쪽 덱에 동시에 적용되므로 CSV에서는 승패 편향 지표가 아니라 표본 확인용으로 본다.

## 6.1 최근 기준선

2026-06-25 이전 기준선:

```text
조건:
  cards=3000
  decks=1200
  matches=20000
  elite_matches=8000
  side_swap=true
  seeds=arena-balance-baseline-a/b/c

비조합 지표:
  overall avg_abs_dev=0.02, max_abs_dev=0.14, watchish=17
  elite   avg_abs_dev=0.01, max_abs_dev=0.06, watchish=1

주요 문제:
  overall backline_guard 평균 60%
  overall anti_burst 평균 43%
  elite anti_burst 평균 45%
  overall skill_cycle 평균 56%
```

2026-06-25 최종 보정 기준:

```text
조건:
  cards=3000
  decks=1200
  matches=20000
  elite_matches=8000
  side_swap=true
  seeds=arena-balance-final-a/b

report:
  reports/arena-balance-simulation-2026-06-25T07-06-37-419Z.json
  reports/arena-balance-simulation-2026-06-25T07-06-37-419Z.csv
  reports/arena-balance-simulation-2026-06-25T07-09-18-119Z.json
  reports/arena-balance-simulation-2026-06-25T07-09-18-119Z.csv

비조합 지표:
  overall avg_abs_dev=0.02, max_abs_dev=0.09, watchish=5
  elite   avg_abs_dev=0.01, max_abs_dev=0.06, watchish=1
```

개선된 항목:

- `overall backline_guard`: 60% -> 54%
- `overall skill_cycle`: 56% -> 49%
- `overall anti_burst`: 43% -> 54%
- `elite anti_burst`: 45% -> 51%
- `overall none`: 44% -> 47%
- `overall supporter`: 53% -> 51%

남은 주의 후보:

- `overall stat_focus=focus`는 약 41%로 낮다. 다만 `elite stat_focus=focus`는 약 47%라 상위권 선택지로는 허용권이다.
- 일부 `class_combo`는 여전히 크게 튄다. 조합 단위는 표본과 매칭 상대 영향을 크게 받으므로, 실제 운영 통계에서도 반복될 때만 조정한다.
- 기본 시뮬레이션은 자동 생성 카드 중심이다. 스트리머 직접 설정 카드가 늘어나면 실제 설정 스냅샷 CSV를 함께 비교한다.

## 7. 운영 반영 절차

1. 기본 시뮬레이션을 실행한다.
2. `OVERPERFORMING`, `UNDERPERFORMING` 상위 후보를 확인한다.
3. seed를 바꿔 2~3회 반복한다.
4. 공통으로 튀는 클래스/스킬/태그만 후보로 둔다.
5. 관리자 통계 CSV와 비교한다.
6. 조정이 필요하면 `arenaCatalog`, `arenaRules`, `arenaBattleSimulator` 중 원인 위치를 좁힌다.
7. 조정 후 같은 조건으로 재실행한다.

## 8. 금지

- 시뮬레이션 결과만 보고 즉시 라이브 패치
- 표본 부족 지표를 하향/상향 후보로 확정
- 포인트, 시세, 방송 여부, 보유량을 시뮬레이션 입력에 추가
- 유료 코스메틱 장착 여부를 전투 입력에 추가
