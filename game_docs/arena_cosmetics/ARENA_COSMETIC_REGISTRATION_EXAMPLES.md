# 아레나 치장 수동 등록 예시

이 문서는 치카포 아레나 상점에 실제 상품을 등록할 때 사용하는 관리자 API 요청 예시다. 아래 상품은 자동으로 시드되지 않으며, 필요한 항목만 관리자 화면 또는 `POST /api/admin/shop/items`로 직접 등록한다.

## 등록 순서

1. 관리자 계정으로 로그인한다.
2. `/arena/admin`의 `치장` 탭에서 종류, 이름, 가격, 판매 상태와 `style_json`을 입력한다.
3. 이모트 이미지는 관리자 화면의 이미지 업로드를 먼저 사용한다. 업로드 응답의 `image_url`을 이모트 `style_json`에 넣는다.
4. 저장 후 `/arena/style`에서 상품 카드와 미리보기를 확인한다.
5. 테스트 계정으로 구매·장착한 뒤 이모트는 휠 저장, 다른 치장은 종류별 장착 상태를 확인한다.

관리자 API를 직접 호출할 때는 세션 쿠키와 CSRF 정책을 기존 관리자 요청과 동일하게 적용해야 한다.

## 지원 종류

| `type` | 상점 표시 | 장착 방식 |
|---|---|---|
| `emote` | 이모트 | 8분할 파이 메뉴의 선택 슬롯 |
| `card_frame` | 카드 프레임 | 종류별 단일 슬롯 |
| `name_flare` | 이름 연출 | 종류별 단일 슬롯 |
| `hit_vfx` | 타격 | 종류별 단일 슬롯 |
| `summon_vfx` | 소환 | 종류별 단일 슬롯 |
| `ready_stamp` | 준비 | 종류별 단일 슬롯 |
| `nameplate` | 네임플레이트 | 종류별 단일 슬롯 |
| `ko_text` | KO | 종류별 단일 슬롯 |

## 공통 `style_json` 스키마

`style_json`은 JSON 객체 자체가 아니라 JSON 문자열로 전송한다.

```json
{
  "schema_version": 1,
  "rarity": "common | rare | epic | legendary",
  "primary_color": "#f2556b",
  "secondary_color": "#17adc0",
  "accent_color": "#ffd166",
  "label": "미리보기에 표시할 짧은 문구",
  "motion": "none | pulse | sweep | burst | scan",
  "emoji": "✨",
  "image_url": "/uploads/arena-emotes/example.webp"
}
```

- `emoji`, `image_url`은 이모트에서 사용한다. 둘 다 있으면 이미지가 우선한다.
- `label`은 이름 연출, 준비 스탬프, 네임플레이트, KO 문구의 미리보기 문구로 사용한다.
- 세 색상 값은 `#RGB`, `#RRGGBB`, `rgb(...)`, `hsl(...)` 형식만 사용한다.
- `rarity`를 생략하면 `common`으로 처리한다.
- 임의 CSS는 보안과 호환성 검토가 끝난 경우에만 `css` 필드로 추가한다. 기본 등록은 색상·문구·모션 필드만 사용한다.

## 1. 이모트

```json
{
  "type": "emote",
  "name": "반가워!",
  "description": "매치에서 가볍게 인사를 건네는 이모트입니다.",
  "price": 300,
  "style_json": "{\"schema_version\":1,\"rarity\":\"common\",\"emoji\":\"👋\",\"primary_color\":\"#f2556b\",\"secondary_color\":\"#17adc0\",\"accent_color\":\"#ffd166\",\"motion\":\"pulse\"}",
  "font_url": null,
  "font_family": null,
  "active": true,
  "purchase_limit": 1,
  "sale_start_at": null,
  "sale_end_at": null,
  "limited_total_quantity": 0
}
```

이미지 이모트는 `style_json`을 다음처럼 교체한다.

```json
"style_json": "{\"schema_version\":1,\"rarity\":\"rare\",\"image_url\":\"/uploads/arena-emotes/arena_emote_example.webp\",\"emoji\":\"✨\",\"primary_color\":\"#f2556b\",\"secondary_color\":\"#17adc0\",\"accent_color\":\"#ffd166\"}"
```

## 2. 카드 프레임

```json
{
  "type": "card_frame",
  "name": "프리즘 코어",
  "description": "카드 외곽을 코랄과 시안 광택이 교차하는 프레임으로 꾸밉니다.",
  "price": 48000,
  "style_json": "{\"schema_version\":1,\"rarity\":\"legendary\",\"primary_color\":\"#67e8f9\",\"secondary_color\":\"#fb7185\",\"accent_color\":\"#facc15\",\"motion\":\"sweep\"}",
  "font_url": null,
  "font_family": null,
  "active": true,
  "purchase_limit": 1,
  "sale_start_at": null,
  "sale_end_at": null,
  "limited_total_quantity": 0
}
```

## 3. 이름 연출

```json
{
  "type": "name_flare",
  "name": "오로라 서명",
  "description": "이름에 시안과 코랄이 흐르는 잔잔한 광택을 적용합니다.",
  "price": 26000,
  "style_json": "{\"schema_version\":1,\"rarity\":\"epic\",\"primary_color\":\"#22d3ee\",\"secondary_color\":\"#f472b6\",\"accent_color\":\"#a7f3d0\",\"label\":\"CHIKAPO\",\"motion\":\"sweep\"}",
  "font_url": null,
  "font_family": null,
  "active": true,
  "purchase_limit": 1,
  "sale_start_at": null,
  "sale_end_at": null,
  "limited_total_quantity": 0
}
```

## 4. 타격 VFX

```json
{
  "type": "hit_vfx",
  "name": "스타브레이커",
  "description": "타격 순간 두 개의 교차 궤적과 충격 링을 표시합니다.",
  "price": 52000,
  "style_json": "{\"schema_version\":1,\"rarity\":\"legendary\",\"primary_color\":\"#f97316\",\"secondary_color\":\"#f43f5e\",\"accent_color\":\"#fde68a\",\"motion\":\"burst\"}",
  "font_url": null,
  "font_family": null,
  "active": true,
  "purchase_limit": 1,
  "sale_start_at": null,
  "sale_end_at": null,
  "limited_total_quantity": 0
}
```

## 5. 소환 VFX

```json
{
  "type": "summon_vfx",
  "name": "서킷 게이트",
  "description": "카드 배치 시 회로 링과 짧은 스캔 라인을 표시합니다.",
  "price": 34000,
  "style_json": "{\"schema_version\":1,\"rarity\":\"epic\",\"primary_color\":\"#38bdf8\",\"secondary_color\":\"#2dd4bf\",\"accent_color\":\"#e0f2fe\",\"motion\":\"scan\"}",
  "font_url": null,
  "font_family": null,
  "active": true,
  "purchase_limit": 1,
  "sale_start_at": null,
  "sale_end_at": null,
  "limited_total_quantity": 0
}
```

## 6. 준비 스탬프

```json
{
  "type": "ready_stamp",
  "name": "로열 락인",
  "description": "행동 제출 완료 시 짧은 READY 스탬프를 표시합니다.",
  "price": 18000,
  "style_json": "{\"schema_version\":1,\"rarity\":\"rare\",\"primary_color\":\"#fbbf24\",\"secondary_color\":\"#f97316\",\"accent_color\":\"#fff7ed\",\"label\":\"READY\",\"motion\":\"pulse\"}",
  "font_url": null,
  "font_family": null,
  "active": true,
  "purchase_limit": 1,
  "sale_start_at": null,
  "sale_end_at": null,
  "limited_total_quantity": 0
}
```

## 7. 네임플레이트

```json
{
  "type": "nameplate",
  "name": "옵시디언 크라운",
  "description": "플레이어 정보 영역에 절제된 시안 테두리와 금색 포인트를 적용합니다.",
  "price": 45000,
  "style_json": "{\"schema_version\":1,\"rarity\":\"legendary\",\"primary_color\":\"#0f172a\",\"secondary_color\":\"#38bdf8\",\"accent_color\":\"#facc15\",\"label\":\"PLAYER\",\"motion\":\"none\"}",
  "font_url": null,
  "font_family": null,
  "active": true,
  "purchase_limit": 1,
  "sale_start_at": null,
  "sale_end_at": null,
  "limited_total_quantity": 0
}
```

## 8. KO 문구

```json
{
  "type": "ko_text",
  "name": "크림슨 피니시",
  "description": "승부 결정 순간 FINISH 문구를 짧은 충격 연출과 함께 표시합니다.",
  "price": 30000,
  "style_json": "{\"schema_version\":1,\"rarity\":\"epic\",\"primary_color\":\"#fb7185\",\"secondary_color\":\"#ef4444\",\"accent_color\":\"#ffe4e6\",\"label\":\"FINISH\",\"motion\":\"burst\"}",
  "font_url": null,
  "font_family": null,
  "active": true,
  "purchase_limit": 1,
  "sale_start_at": null,
  "sale_end_at": null,
  "limited_total_quantity": 0
}
```

## 기간·수량 한정 판매

상시 판매 예시의 세 필드를 다음처럼 바꾸면 된다. 날짜는 ISO 8601 형식을 사용한다.

```json
{
  "sale_start_at": "2026-08-01T00:00:00+09:00",
  "sale_end_at": "2026-08-31T23:59:59+09:00",
  "limited_total_quantity": 500
}
```

`purchase_limit`은 계정별 최대 구매 수량이며 `0`은 무제한이다. 비소모성 치장은 기본적으로 `1`을 권장한다.

## 등록 후 확인 API

```text
GET /api/admin/shop/items
GET /api/arena/cosmetics/shop-items
GET /api/arena/cosmetics/inventory-counts
GET /api/arena/cosmetics/loadout
```

사용자 장착 저장 형식은 다음과 같다.

```json
{
  "emoteSlots": [101, 102, null, null, null, null, null, null],
  "equipped": {
    "card_frame": 201,
    "name_flare": 202,
    "hit_vfx": 203,
    "summon_vfx": 204,
    "ready_stamp": 205,
    "nameplate": 206,
    "ko_text": 207
  }
}
```

같은 이모트 ID를 여러 파이 슬롯에 중복 저장하거나, 보유하지 않은 상품 또는 종류가 다른 상품을 슬롯에 저장하면 API가 요청을 거절한다.
