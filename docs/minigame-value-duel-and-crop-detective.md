# 신규 미니게임 기획서: 시세 듀얼 / 카드 확대 탐정

## 배경

현재 미니게임은 `quiz`, `puzzle`, `match` 3종이다.

- `quiz`: 블러/모자이크 처리된 카드 이미지를 보고 스트리머를 맞히는 4지선다
- `puzzle`: 카드 이미지를 3x4 회전 퍼즐로 복구
- `match`: 스트리머 프로필 카드 12장을 기억해 짝을 맞히기

새 미니게임은 기존 게임과 감각이 겹치지 않으면서, 등록 스트리머가 약 1,800명 이상인 환경에서도 특정 스트리머를 외우는 능력이 필수가 되면 안 된다. 또한 현재 미니게임 시스템처럼 티켓, 일일 게임, 연습 모드, 서버 세션 검증, 시간 제한을 유지해야 한다.

## 공통 설계 원칙

- 유저가 모든 등록 스트리머를 알 필요가 없어야 한다.
- 서버가 정답을 검증할 수 있어야 한다.
- 클라이언트에 정답 데이터나 채점 기준값을 불필요하게 노출하지 않는다.
- 기존 보상 체계를 따른다.
  - 성공 기본 보상: `1000 P`
  - 완벽 성공 보너스: `+200 P`
  - 연습 모드: 티켓 미소모, 포인트 미지급
- 기존 미니게임 구조에 맞춘다.
  - `ArcadeTab.tsx`에 UI 추가
  - `minigameController.ts`에 출제/채점 추가
  - `MinigameSession.game_type` 확장
  - `target_data`에 서버 검증용 정답 저장

## 1. 시세 듀얼

### 한 줄 설명

두 스트리머 카드 중 현재 카드 시세가 더 높은 쪽을 10초 안에 고르는 5문제 비교 게임.

### 목표

시세와 카드 수집 서비스의 정체성을 활용한다. 스트리머를 몰라도 카드 이미지와 이름을 보고 둘 중 하나를 선택하면 되며, 정답은 현재 서비스가 수집/계산하는 `base_value`로 판정한다.

### 사용 데이터

- `channel_id`
- `name`
- 카드 표시 이미지
  - 우선순위: `custom_images[star]` -> `custom_image_url` -> `logo_url`
- `base_value`

### 게임 룰

- 1게임은 총 5문제다.
- 각 문제는 좌/우 스트리머 카드 2장을 보여준다.
- 유저는 10초 안에 현재 카드 시세가 더 높은 쪽을 선택한다.
- 3문제 이상 정답이면 성공이다.
- 5문제 모두 정답이면 `+200 P` 보너스를 지급한다.
- 두 카드의 `base_value`가 같으면 어느 쪽을 골라도 정답이다.
- 제한시간이 지난 문제는 오답 처리한다.

### 보상

- 0~2문제 정답: 실패, `0 P`
- 3~4문제 정답: 성공, `1000 P`
- 5문제 정답: 완벽 성공, `1200 P`

### 출제 방식

서버가 게임 시작 시 5개 라운드를 생성한다.

각 라운드의 서버 저장 데이터:

```json
{
  "round": 0,
  "left": {
    "channel_id": "left-channel",
    "name": "왼쪽 스트리머",
    "image_url": "/uploads/left.webp",
    "star": 2,
    "base_value": 12000
  },
  "right": {
    "channel_id": "right-channel",
    "name": "오른쪽 스트리머",
    "image_url": "/uploads/right.webp",
    "star": 1,
    "base_value": 8500
  }
}
```

클라이언트 전달 데이터:

```json
{
  "rounds": [
    {
      "round": 0,
      "left": {
        "channel_id": "left-channel",
        "name": "왼쪽 스트리머",
        "image_url": "/uploads/left.webp",
        "star": 2
      },
      "right": {
        "channel_id": "right-channel",
        "name": "오른쪽 스트리머",
        "image_url": "/uploads/right.webp",
        "star": 1
      }
    }
  ]
}
```

`base_value`는 클라이언트에 내려주지 않는다.

### 난이도

초기 버전은 과도한 난이도 조절 없이 무작위 출제로 시작한다. 단, 둘 다 이미지가 없는 스트리머는 제외하거나 `logo_url` fallback이 있는 경우만 사용한다.

추후 개선안:

- 1~2문제: 가치 차이가 큰 카드
- 3~4문제: 중간 차이
- 5문제: 근소 차이

### 제출 Payload

```json
{
  "answers": [
    { "round": 0, "selected_channel_id": "left-channel" },
    { "round": 1, "selected_channel_id": "right-channel" }
  ],
  "client_remaining_ms": 12000
}
```

### 서버 채점

라운드별로 다음 기준을 적용한다.

- `left.base_value > right.base_value`: 왼쪽만 정답
- `left.base_value < right.base_value`: 오른쪽만 정답
- `left.base_value === right.base_value`: 양쪽 모두 정답

전체 5문제 중 3문제 이상이면 성공 처리한다.

### 시간 제한

- 문제당 10초
- 총 플레이 제한: `5 * 10초 = 50초`
- 기존 카운트다운 3초와 서버 제출 유예를 포함해 서버 허용 시간을 계산한다.

권장 상수:

```ts
const VALUE_DUEL_ROUND_COUNT = 5;
const VALUE_DUEL_ROUND_TIME_MS = 10_000;
const VALUE_DUEL_TIME_LIMIT_MS = VALUE_DUEL_ROUND_COUNT * VALUE_DUEL_ROUND_TIME_MS;
const VALUE_DUEL_MIN_CORRECT = 3;
```

### UI

- 상단: 현재 문제 번호 `1/5`, 남은 시간, 정답 수
- 중앙: 좌/우 카드 2장
- 각 카드: 이미지, 스트리머 이름
- 선택 후: 문제에 대한 결과 확인 후, 확인 버튼을 눌러 다음 문제로 이동한다.
- 마지막 문제 후 최종 결과 확인

### 치팅/검증 고려

- `base_value`는 서버 `target_data`에만 저장한다.
- 클라이언트는 선택한 `channel_id`만 제출한다.
- 이미 공개 API나 화면에서 시세를 볼 수 있으므로 완전한 정보 은닉은 불가능하다.
- 대신 문제당 10초 제한으로 외부 조회 실익을 줄인다.
- 제출 라운드 수, 라운드 번호 중복, 보기 외 `channel_id`를 서버에서 거부한다.

### 엣지 케이스

- 출제 가능한 스트리머가 2명 미만이면 시작 불가
- 이미지가 없는 스트리머는 `logo_url` fallback을 사용한다.
- `base_value`가 숫자가 아니면 후보에서 제외한다.
- 동일 스트리머가 같은 게임 내 여러 라운드에 재등장하는 것은 허용 가능하지만, 첫 버전에서는 중복을 줄이는 편이 좋다.

## 2. 카드 확대 탐정

### 한 줄 설명

확대된 카드 이미지 조각을 보고, 화면에 함께 제공되는 후보 카드 중 어느 카드에서 잘린 조각인지 고르는 시각 비교 게임.

### 목표

스트리머 이름이나 얼굴을 외우는 능력이 아니라, 현재 화면에 제시된 이미지들을 비교하는 관찰력 게임을 만든다. 기존 `quiz`처럼 정답 스트리머를 알아야 하는 게임이 아니며, 기존 `puzzle`처럼 조각을 복구하는 게임도 아니다.

### 사용 데이터

- `channel_id`
- `name`
- 카드 표시 이미지
  - 우선순위: `custom_images[star]` -> `custom_image_url` -> `logo_url`

### 게임 룰

- 1게임은 총 5문제다.
- 각 문제마다 서버가 정답 카드 1장과 오답 후보 3장을 선정한다.
- 클라이언트는 정답 이미지의 일부 영역을 크게 확대해 보여준다.
- 아래에는 후보 카드 4장을 모두 보여준다.
- 유저는 확대 조각이 어느 후보 카드에서 나온 것인지 10초 안에 고른다.
- 3문제 이상 정답이면 성공이다.
- 5문제 모두 정답이면 `+200 P` 보너스를 지급한다.

### 보상

- 0~2문제 정답: 실패, `0 P`
- 3~4문제 정답: 성공, `1000 P`
- 5문제 정답: 완벽 성공, `1200 P`

### 출제 방식

서버가 게임 시작 시 5개 라운드를 생성한다.

각 라운드의 서버 저장 데이터:

```json
{
  "round": 0,
  "answer_channel_id": "answer-channel",
  "crop": {
    "x": 0.34,
    "y": 0.18,
    "size": 0.28
  },
  "choices": [
    {
      "channel_id": "answer-channel",
      "name": "정답 스트리머",
      "image_url": "/uploads/answer.webp",
      "star": 2
    },
    {
      "channel_id": "wrong-channel-1",
      "name": "오답 1",
      "image_url": "/uploads/wrong-1.webp",
      "star": 0
    }
  ]
}
```

클라이언트 전달 데이터:

```json
{
  "rounds": [
    {
      "round": 0,
      "crop": {
        "x": 0.34,
        "y": 0.18,
        "size": 0.28
      },
      "source_image_url": "/uploads/answer.webp",
      "choices": [
        {
          "channel_id": "answer-channel",
          "name": "정답 스트리머",
          "image_url": "/uploads/answer.webp",
          "star": 2
        }
      ]
    }
  ]
}
```

정답 이미지를 확대 조각으로 보여줘야 하므로 `source_image_url`은 클라이언트에 전달된다. 다만 후보 이미지도 함께 보이기 때문에 이 게임은 원래부터 시각 비교가 목적이다.

### Crop 규칙

이미지별 실제 크기 차이를 서버에서 분석하지 않고도 구현할 수 있도록 crop 좌표는 정규화 값으로 저장한다.

- `x`: 0~1 사이의 crop 중심 X
- `y`: 0~1 사이의 crop 중심 Y
- `size`: 0~1 사이의 정사각형 crop 크기

권장 초기값:

- `size`: `0.25 ~ 0.35`
- `x`: `size / 2`부터 `1 - size / 2`
- `y`: `size / 2`부터 `1 - size / 2`

프론트는 CSS `object-position` 또는 canvas를 사용해 해당 영역을 확대 표시한다. 기존 `ArcadeTab.tsx`에 이미 canvas 기반 이미지 처리 코드가 있으므로 canvas 방식이 가장 안정적이다.

### 난이도

기본 난이도:

- 후보 4장
- 라운드당 10초
- crop 크기 10~20% 전후

추후 개선:

- 초반 라운드는 crop 크기 크게
- 후반 라운드는 crop 크기 작게
- 이미지가 너무 단색이거나 배경이 비슷해 판별이 어려우면 다시 뽑기

초기 버전에서는 이미지 픽셀 분석 없이 무작위 crop으로 충분하다. 단, 지나치게 모서리/단색 영역만 나오지 않도록 중심 좌표 범위를 너무 바깥으로 잡지 않는다.

### 제출 Payload

```json
{
  "answers": [
    { "round": 0, "selected_channel_id": "answer-channel" },
    { "round": 1, "selected_channel_id": "wrong-channel" }
  ],
  "client_remaining_ms": 15000
}
```

### 서버 채점

라운드별 `answer_channel_id`와 제출된 `selected_channel_id`가 일치하면 정답 처리한다.

전체 5문제 중 3문제 이상이면 성공 처리한다.

### 시간 제한

- 문제당 10초
- 총 플레이 제한: `5 * 10초 = 50초`
- 기존 카운트다운 3초과 서버 제출 유예를 포함해 서버 허용 시간을 계산한다.

권장 상수:

```ts
const CROP_DETECTIVE_ROUND_COUNT = 5;
const CROP_DETECTIVE_ROUND_TIME_MS = 10_000;
const CROP_DETECTIVE_TIME_LIMIT_MS = CROP_DETECTIVE_ROUND_COUNT * CROP_DETECTIVE_ROUND_TIME_MS;
const CROP_DETECTIVE_MIN_CORRECT = 3;
const CROP_DETECTIVE_CHOICES = 4;
```

### UI

- 상단: 현재 문제 번호 `1/5`, 남은 시간, 정답 수
- 중앙: 확대된 이미지 조각
- 하단: 후보 카드 4장, 스트리머 이름
- 후보 카드는 이미지가 핵심이고 이름은 보조 정보로 살짝 작게 표시한다.
- 선택 즉시 결과를 알려주고, 확인 버튼을 눌러 다음 문제로 이동한다.
- 마지막 문제 후 최종 결과 확인

### 치팅/검증 고려

- 이 게임은 정답 이미지를 crop source로 클라이언트에 전달하므로, 네트워크 payload를 보면 정답을 유추할 수 있다.
- 다만 게임 목적이 화면에 보이는 이미지를 비교하는 것이고, 제한시간이 짧기 때문에 보상 규모상 허용 가능한 수준이다.
- 서버는 다음을 검증한다.
  - 라운드 수가 5개인지
  - 라운드 번호가 중복되지 않는지
  - 선택한 `channel_id`가 해당 라운드 후보 중 하나인지
  - 서버 시간 제한을 넘지 않았는지

### 엣지 케이스

- 출제 가능한 스트리머가 4명 미만이면 시작 불가
- 후보 4장의 이미지 URL이 모두 유효해야 한다.
- 같은 라운드 안에서는 후보 `channel_id`가 중복되면 안 된다.
- 한 게임 안에서 같은 정답 스트리머가 반복되는 것은 피한다.
- 이미지 로딩 실패 시 해당 라운드를 정상 진행하기 어려우므로 프론트에서 fallback 이미지를 보여주되, 첫 구현에서는 서버 후보 선정에서 빈 이미지 URL을 제외한다.

## 두 게임의 구현 우선순위

1. `GameType` 확장
   - 예: `'value_duel' | 'crop_detective'`
2. 백엔드 타입 확장
   - `DAILY_MINIGAMES`
   - `MinigameSession.game_type`
   - repository 타입의 game type union
3. `startMinigame` 출제 로직 추가
4. `buildRecoverableGameData` 복구 데이터 추가
5. `submitMinigameResult` 채점 로직 추가
6. 프론트 `ArcadeTab.tsx` UI와 상태 추가
7. 연습 모드 쿼리 파라미터 지원
8. 테스트 추가
   - 시작 성공
   - 시간 초과
   - 3/5 성공
   - 5/5 보너스
   - 잘못된 payload 거부
   - 연습 모드 포인트 미지급

## 추천 개발 순서

먼저 `시세 듀얼`을 구현한다. 이유는 canvas/crop UI 없이 좌우 선택 UI만 있으면 되어 백엔드 game type 확장 리스크를 먼저 검증하기 좋다.

그 다음 `카드 확대 탐정`을 구현한다. 이때 시세 듀얼에서 만든 5라운드 진행 상태, 제출 payload, 성공 기준 로직을 재사용하면 프론트 구현량을 줄일 수 있다.

