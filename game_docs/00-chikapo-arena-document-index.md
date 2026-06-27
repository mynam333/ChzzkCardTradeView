# 치카포 아레나 기획 문서 인덱스

## 1. 목적

이 문서는 치카포 아레나 기획 문서 묶음의 읽는 순서, 문서별 책임, 구현 전 확인해야 할 핵심 결정을 정리한다.

치카포 아레나는 기존 치카포의 이미지와 코스메틱 리소스를 활용하는 독립형 자매 서비스다. 전투력은 치카포 본편의 경제, 방송, 후원, 카드 보유량과 분리한다.

## 2. 최종 핵심 결정

아래 결정은 모든 문서의 상위 원칙이다.

- 게임 형태: 스트리머 카드 기반 5판 3선승 자동 전투 아레나
- 기본 PvP: 빠른대전
- 연습 모드: AI 봇전
- 매치 길이: 리플레이 체감 7~12분
- 서버 처리: 매칭 시 덱/시드를 고정하고 각 라운드 종료 시점에 해당 라운드만 확정
- 실시간 상주 매치룸: MVP에서는 사용하지 않음
- 밴픽: 사용하지 않음
- 시즌 로테이션 카드 풀: 사용하지 않음
- 8인 컵: 별도 모드, 랭크 MMR과 분리
- 관전: 완료 리플레이/하이라이트 기반
- 관리자 통계: 스냅샷/배치 기반
- 카드 수: 등록 스트리머 약 3천 명을 카드 풀로 활용
- 미설정 카드: `channel_id` 기반 고정 랜덤 템플릿
- 동일 스트리머 카드: 모든 사용자에게 같은 능력
- 스트리머 권리: 카드 비활성화 가능
- 랭킹: 아레나 전용 MMR과 시즌 랭킹
- P2W 차단: 시세, 후원, 방송 상태, 포인트, 카드 보유량은 전투력에 사용하지 않음
- 서버 보호: 6GB RAM + 4GB swap 환경에서 백엔드와 MySQL을 함께 운영 가능한 구조 우선

## 3. 문서 목록

| 번호 | 문서 | 역할 |
| --- | --- | --- |
| 00 | `00-chikapo-arena-document-index.md` | 전체 문서 인덱스와 최종 결정 요약 |
| 01 | `01-chikapo-arena-plan.md` | 전체 게임 기획, 서비스 정체성, 범위 |
| 02 | `02-chikapo-arena-matchmaking-and-ops-plan.md` | 빠른대전, 봇전, MMR, 랭킹, 운영 부하 |
| 03 | `03-arena-battle-system.md` | 5판 3선승 전투 규칙, 시뮬레이션, 리플레이 |
| 04 | `04-arena-card-generation-system.md` | 카드 능력 생성, 스트리머 설정, 비활성화 |
| 05 | `05-arena-classes-skills-tags.md` | 클래스, 스킬, 패시브, 태그 데이터 사전 |
| 06 | `06-arena-balance-policy.md` | 밸런스 검증, 시뮬레이션, 패치 기준 |
| 07 | `07-arena-ux-flow.md` | 사용자 화면, 덱 편성, 매치, 리플레이 UX |
| 08 | `08-arena-backend-db-plan.md` | DB 구조, API 처리 방향, 캐시, 부하 제한 |
| 09 | `09-arena-rewards-and-monetization-policy.md` | 보상, 시즌, 과금 원칙, P2W 방지 |
| 10 | `10-arena-security-and-abuse-policy.md` | 어뷰징, 보안, 조작 방지, 관리자 감사 |
| 11 | `11-arena-roadmap-and-launch-checklist.md` | 개발 로드맵, 출시 체크리스트 |
| 12 | `12-arena-incident-runbook.md` | 장애 등급, kill switch, 복구 절차 |
| 13 | `13-arena-communication-templates.md` | 공지, 패치노트, 장애, 보상 안내 템플릿 |
| 14 | `14-arena-privacy-and-replay-policy.md` | 개인정보, 리플레이, 보관 기간, 접근 권한 |
| 15 | `15-arena-api-spec.md` | MVP API 명세, 요청/응답, rate limit |
| 16 | `16-arena-risk-register-and-acceptance-criteria.md` | 리스크 등록부, Go/No-Go, 검수 기준 |
| 17 | `17-arena-legal-rights-and-terms-policy.md` | 이미지/초상/약관/권리 요청 처리 기준 |
| 18 | `18-arena-load-test-and-capacity-plan.md` | 부하 테스트, 저장량, 서버 중단 기준 |
| 19 | `19-arena-api-final-contract.md` | 최종 API 경로, rate limit, 성능 계약 |
| 20 | `20-arena-content-moderation-policy.md` | 카드 이미지, 닉네임, 리플레이 신고/블라인드 정책 |
| 21 | `21-arena-low-load-optimization-plan.md` | 초저부하 기본값, 워커/큐/리플레이/랭킹 최적화 |
| 22 | `22-arena-site-design-system.md` | 치카포 계승 레이아웃, 아레나 색감, 컴포넌트/애니메이션 디자인 시스템 |
| 23 | `23-arena-expanded-strategy-cup-admin-plan.md` | 5판 3선승 전략 확장, 8인 컵, 관전, 관리자 통계 |
| 24 | `24-arena-service-readiness-qa.md` | 상용 출시 전 실데이터 QA, 스모크/부하 테스트, Go/No-Go 기준 |
| 25 | `25-arena-point-cosmetic-policy.md` | 아레나 내부 포인트 사용처, 코스메틱 구매/보유/장착, P2W 방지 기준 |
| 26 | `26-arena-balance-simulation-guide.md` | 클래스/스탯/스킬/태그/전술 조합 오프라인 밸런스 시뮬레이션 가이드 |
| 27 | `27-arena-commercial-battle-screen-upgrade-plan.md` | 상용 게임 수준의 실제 전투 화면 HUD, VFX, 결과 모달, 모바일/성능 고도화 기준 |

## 4. 권장 읽는 순서

### 기획 검토

1. `01-chikapo-arena-plan.md`
2. `02-chikapo-arena-matchmaking-and-ops-plan.md`
3. `03-arena-battle-system.md`
4. `04-arena-card-generation-system.md`
5. `05-arena-classes-skills-tags.md`
6. `06-arena-balance-policy.md`

### 구현 준비

1. `08-arena-backend-db-plan.md`
2. `15-arena-api-spec.md`
3. `07-arena-ux-flow.md`
4. `22-arena-site-design-system.md`
5. `10-arena-security-and-abuse-policy.md`
5. `14-arena-privacy-and-replay-policy.md`

### 출시 준비

1. `11-arena-roadmap-and-launch-checklist.md`
2. `16-arena-risk-register-and-acceptance-criteria.md`
3. `12-arena-incident-runbook.md`
4. `13-arena-communication-templates.md`
5. `09-arena-rewards-and-monetization-policy.md`
6. `17-arena-legal-rights-and-terms-policy.md`
7. `18-arena-load-test-and-capacity-plan.md`
8. `19-arena-api-final-contract.md`
9. `20-arena-content-moderation-policy.md`
10. `21-arena-low-load-optimization-plan.md`
11. `24-arena-service-readiness-qa.md`
12. `25-arena-point-cosmetic-policy.md`
13. `26-arena-balance-simulation-guide.md`
14. `27-arena-commercial-battle-screen-upgrade-plan.md`

## 5. 구현 전 반드시 잠글 항목

구현 시작 전 확정해야 하는 항목:

- MVP 출전 카드 수
- 덱 슬롯 수
- 라운드별 전술 계획 옵션 수
- 클래스/스킬/태그 초기 활성화 범위
- 비활성화 카드 표시 방식
- 리플레이 상세 로그 보관 기간
- 랭킹 스냅샷 갱신 주기
- 빠른대전 큐 SSE 및 fallback 상태 조회 간격
- 세트 시뮬레이션 동시 실행 수
- 시즌 보상 지급 기준
- 스트리머 이미지/초상/약관 고지 문구
- 최종 API 경로와 rate limit
- 리플레이 상세 로그 저장 방식
- 빠른대전/봇전 시뮬레이션 워커 수
- MMR bucket 기반 큐 매칭 방식
- 콘텐츠 신고/블라인드 처리 기준
- 치카포와 동일하게 유지할 PC 사이드바/모바일 하단 도크 구조
- 아레나 전용 색상, 그라데이션, 애니메이션 토큰

변경하면 큰 비용이 드는 항목:

- 단판/5판 3선승 구조
- 밴픽 미도입 원칙
- 시즌 로테이션 카드 풀 미도입 원칙
- 서버 권위 전투 여부
- 동일 스트리머 카드의 동일 능력 원칙
- 미설정 카드 결정론적 생성 방식
- 아레나 MMR과 본편 랭킹 분리 여부
- 리플레이 공개 범위

## 6. 구현 시작 순서

권장 순서:

1. 카드 능력 생성기와 금지 데이터 차단
2. 카드/스킬/태그 정적 데이터 구조
3. 덱 저장과 검증
4. 5판 3선승 시뮬레이터
5. 매치 결과와 MMR 반영
6. 랭킹 스냅샷
7. 리플레이 이벤트 저장과 조회
8. 빠른대전 큐
9. 봇전
10. 스트리머 카드 설정/비활성화
11. 관리자 kill switch
12. 8인 컵 큐/브래킷/하이라이트
13. 관전 링크/공개 리플레이
14. 관리자 통계 스냅샷
12. UX 화면 연결
12-1. 아레나 디자인 시스템 적용
13. 밸런스 시뮬레이션 배치
14. 보상 dry-run
15. 권리/약관 고지와 비활성화 SLA 확정
16. 부하 테스트와 리플레이 저장량 검증
17. 콘텐츠 신고/블라인드 운영 기능

## 7. 개발 중 금지 체크

코드 리뷰에서 아래 항목이 발견되면 반드시 수정한다.

- 전투 계산에서 `base_value`, 시세, 포인트, 보유 수량을 참조
- 방송 중 여부로 전투 버프 부여
- 후원 또는 구매력으로 능력치 상승
- 클라이언트가 제출한 승패를 서버가 신뢰
- 매치마다 전체 랭킹 재정렬
- 리플레이 로그 무제한 저장
- 비활성화된 스트리머 카드가 신규 매치에 등장
- 봇전이 MMR 또는 시즌 보상에 반영
- 실시간 매치룸을 필수 구조로 구현
- 밴픽 기능 추가 금지
- 시즌 로테이션 카드 풀 기능 추가 금지
- 실시간 관전 tick stream 구현
- kill switch 없이 빠른대전 배포
- 최종 API 계약과 다른 초안 경로 신규 구현
- 스트리머 권리 고지 없이 공개 리플레이 제공
- MySQL JSON 컬럼에 상세 리플레이 원본을 장기 저장

## 8. 완료 판정

문서상 완성은 다음 상태를 의미한다.

- 게임 방향, 전투, 카드 생성, 밸런스, UX, 백엔드, API, 운영, 보상, 보안, 장애 대응, 리스크 기준이 모두 문서화되어 있다.
- 사용자의 핵심 요구사항인 비P2W, 스트리머 비활성화, 고정 랜덤 템플릿, 5판 3선승, AI 봇전, MMR/랭킹, 저부하 백엔드 원칙이 모든 관련 문서에 반영되어 있다.
- 구현자는 문서만 읽고 MVP 범위와 금지 범위를 구분할 수 있다.













