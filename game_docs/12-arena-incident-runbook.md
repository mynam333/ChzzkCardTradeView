# 치카포 아레나 장애 대응 Runbook

## 1. 목적

이 문서는 치카포 아레나 운영 중 장애가 발생했을 때의 판단 기준, 대응 순서, 공지 기준, 복구 절차를 정의한다.

운영 전제:

- 백엔드와 MySQL이 같은 서버에서 동작한다.
- 서버 자원은 제한적이다.
- 아레나는 5판 3선승 세트 매치를 서버에서 짧게 시뮬레이션한다.
- 실시간 상주 매치룸은 사용하지 않는다.
- 전투 로그와 랭킹은 보존/스냅샷 정책을 가진다.

## 2. 장애 등급

### SEV-1

서비스 핵심 기능이 중단된 상태.

예:

- 로그인 유저 대부분이 아레나 접근 불가
- 빠른대전 전체 불가
- MySQL 장애
- MMR/랭킹 데이터가 잘못 반영됨
- 전투 결과가 중복 반영됨
- 서버 CPU/메모리 급등으로 본편까지 영향

목표:

```text
첫 대응: 10분 이내
공지: 15분 이내
완화: 30분 이내
사후 보고: 24시간 이내
```

### SEV-2

주요 기능 일부 장애.

예:

- 봇전 불가
- 리플레이 조회 불가
- 랭킹 갱신 지연
- 특정 카드/스킬로 전투 실패
- 일부 덱 저장 실패
- 스트리머 설정 페이지 장애

목표:

```text
첫 대응: 30분 이내
공지: 필요 시 1시간 이내
완화: 2시간 이내
```

### SEV-3

부분적인 불편 또는 표시 오류.

예:

- UI 텍스트 오류
- 일부 통계 지연
- 리플레이 연출 깨짐
- 관리자 리포트 오류

목표:

```text
다음 정기 패치 또는 핫픽스
```

## 3. 즉시 중단 스위치

아레나는 본편에 영향을 주면 안 된다. 문제가 심하면 기능별 kill switch를 제공해야 한다.

권장 system config:

```text
arena_enabled
arena_ranked_enabled
arena_bot_practice_enabled
arena_matchmaking_enabled
arena_replay_enabled
arena_rating_update_enabled
arena_reward_claim_enabled
arena_streamer_config_enabled
```

우선순위:

1. `arena_matchmaking_enabled=false`
2. `arena_bot_practice_enabled=false`
3. `arena_rating_update_enabled=false`
4. `arena_enabled=false`

MMR 문제가 의심되면 빠른대전보다 rating update를 먼저 멈추는 것이 안전하다.

## 4. 공통 대응 절차

1. 증상 확인
2. 영향 범위 확인
3. SEV 등급 지정
4. 필요 시 kill switch 적용
5. 공지 작성
6. 로그와 DB 상태 확인
7. 원인 격리
8. 임시 복구 또는 rollback
9. 데이터 정합성 검증
10. 재오픈
11. 사후 보고 작성

## 5. MySQL 부하 급증

증상:

- API 응답 지연
- DB connection pool 고갈
- slow query 증가
- 본편 기능까지 지연

즉시 조치:

1. 빠른대전 큐 중지
2. 봇전 중지
3. 랭킹 snapshot batch 중지
4. 리플레이 로그 정리 batch 중지
5. 관리자 통계 조회 제한

확인:

- slow query
- arena_match_queue row 수
- arena_battle_logs 크기
- 최근 bot-practice 요청량
- rank snapshot 생성 중인지

복구:

- 만료 큐 소량 정리
- 오래된 battle log limit delete
- 필요 시 ranking snapshot 주기 늘림
- rate limit 강화

## 6. 전투 시뮬레이션 장애

증상:

- 봇전/빠른대전 실패
- 특정 덱에서 500 발생
- CPU spike
- 로그 크기 제한 초과

즉시 조치:

1. 봇전 중지
2. 빠른대전 중지
3. 문제 match id 확보
4. 덱 스냅샷과 card version 확보
5. 문제 스킬/태그 식별
6. 문제 스킬 임시 비활성화 또는 카드 풀 제외

확인:

- MAX_TICKS 초과 여부
- MAX_EVENTS 초과 여부
- passive trigger loop 여부
- summon count 초과 여부
- 상태이상 무한 갱신 여부

복구:

- 문제 스킬/패시브 수치 하향
- 금지 조합 추가
- generation batch 재검증
- smoke simulation 실행

## 7. MMR/랭킹 정합성 장애

증상:

- 승리했는데 점수 감소
- 같은 match가 두 번 반영
- 봇전이 랭킹에 반영
- 랭킹 순위 이상

즉시 조치:

1. `arena_rating_update_enabled=false`
2. 빠른대전 큐 중지 여부 판단
3. 문제 match 범위 확인
4. arena_matches와 arena_player_ratings 비교
5. 중복 반영 여부 확인

복구:

- match id 기반 rating 재계산
- 잘못된 snapshot 삭제 후 재생성
- 보상 지급 보류
- 사후 공지

주의:

- 수동 DB 수정은 최소화한다.
- 수정 전 affected user 목록을 저장한다.

## 8. 매칭 큐 장애

증상:

- 큐가 끝나지 않음
- 매칭 완료 후 match가 없음
- 같은 유저가 여러 큐에 존재
- 같은 상대 반복 매칭 과다

즉시 조치:

1. matchmaking 중지
2. WAITING 큐 수 확인
3. 만료 큐 정리
4. 중복 user queue 확인

복구:

- WAITING 중 expires_at 지난 row EXPIRED 처리
- MATCHED인데 match id 없는 row 점검
- quick join idempotency 확인
- same opponent cooldown 적용 확인

## 9. 리플레이 장애

증상:

- 결과는 있는데 리플레이 없음
- 리플레이 JSON 파싱 실패
- 리플레이가 너무 큼
- 조회가 느림

즉시 조치:

1. replay 조회 기능만 일시 중지 가능
2. match summary는 계속 제공
3. 문제 log size/event count 확인

복구:

- 만료 로그 정리
- 큰 로그 압축 또는 삭제
- replay parser 수정
- log schema version 처리

## 10. 스트리머 opt-out 장애

증상:

- opt-out했는데 카드가 계속 등장
- 본인 아닌 유저가 설정 변경
- admin disabled 카드가 사용됨

즉시 조치:

1. streamer config 기능 중지
2. 문제 channel_id 아레나 강제 비활성화
3. 카드 사용 가능 상태 cache 무효화
4. 덱 validation 재실행

복구:

- 권한 검증 수정
- arena_cards status 확인
- card pool 재생성
- 영향을 받은 match 조사

## 11. 보상 장애

증상:

- 보상 중복 지급
- 부적격 유저 보상 지급
- 보상 수령 실패

즉시 조치:

1. reward claim 중지
2. reward claim log 확인
3. 중복 지급 범위 산정
4. 필요 시 회수 정책 결정

복구:

- idempotency key 적용
- claim unique 제약 확인
- 어뷰징 검증 재실행

## 12. 공지 기준

공지 필요:

- 빠른대전 중단
- MMR/랭킹 영향
- 보상 지급 영향
- 스트리머 권리 관련 장애
- 본편 서비스 영향

공지 생략 가능:

- 5분 이내 복구된 리플레이 지연
- 일부 관리자 통계 오류
- 베타 내부 테스트 장애

## 13. 사후 보고 템플릿

```text
제목:
장애 등급:
발생 시각:
탐지 시각:
복구 시각:
영향 범위:
사용자 영향:
원인:
즉시 조치:
영구 조치:
데이터 보정 여부:
재발 방지:
담당자:
```

## 14. 반드시 지켜야 할 결정 사항

1. 본편 서비스에 영향이 생기면 아레나 기능을 먼저 중지한다.
2. MMR 정합성이 의심되면 rating update를 즉시 중지한다.
3. 전투 시뮬레이션 장애는 봇전과 빠른대전을 모두 멈춰 원인을 격리한다.
4. opt-out 관련 장애는 스트리머 권리 문제로 우선순위를 높게 잡는다.
5. 모든 SEV-1은 사후 보고를 남긴다.

