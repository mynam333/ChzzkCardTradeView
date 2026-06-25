# 치카포 아레나 부하 테스트 및 용량 산정 계획

## 1. 목적

이 문서는 6GB RAM + 4GB swap 서버에서 백엔드와 MySQL을 함께 운영하는 조건을 기준으로 치카포 아레나의 부하 테스트, 용량 산정, 중단 기준을 정의한다.

아레나는 본편에 부하를 주면 안 된다. 기능 완성보다 본편 안정성이 우선이다.

## 2. 부하 설계 원칙

- 실시간 상주 매치룸을 만들지 않는다.
- 세트 전체는 서버가 짧게 시뮬레이션한다.
- 매치 결과 저장 트랜잭션은 짧게 유지한다.
- 랭킹은 스냅샷을 조회한다.
- 카드 능력은 요청마다 생성하지 않는다.
- 리플레이 상세 로그는 압축 또는 외부 저장을 우선 고려하며, 봇전은 기본 저장하지 않는다.
- 봇전은 피크 시간에 가장 먼저 제한할 수 있다.

## 3. 측정 대상

API:

- 카드 목록 조회
- 덱 저장/검증
- 빠른대전 참가
- 매칭 상태 조회
- 봇전 생성
- 매치 결과 조회
- 리플레이 조회
- 랭킹 조회
- 스트리머 카드 비활성화

내부 작업:

- 세트 시뮬레이션
- MMR 반영
- 랭킹 스냅샷 생성
- 리플레이 로그 삭제
- 카드 사용 가능 상태 재검증
- 보상 dry-run

서버 지표:

- Node.js RSS 메모리
- Node.js event loop delay
- MySQL CPU
- MySQL memory
- MySQL connections
- slow query 수
- disk free
- swap 사용량
- p50/p95/p99 latency

## 4. MVP 목표값

| 항목 | 목표 |
| --- | ---: |
| quick join API p95 | 300ms 이하 |
| matchmaking status p95 | 150ms 이하 |
| deck save p95 | 300ms 이하 |
| ranking read p95 | 200ms 이하 |
| replay summary p95 | 300ms 이하 |
| set simulation CPU p95 | 300ms 이하 |
| bot practice p95 | 800ms 이하 |
| ranked simulation workers | 1~2 |
| bot simulation workers | 0~1 |
| match result duplicate apply | 0건 |
| MySQL slow query | 핵심 API 기준 0건 목표 |

## 5. 테스트 시나리오

### 5.1 기본 읽기 부하

목표:

- 카드 목록과 랭킹 조회가 캐시/스냅샷으로 처리되는지 확인한다.

시나리오:

- 카드 목록 60 rpm
- 랭킹 조회 60 rpm
- 본인 프로필 조회 60 rpm
- 10분 지속

합격:

- MySQL CPU 급등 없음
- 전체 정렬 쿼리 없음
- p95 목표 통과

### 5.2 빠른대전 부하

목표:

- 큐 등록, 매칭, 시뮬레이션, 결과 저장이 본편에 영향을 주지 않는지 확인한다.

시나리오:

- 동시 큐 참가자 20명
- 1분당 매치 생성 10세트
- 10분 지속
- 이후 30명, 50명으로 단계 증가

합격:

- 중복 매칭 0건
- MMR 중복 반영 0건
- 시뮬레이션 p95 목표 통과
- Node.js RSS 안정
- MySQL connection 고갈 없음

### 5.3 봇전 부하

목표:

- 봇전이 시뮬레이션 워커를 잠식하지 않는지 확인한다.

시나리오:

- 봇전 생성 10회/10분/user 제한 적용
- 피크 상황에서 봇전 kill switch 확인

합격:

- 봇전 제한 시 빠른대전 영향 없음
- 봇전 상세 로그 저장량 기준 초과 없음

### 5.4 리플레이 부하

목표:

- 상세 로그 응답 크기와 저장량이 통제되는지 확인한다.

시나리오:

- 최근 리플레이 조회
- 만료 리플레이 조회
- 리플레이 로그 삭제 배치 동시 실행

합격:

- 만료 리플레이는 summary fallback
- 응답 크기 상한 준수
- 삭제 배치가 본편 API에 영향 없음

## 6. 리플레이 저장량 산정

초기 상한:

```text
MAX_EVENTS_PER_MATCH = 2400
MAX_MATCH_LOG_BYTES = 320KB
RANKED_LOG_TTL_DAYS = MVP 7 이하, 안정화 후 7~14
BOT_LOG_TTL_DAYS = 기본 미저장, 필요 시 0~1
```

예상 산식:

```text
daily_ranked_matches * average_log_bytes * ttl_days
```

예:

```text
1,000 matches/day * 128KB * 14 days = 약 1.8GB
5,000 matches/day * 128KB * 14 days = 약 9GB
```

운영 기준:

- MySQL에 원본 JSON을 장기 저장하지 않는다.
- MVP는 일반 매치 리플레이를 `arena_match_replays`, 8인 컵 리플레이를 `arena_cup_replays`에 분리 저장하고, 이벤트 수와 바이트 상한 및 TTL 정리를 적용한다. 압축 파일 저장은 트래픽 증가 후 전환 후보로 둔다.
- DB에는 `log_size_bytes`, `event_count`, `expires_at`, `log_ref`를 반드시 둔다.
- 디스크 여유가 임계치 아래로 내려가면 상세 로그 TTL을 줄인다.

## 7. kill switch 기준

즉시 제한:

- MySQL CPU가 5분 이상 위험 수준
- swap 사용량 지속 증가
- quick join p95 1초 초과 지속
- set simulation p95 1초 초과 지속
- match result save 실패 증가
- battle log 저장 실패 급증

제한 순서:

1. 봇전 중단
2. 리플레이 상세 조회 중단
3. 빠른대전 신규 큐 중단
4. 랭킹 스냅샷 갱신 지연
5. 아레나 전체 점검

## 8. 정식 시즌 전 합격 기준

- 30분 이상 피크 시뮬레이션 통과
- MMR 중복 반영 0건
- 중복 매칭 0건
- ranking 조회 전체 정렬 쿼리 0건
- 리플레이 TTL 삭제 정상
- kill switch E2E 확인
- 본편 핵심 API p95 악화 없음

## 11. 확장 기능 부하 테스트

### 11.1 5판 3선승

목표:

- set simulation p95 500ms 이하
- set simulation p99 1200ms 이하
- MAX_MATCH_TICKS 900 이내
- 이벤트 로그 상한 초과 시 요약 로그 fallback 정상

### 11.2 8인 컵

시나리오:

- 컵 큐 8명 등록
- 컵 1개 생성
- 최대 12세트 시뮬레이션
- 컵 요약/하이라이트 조회

목표:

- 컵 생성 API p95 500ms 이하
- 컵 워커 단일 실행 중 본편 API p95 악화 없음
- 컵 상세 로그 저장량 목표 이내
- 컵 kill switch 즉시 반영

### 11.3 관전

시나리오:

- 공개 매치 리플레이 조회
- 공개 컵 하이라이트 조회
- 만료 링크 조회
- 권한 없는 링크 조회

목표:

- 관전 조회 p95 300ms 이하. 캐시 전제
- 관전자 진행 위치 DB write 0건
- 실시간 tick stream 없음

### 11.4 관리자 통계

시나리오:

- overview 조회
- balance stats 조회
- 통계 스냅샷 수동 재생성

목표:

- 관리자 통계 조회 p95 300ms 이하
- 조회 요청 중 대량 GROUP BY 없음
- 스냅샷 재생성은 rate limit과 관리자 권한 필요

금지:

- 밴픽 부하 테스트 항목 생성
- 시즌 로테이션 카드 풀 부하 테스트 항목 생성