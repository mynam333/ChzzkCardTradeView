# 치카포 아레나 기존 구현 폐기 및 v2 마이그레이션 계획

- 문서 버전: v1.0.0-rebuild
- 기준일: 2026-07-07
- 상위 문서: `CHIKAPO_ARENA_GDD.md`
- 관련 문서:
  - `CHIKAPO_ARENA_API_DB_SPEC.md`
  - `CHIKAPO_ARENA_CARD_DATA_DICTIONARY.md`
  - `CHIKAPO_ARENA_UX_WIREFRAMES.md`
- 문서 목적: 현재 구현된 기존 아레나를 새 치카포 아레나 v2로 안전하게 갈아엎는 절차와, 이전 구현 문서 중 삭제해야 할 문서 목록을 확정한다.

---

## 1. 결론

기존 아레나는 새 아레나로 데이터 마이그레이션하지 않는다.

기존 구현은 다음 전제를 갖는다.

- 5판 3선승
- 2행 x 4열 또는 라운드별 출전 플랜 중심 전투
- tick 기반 자동 전투 리플레이
- `hp/attack/defense/speed/focus` 스탯
- 액티브/패시브/궁극기 스킬
- 전술칩, 경기장 규칙, 태그 시너지
- 기존 `arena_` prefix DB 테이블
- 기존 `packages/arena-contract` DTO

새 아레나는 다음 전제로 전면 재구현한다.

- 1전 단위 2행 x 3열 동시 배치형 카드 오토배틀
- 빠른대전/봇전 체력 30
- 8인전 체력 30
- 덱 14~20장
- 손패 최대 8장
- 동일 스트리머 카드 덱당 1장
- 도발, 조준, 밀치기, 끌어오기는 같은 라인에서만 작동
- 시즌은 관리자 탭에서 열고 닫고 설정
- 빠른대전 MMR 기준 시즌 종료 차등 보상
- 상세 리플레이 보존 기간 7일
- 새 `arena_v2_` prefix DB 테이블

따라서 이 작업은 “데이터 이전”이 아니라 “백업 후 새 시스템 교체”다.

---

## 2. 현재 구현 폐기 대상

### 2.1. 백엔드 폐기 대상

아래 파일들은 기존 아레나 규칙과 DB 계약에 강하게 결합되어 있으므로 수정 재사용하지 않고 v2 파일로 대체한다.

| 기존 파일 | 폐기 이유 | v2 대체 방향 |
| --- | --- | --- |
| `backend/src/controllers/arenaController.ts` | 기존 API가 5판 3선승, 컵, 기존 덱/리플레이 계약을 반환 | `arenaV2Controller.ts` 또는 도메인별 router로 신규 작성 |
| `backend/src/services/arenaBattleSimulator.ts` | tick 기반 5판 전투 시뮬레이터 | 2x3 동시 배치 전투 엔진 신규 작성 |
| `backend/src/services/arenaRules.ts` | 전술칩, 경기장 규칙, 기존 세트 포맷 상수 | v2 룰 enum/상수로 교체 |
| `backend/src/services/arenaCatalog.ts` | 기존 클래스/스킬/스탯 생성기 | 카드 데이터 사전 기준 생성기/검증기로 교체 |
| `backend/src/services/arenaDeckService.ts` | 라운드 플랜 덱 구조 | 14~20장 덱, 동일 스트리머 1장 검증으로 교체 |
| `backend/src/services/arenaMatchService.ts` | 라운드 커밋, 기존 리플레이, 기존 MMR 반영 | v2 매치 상태 머신과 리플레이 이벤트 저장으로 교체 |
| `backend/src/services/arenaMatchmakingService.ts` | 기존 빠른대전 큐/세트 매치 생성 | v2 빠른대전 큐와 `arena_v2_matches` 생성으로 교체 |
| `backend/src/services/arenaCupService.ts` | 기존 8인 컵/브래킷 구조 | v2 8인 배틀로얄 라운드 매칭으로 교체 |
| `backend/src/services/arenaSchemaMigration.ts` | 기존 `arena_` 테이블 생성 | `arenaV2SchemaMigration.ts`로 신규 작성 |
| `backend/src/services/arenaSeasonService.ts` | 기존 시즌 phase/config | 관리자 설정형 v2 시즌 상태 머신으로 교체 |
| `backend/src/services/arenaReplayDiagnostics.ts` | 기존 tick replay 진단 | v2 이벤트 replay 검증기로 교체 |
| `backend/src/services/arenaAdmin*` | 기존 운영 지표/작업/감사 일부가 구 스키마 기준 | 필요한 감사/kill switch만 v2 기준으로 재작성 |
| `backend/src/workers/arenaWorker.ts` | 기존 라운드 커밋/배치 작업 기준 | v2 타임아웃 제출, 리플레이 pruning, 시즌 정산 job으로 교체 |

주의:

- 파일명을 그대로 덮어써도 되지만, 전환 기간에는 `arenaV2*` 파일을 먼저 만들고 라우팅 스위치를 바꾼 뒤 구 파일을 삭제하는 편이 안전하다.
- 기존 테스트는 새 테스트의 참고 자료로만 사용하고, 기대값을 고쳐 재사용하지 않는다.

### 2.2. 프론트엔드 폐기 대상

아래 화면은 새 UX 와이어프레임 기준으로 다시 만든다.

| 기존 파일 | 폐기 이유 | v2 대체 방향 |
| --- | --- | --- |
| `frontend/src/app/ArenaTab.tsx` | 기존 아레나 진입/상태 모델 | v2 아레나 홈으로 교체 |
| `frontend/src/app/ArenaLayout.tsx` | 기존 정보 구조 | v2 메뉴: 홈, 덱, 플레이, 랭킹, 위키 |
| `frontend/src/app/ArenaAdminPanel.tsx` | 기존 관리자 통계/설정 | v2 시즌 운영 패널로 교체 |
| `frontend/src/app/arena/**` | 기존 덱/플레이/랭킹/관전/설정/인벤토리 화면 | v2 UX 와이어프레임 기준으로 재작성 |
| `frontend/src/app/arena/matches/ArenaPixiBattleRenderer.tsx` | 기존 tick replay renderer | v2 2x3 보드/동시 공개/라인 전투 Pixi renderer로 교체 |
| `frontend/src/lib/arenaBattleTimeline.ts` | 기존 replay timeline | v2 replay event timeline으로 교체 |
| `frontend/src/lib/arenaBattlePreview.ts` | 기존 전투 preview | v2 배치/전투 preview로 교체 |
| `frontend/src/lib/arenaRuleDescriptions.ts` | 기존 룰 설명 | v2 위키/키워드 설명으로 교체 |
| `frontend/src/lib/arenaVfxPresets.ts` | 일부 참고 가능하나 기존 class/vfx 기준 | v2 클래스 색/키워드 VFX 기준으로 재작성 |

### 2.3. 계약 패키지 폐기 대상

| 기존 파일 | 폐기 이유 | v2 대체 방향 |
| --- | --- | --- |
| `packages/arena-contract/index.d.ts` | 기존 DTO가 `round_plans`, `best_of_five`, `hp/attack/defense/speed/focus`, tick replay 기준 | `ArenaV2*` DTO로 전면 교체 |
| `packages/arena-contract/package.json` | 패키지 자체는 유지 가능 | export 이름과 타입 버전만 v2로 교체 |

### 2.4. DB 폐기 대상

기존 테이블은 배포 직전 백업하고, v2 안정화 후 삭제한다.

삭제 후보:

- `arena_decks`
- `arena_matches`
- `arena_player_ratings`
- `arena_match_replays`
- `arena_rank_snapshots`
- `arena_match_queue`
- `arena_cups`
- `arena_cup_replays`
- `arena_cup_queue`
- `arena_admin_stat_snapshots`
- `arena_admin_jobs`
- `arena_admin_audit_logs`
- 기타 `arena_` prefix의 기존 구현 전용 테이블

유지 여부 검토:

- 스트리머 기본 정보 테이블
- 유저 계정 테이블
- 이미지/업로드 테이블
- 코스메틱 또는 포인트 테이블

위 테이블들은 아레나 전투 데이터가 아니라 서비스 공통 데이터일 수 있으므로 삭제하지 않는다.

---

## 3. 마이그레이션 전략

### 3.1. 핵심 전략

```text
기존 아레나 동결
-> 기존 데이터 백업
-> v2 스키마 병행 생성
-> v2 엔진/API/프론트 구현
-> 내부 테스트
-> 라우팅 스위치오버
-> 구 아레나 읽기 전용 유지 기간
-> 구 데이터 삭제
-> 구 코드 삭제
```

### 3.2. 왜 데이터 변환을 하지 않는가

기존 데이터는 새 게임 규칙과 구조적으로 맞지 않는다.

| 기존 데이터 | v2에서 변환 불가한 이유 |
| --- | --- |
| 라운드 플랜 | v2는 매 턴 손패에서 배치한다 |
| 2x4/라운드 출전 슬롯 | v2는 2x3 지속 필드다 |
| tick replay | v2는 이벤트 기반 동시 공개/전투 로그다 |
| 기존 카드 스탯 | v2는 코스트/공격력/체력/키워드 예산 모델이다 |
| 전술칩/경기장 규칙 | v2에는 포함하지 않는다 |
| 기존 MMR | 게임 규칙이 달라 경쟁력 지표로 승계할 수 없다 |
| 기존 시즌 보상 | v2 시즌 보상은 v2 MMR 등급 기준이다 |

기존 기록은 유저 프로필에 “구 아레나 기록”으로 보존할 수도 있으나, v2 랭킹/보상/매치에는 절대 반영하지 않는다.

---

## 4. 단계별 실행 계획

### 4.1. 0단계: 코드/문서 freeze

목표:

- 기존 아레나에 새 기능을 더하지 않는다.
- 새 기획 기준 문서를 단일 출처로 고정한다.

작업:

1. `CHIKAPO_ARENA_GDD.md`와 하위 문서 4개를 기준 문서로 지정한다.
2. 기존 numbered arena 문서는 삭제 후보로 표시한다.
3. 기존 아레나 관련 PR/작업은 버그 픽스만 허용한다.
4. 새 구현 branch에서는 `arena_v2_` 스키마와 `ArenaV2` 타입만 사용한다.

완료 조건:

- 구현자가 기존 `00~27` 문서를 기준으로 삼지 않는다.
- 새 기능 설계가 `CHIKAPO_ARENA_*` 문서에만 추가된다.

### 4.2. 1단계: 기존 아레나 동결

목표:

- 구 아레나에서 새 매치와 새 보상 발생을 막는다.

작업:

1. 빠른대전 큐 진입 차단
2. 8인 컵 큐 진입 차단
3. 신규 봇전 생성 차단 여부 결정
4. 진행 중 매치는 제한 시간 안에 종료 처리
5. 구 시즌 보상 지급 대기열 중지
6. 관리자 화면에 “기존 아레나 종료 예정” 표시

완료 조건:

- `arena_match_queue`, `arena_cup_queue`에 새 `WAITING` row가 생기지 않는다.
- 진행 중 `arena_matches`가 모두 완료 또는 취소 상태다.

### 4.3. 2단계: 기존 데이터 백업

목표:

- 구 데이터를 삭제하기 전에 복구 가능한 형태로 보관한다.

백업 대상:

- 기존 `arena_` prefix 테이블 전체
- 기존 아레나 관련 설정 파일 또는 환경 변수
- 기존 리플레이 저장소
- 기존 관리자 감사 로그

백업 산출물:

```text
arena_legacy_backup_{yyyyMMdd_HHmm}/
  schema.sql
  arena_decks.*
  arena_matches.*
  arena_player_ratings.*
  arena_match_replays.*
  arena_rank_snapshots.*
  arena_match_queue.*
  arena_cups.*
  arena_cup_replays.*
  arena_cup_queue.*
  arena_admin_*.*
  checksum.txt
  restore_note.md
```

완료 조건:

- 백업 파일 checksum이 생성된다.
- staging DB에서 restore smoke test를 1회 통과한다.
- 백업 경로와 보존 기간이 운영 문서에 기록된다.

### 4.4. 3단계: v2 스키마 병행 생성

목표:

- 기존 테이블을 건드리지 않고 새 테이블을 만든다.

작업:

1. `arena_v2_seasons`
2. `arena_v2_card_versions`
3. `arena_v2_decks`
4. `arena_v2_match_queue`
5. `arena_v2_battle_royale_queue`
6. `arena_v2_matches`
7. `arena_v2_match_players`
8. `arena_v2_card_instances`
9. `arena_v2_action_submissions`
10. `arena_v2_replay_events`
11. `arena_v2_ratings`
12. `arena_v2_reward_grants`
13. `arena_v2_battle_royales`
14. `arena_v2_replay_holds`
15. `arena_v2_reports`
16. `arena_v2_streamer_right_requests`
17. `arena_v2_admin_audit_logs`

완료 조건:

- 기존 `arena_` 테이블과 이름 충돌이 없다.
- migration이 두 번 실행돼도 실패하지 않는다.
- `arena_v2_` 테이블만 대상으로 한 schema smoke test가 통과한다.

### 4.5. 4단계: v2 룰 엔진 구현

목표:

- DB/API 없이 순수 함수로 새 전투를 계산한다.

작업:

1. 카드 데이터 타입 정의
2. 덱 검증기 구현
3. 멀리건 처리
4. 턴 시작 드로우/코스트 처리
5. 배치/이동/교체 검증
6. 라인 제한 키워드 처리
7. 전투 순서 처리
8. 피해/초과 피해/관통/직접 공격 처리
9. 전투불능/묘지 처리
10. 피로 피해/서든데스 처리
11. 리플레이 이벤트 생성

완료 조건:

- 동일 seed와 동일 행동 입력은 항상 동일 결과를 만든다.
- 기존 tick simulator를 import하지 않는다.
- 라인 제한 키워드가 모두 같은 라인에서만 작동한다.
- 동일 스트리머 카드 1장 제한 테스트가 통과한다.

### 4.6. 5단계: v2 API 구현

목표:

- 새 API 계약을 구현하고 구 API와 분리한다.

권장 신규 라우트:

- `/api/arena/season/current`
- `/api/arena/cards`
- `/api/arena/decks`
- `/api/arena/decks/validate`
- `/api/arena/matches`
- `/api/arena/matches/{matchId}/mulligan`
- `/api/arena/matches/{matchId}/turn-action`
- `/api/arena/matches/{matchId}`
- `/api/arena/matches/{matchId}/replay`
- `/api/arena/battle-royales/join`
- `/api/arena/battle-royales/{battleRoyaleId}`
- `/api/arena/wiki`
- `/api/admin/arena/seasons`
- `/api/admin/arena/seasons/{seasonId}/transition`
- `/api/admin/arena/seasons/{seasonId}/grant-rewards`

완료 조건:

- 클라이언트가 승패를 제출할 수 없다.
- 비공개 손패/덱 순서가 상대 응답에 노출되지 않는다.
- 리플레이 만료 시 `ArenaReplayExpired`를 반환한다.
- 시즌 상태별 허용 행동이 강제된다.

### 4.7. 6단계: v2 프론트 구현

목표:

- 기존 화면을 고쳐 쓰지 않고 새 UX 와이어프레임 기준으로 화면을 재작성한다.

작업:

1. 아레나 홈
2. 덱 빌더
3. 카드 상세
4. 멀리건
5. 배치 화면
6. PixiJS 전투 연출
7. 결과 화면
8. 8인전 대기/라운드/결과
9. 위키
10. 랭킹
11. 관리자 시즌 패널
12. 리플레이 목록/재생

완료 조건:

- 2x3 필드가 데스크톱/모바일에서 안정적으로 표시된다.
- PixiJS 캔버스가 빈 화면으로 렌더링되지 않는다.
- 전투 이벤트와 VFX 타이밍이 replay event에 의해 재생된다.
- 위키는 읽기 전용이고 기술 문서를 노출하지 않는다.

### 4.8. 7단계: 내부 검증

필수 검증:

- 룰 엔진 단위 테스트
- 덱 검증 통합 테스트
- API 권한/마스킹 테스트
- 빠른대전 MMR 중복 반영 방지 테스트
- 시즌 상태 전환 테스트
- 보상 dry-run 테스트
- 리플레이 7일 pruning 테스트
- PixiJS 렌더링/반응형 visual QA
- 8인전 홀수 생존자/탈락 순위 테스트

완료 조건:

- 새 v2 테스트가 통과한다.
- 기존 arena 테스트는 삭제되거나 v2 테스트로 대체된다.
- 운영자가 staging에서 시즌 생성부터 보상 dry-run까지 수행할 수 있다.

### 4.9. 8단계: 라우팅 스위치오버

목표:

- 사용자 진입점을 v2로 전환한다.

작업:

1. `/arena` 프론트 라우트를 v2 화면으로 연결
2. `/api/arena/*`를 v2 controller로 연결
3. 구 아레나 API는 내부 관리자 조회 외 비활성화
4. 캐시/SSE/worker가 v2 job만 실행하도록 전환
5. 관리자 패널에서 v2 시즌을 `active`로 전환

완료 조건:

- 새 유저가 구 아레나 화면/API에 도달하지 않는다.
- v2 빠른대전 매치가 생성되고 완료된다.
- v2 리플레이가 7일 만료 시각을 가진다.

### 4.10. 9단계: 구 코드 삭제

목표:

- 전환 후 혼동과 유지보수 비용을 없앤다.

삭제 순서:

1. 구 frontend arena 화면
2. 구 backend arena service/controller
3. 구 arena worker job
4. 구 arena contract DTO
5. 구 tests
6. 구 문서
7. 구 DB 테이블

완료 조건:

- `rg "best_of_five|round_plans|ARENA_TACTIC_CHIPS|arena_decks|arena_matches"` 결과가 백업/마이그레이션 문서를 제외하고 남지 않는다.
- 앱 빌드와 테스트가 v2 기준으로 통과한다.

---

## 5. 롤백 정책

기존 데이터는 v2로 마이그레이션하지 않으므로, v2 배포 후 롤백은 제한적으로만 허용한다.

허용되는 롤백:

- v2 라우팅을 임시 점검 화면으로 전환
- v2 빠른대전/8인전 kill switch 활성화
- v2 시즌 상태를 `locked` 또는 `cancelled`로 전환
- v2 보상 지급 job 중지

권장하지 않는 롤백:

- 구 아레나를 다시 공식 모드로 여는 것
- 구 MMR을 v2 보상 기준으로 쓰는 것
- 구 덱을 v2 덱으로 자동 변환하는 것

구 아레나를 다시 열어야 하는 경우:

1. 백업 DB를 별도 legacy 환경에 복원한다.
2. v2와 같은 `/arena` 경로를 공유하지 않는다.
3. 유저에게 legacy 기록 조회 전용이라고 명확히 표시한다.

---

## 6. 삭제해야 할 이전 구현 문서 목록

아래 문서들은 기존 5판 3선승 아레나 구현을 기준으로 작성되어 새 GDD와 충돌한다. v2 구현이 시작되면 삭제하거나 `archive/legacy_arena_docs/`로 이동한다.

### 6.1. 즉시 삭제 권장

| 문서 | 삭제 이유 |
| --- | --- |
| `game_docs/00-chikapo-arena-document-index.md` | 상위 원칙이 5판 3선승, MVP, 구 문서 체계 기준 |
| `game_docs/01-chikapo-arena-plan.md` | 전체 게임 기획이 구 아레나 기준 |
| `game_docs/02-chikapo-arena-matchmaking-and-ops-plan.md` | 구 빠른대전/운영 부하/큐 정책 기준 |
| `game_docs/03-arena-battle-system.md` | 5판 3선승, tick 전투, 구 리플레이 기준 |
| `game_docs/04-arena-card-generation-system.md` | 구 카드 생성/스탯/스킬 기준 |
| `game_docs/05-arena-classes-skills-tags.md` | 구 클래스, 스킬, 태그 데이터 사전 |
| `game_docs/06-arena-balance-policy.md` | 구 밸런스 수치와 시뮬레이션 기준 |
| `game_docs/07-arena-ux-flow.md` | 구 덱/매치/리플레이 UX 기준 |
| `game_docs/08-arena-backend-db-plan.md` | 구 DB/API 방향 |
| `game_docs/09-arena-rewards-and-monetization-policy.md` | 구 시즌/보상 기준 |
| `game_docs/10-arena-security-and-abuse-policy.md` | 구 전투/리플레이/매칭 구조 기준 |
| `game_docs/11-arena-roadmap-and-launch-checklist.md` | MVP/구 출시 순서 기준 |
| `game_docs/15-arena-api-spec.md` | 구 MVP API 명세 |
| `game_docs/19-arena-api-final-contract.md` | 구 최종 API 계약 |
| `game_docs/23-arena-expanded-strategy-cup-admin-plan.md` | 구 8인 컵/전략 확장/관리자 통계 기준 |
| `game_docs/26-arena-balance-simulation-guide.md` | 구 클래스/스탯/스킬/태그 시뮬레이션 기준 |

### 6.2. 참고 후 삭제 권장

아래 문서는 운영/디자인 관점에서 일부 문장을 참고할 수 있으나, 새 GDD와 하위 명세가 기준이므로 최종적으로는 삭제한다.

| 문서 | 참고 가능한 부분 | 삭제 이유 |
| --- | --- | --- |
| `game_docs/12-arena-incident-runbook.md` | 장애 등급, kill switch 표현 | 구 모드/구 API 기준 |
| `game_docs/13-arena-communication-templates.md` | 공지/장애/보상 문구 형식 | 구 시즌/구 보상 기준 |
| `game_docs/14-arena-privacy-and-replay-policy.md` | 리플레이 개인정보 관점 | v2는 7일 보존과 이벤트 replay 기준 |
| `game_docs/16-arena-risk-register-and-acceptance-criteria.md` | Go/No-Go 형식 | 구 MVP/구 시스템 리스크 기준 |
| `game_docs/17-arena-legal-rights-and-terms-policy.md` | 스트리머 권리 고지 관점 | 새 위키/카드 버전 정책에 맞게 재작성 필요 |
| `game_docs/18-arena-load-test-and-capacity-plan.md` | 부하 테스트 항목 형식 | 구 tick/구 큐/구 replay 저장량 기준 |
| `game_docs/20-arena-content-moderation-policy.md` | 신고/블라인드 운영 관점 | v2 위키/카드/리플레이 구조에 맞게 재작성 필요 |
| `game_docs/21-arena-low-load-optimization-plan.md` | 저부하 운영 사고방식 | v2는 동시 제출/이벤트 replay/시즌 정산 기준 |
| `game_docs/22-arena-site-design-system.md` | 일부 색상/컴포넌트 톤 | 새 상용급 PixiJS/VFX 방향과 통합 필요 |
| `game_docs/23-arena-pixi-battle-renderer-plan.md` | PixiJS 렌더링 고려사항 | 구 전투 화면과 이벤트 구조 기준 |
| `game_docs/24-arena-service-readiness-qa.md` | QA 체크리스트 형식 | v2 수용 기준으로 재작성 필요 |
| `game_docs/25-arena-point-cosmetic-policy.md` | P2W 방지 원칙 | v2 보상/코스메틱 정책으로 재정리 필요 |
| `game_docs/27-arena-commercial-battle-screen-upgrade-plan.md` | 상용급 연출 목표 | 구 전투 화면 고도화 기준 |

### 6.3. 삭제하면 안 되는 새 기준 문서

아래 문서는 v2 기준 문서이므로 유지한다.

- `game_docs/CHIKAPO_ARENA_GDD.md`
- `game_docs/CHIKAPO_ARENA_CARD_DATA_DICTIONARY.md`
- `game_docs/CHIKAPO_ARENA_UX_WIREFRAMES.md`
- `game_docs/CHIKAPO_ARENA_API_DB_SPEC.md`
- `game_docs/CHIKAPO_ARENA_MIGRATION_PLAN.md`

---

## 7. 삭제 전 확인 체크리스트

이전 문서를 실제 삭제하기 전에 다음을 확인한다.

1. 새 GDD와 하위 명세가 최신 의사결정을 모두 포함한다.
2. 구현자가 구 numbered 문서 링크를 더 이상 참조하지 않는다.
3. README, 이슈, PR 템플릿, 내부 링크에서 구 문서 링크가 제거됐다.
4. 구 문서 중 운영 문구로 재사용할 문장이 새 문서에 반영됐다.
5. 삭제 커밋 메시지에 “구 5판 3선승 아레나 문서 제거”라고 명확히 남긴다.

---

## 8. v2 전환 완료 판정

다음이 모두 만족되면 기존 아레나에서 새 아레나로 전환이 완료된 것으로 본다.

1. 신규 유저가 v2 화면만 볼 수 있다.
2. 신규 매치가 `arena_v2_matches`에만 생성된다.
3. 신규 덱이 `arena_v2_decks`에만 저장된다.
4. 빠른대전 MMR이 `arena_v2_ratings`에만 반영된다.
5. 시즌 보상이 `arena_v2_reward_grants` 기준으로만 지급된다.
6. 상세 리플레이가 `arena_v2_replay_events`에 저장되고 7일 후 삭제된다.
7. 구 `arena_` 테이블은 백업 후 삭제됐거나 읽기 전용 legacy DB로 분리됐다.
8. 구 numbered 문서는 삭제됐거나 명확히 archive 처리됐다.
9. `best_of_five`, `round_plans`, `ARENA_TACTIC_CHIPS` 같은 구 개념이 런타임 코드에서 제거됐다.
10. 운영자가 관리자 탭에서 시즌 생성, 오픈, 잠금, 정산, 종료를 수행할 수 있다.
11. 빠른대전/8인전 큐가 `arena_v2_match_queue`, `arena_v2_battle_royale_queue` 기준으로 동작한다.
12. 신고, 권리 요청, 리플레이 증거 보존이 새 v2 테이블에 기록된다.
