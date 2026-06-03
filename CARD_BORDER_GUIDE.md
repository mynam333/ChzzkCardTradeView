# 🎴 카드 테두리(코스메틱) 제작 가이드

CCTV(치지직 카드 트레이드 뷰)의 **프리미엄 카드 테두리**를 CSS만으로 만드는 방법을 처음부터 끝까지 설명합니다.
프리셋을 쓰지 않고, **여기서 작성한 CSS를 관리자 페이지에 그대로 붙여넣으면 즉시 적용**됩니다.

> ## ⭐ 지향점 — "이미지 수준의 완성도"
> 이 테두리는 단순 장식이 아니라 **유료로 판매하는 카드 스킨**입니다.
> 실제 일러스트 카드 프레임처럼 **정교한 디테일, 풍부한 질감, 살아 있는 애니메이션, 완성도 높은 마감**을 목표로 하세요.
> - 코너 장식·이중 프레임·금속/유리 질감 등 **세밀한 라인 아트**
> - 빛 반사(셔머), 입자(꽃잎·눈·불씨), 회전 기어, 홀로그램 같은 **생동감 있는 모션**
> - 한 화면에 여러 장이 떠도 **튀지 않고 고급스러운** 색·밝기 균형
> "대충 테두리 색만" 수준이 아니라, **그 자체로 소장 가치가 있는 아트워크**를 만든다는 마음가짐으로 작업합니다.

---

## 1. 동작 원리 (필수 이해)

카드 위에는 **투명한 오버레이 한 장**(`<div class="cosmetic-frame cb-xxx">`)이 깔립니다.
- 이 오버레이는 카드 전체를 덮지만(가운데는 투명) **클릭을 가로채지 않습니다**(`pointer-events:none`).
- 카드 사진 위, 텍스트 아래(`z-index:30`)에 위치해 **테두리/이펙트는 보이고 글자는 가리지 않습니다**.
- 여러분이 작성한 CSS는 `<style>` 태그로 페이지에 **그대로 주입**되고, 그 안의 클래스(`.cb-xxx`)가 이 오버레이에 적용됩니다.

즉 여러분이 할 일은 **하나의 클래스(`.cb-xxx`)로 완성되는 자기완결형 CSS**를 작성하는 것뿐입니다.

### 오버레이가 기본 제공하는 것
앱이 오버레이에 `.cosmetic-frame` 기본 레이아웃(절대배치·전체크기·모서리 둥글기·overflow 숨김·z-index)을 미리 적용합니다.
하지만 **복사해서 다른 곳에서도 그대로 쓰거나, 안전하게 단독 동작**하도록, 작성하는 파일에도 레이아웃을 포함하는 것을 권장합니다(아래 템플릿 참고).

---

## 2. 데이터 모델

테두리 상품은 `shop_items` 한 줄이며, `style_json` 필드에 아래 형태로 저장됩니다.

```json
{ "class": "cb-mydragon", "css": "...여기에 CSS 전문..." }
```

- `class` — 오버레이에 부여할 클래스명. **다른 테두리와 겹치지 않는 고유 이름**(예: `cb-mydragon`).
- `css` — 그 클래스를 완성하는 **CSS 코드 전문**. `::before`/`::after`/`@keyframes`까지 자유롭게.

관리자 페이지(상점 관리 → 종류 "테두리")에서 **클래스명 + CSS 코드**를 입력하면 위 JSON이 자동 구성되어 저장됩니다.

> ⚠️ **고유 이름 규칙**: 클래스명과 `@keyframes` 이름은 테두리마다 고유해야 합니다.
> 여러 테두리가 동시에 주입될 때 이름이 겹치면 서로 덮어써 깨집니다.
> 예: `cb-mydragon`, `mydragon-shine`, `mydragon-fall` 처럼 **접두어**를 붙이세요.

---

## 3. 기본 템플릿 (복사해서 시작)

```css
/* 내 테두리 (클래스: cb-mytheme) */
.cb-mytheme {
  position: absolute;
  inset: 0;
  z-index: 30;
  border-radius: inherit;     /* 카드 모서리 둥글기 상속 */
  pointer-events: none;
  overflow: hidden;           /* 파티클/장식을 카드 안으로 클립 */

  /* 프레임(테두리 그림)을 카드 전체에 늘려 채움 */
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
  background-image: url("data:image/svg+xml,...");   /* ← 4장에서 설명 */

  /* 외곽 발광 + 안쪽 음영으로 입체감 */
  box-shadow: 0 0 14px rgba(255,210,120,.5), inset 0 0 12px rgba(120,60,0,.35);
}

/* 추가 레이어(빛/파티클 등)는 ::before, ::after 로 */
.cb-mytheme::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* ... */
}

/* 모션 최소화 사용자는 애니메이션 정지(정적 프레임은 유지) */
@media (prefers-reduced-motion: reduce) {
  .cb-mytheme, .cb-mytheme::before, .cb-mytheme::after { animation: none; }
}
```

한 클래스가 쓸 수 있는 그림 레이어는 **본체 배경 + `::before` + `::after` = 최대 3겹**입니다.
각 레이어의 `background-image`에는 **여러 개의 그라데이션/이미지를 콤마로 겹쳐** 넣을 수 있어, 실제로는 훨씬 풍부하게 표현됩니다.

---

## 4. 프레임 그리기 — SVG 데이터 URI (핵심)

고품질 테두리의 90%는 **SVG 라인 아트 프레임**에서 나옵니다.
SVG를 `background-image: url("data:image/svg+xml,...")` 로 인라인하면 외부 파일 없이 선명한 벡터 프레임을 얻습니다.

### 4.1 카드 비율에 맞춘 viewBox
카드 비율은 **5:8** 입니다. `viewBox='0 0 100 160'` 를 기준으로 그리고
`preserveAspectRatio='none'` 으로 카드 크기에 맞춰 늘립니다.

### 4.2 작성 → 인코딩 절차
1. 보기 좋게 일반 SVG로 먼저 그립니다:
   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160" preserveAspectRatio="none">
     <rect x="3" y="3" width="94" height="154" rx="8" fill="none" stroke="#e8c66a" stroke-width="2.6"/>
     <rect x="7.5" y="7.5" width="85" height="145" rx="5" fill="none" stroke="#b8451f" stroke-width="1.1"/>
     <!-- 코너 구름 장식 -->
     <path d="M3,24 C18,21 20,8 17,3" fill="none" stroke="#e8c66a" stroke-width="1.3"/>
   </svg>
   ```
2. data URI로 넣을 때 **다음만 치환**하면 대부분의 브라우저에서 동작합니다:
   - `<` → `%3C`  `>` → `%3E`  `#` → `%23`
   - 속성 따옴표는 `"` 대신 `'` (작은따옴표) 사용
   - path 좌표는 공백 대신 **쉼표**로 구분 권장 (`M3,24 C18,21 ...`)
3. 결과:
   ```css
   background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 160' preserveAspectRatio='none'%3E%3Crect x='3' y='3' width='94' height='154' rx='8' fill='none' stroke='%23e8c66a' stroke-width='2.6'/%3E%3C/svg%3E");
   ```

### 4.3 완성도를 높이는 디테일
- **이중/삼중 프레임**: 굵은 금속선 + 얇은 보조선 + 점선 패턴으로 깊이를 줍니다.
- **코너 장식**: 네 모서리에 구름·덩굴·기어·보석 등 모티프를 배치하면 "스킨" 느낌이 확 삽니다.
- **모서리 비대칭**: 한쪽 코너를 더 화려하게(예: 사이버펑크 L자 브래킷) 두면 시선이 살아납니다.
- **비대칭 광원**: `box-shadow` 의 외곽 발광 + `inset` 음영으로 **유리/금속 질감**을 연출합니다.

> 모서리가 둥근 곡선 장식은 `preserveAspectRatio='none'` 로 약간 늘어납니다.
> 너무 동그란 모티프보다 **사선·결정·기하학** 모티프가 늘어짐을 잘 견딥니다.

### 4.4 고급 SVG — 그라데이션 · 재사용 · 입체감 (완성도의 핵심)
플랫한 단색 선만 쓰면 "대충 그린 테두리"가 됩니다. 아래 기법으로 **금속/유리/보석 질감**을 만드세요.

- **`<defs>` + 그라데이션**: 프레임 선을 단색 대신 그라데이션으로 칠하면 입체감이 확 살아납니다.
  ```svg
  <defs>
    <linearGradient id='au' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0' stop-color='#fff1bd'/><stop offset='.5' stop-color='#e8c66a'/><stop offset='1' stop-color='#a8842a'/>
    </linearGradient>
    <radialGradient id='gem' cx='38%' cy='34%' r='70%'>
      <stop offset='0' stop-color='#ff9a9a'/><stop offset='1' stop-color='#c01726'/>
    </radialGradient>
  </defs>
  <rect ... stroke='url(#au)'/>      <!-- 금속 광택 프레임 -->
  <path ... fill='url(#gem)'/>       <!-- 면이 살아있는 보석 -->
  ```
  > data URI 안에서 `url(#au)` 의 `#` 도 `%23` 로 인코딩합니다 → `url(%23au)`.
- **`<g id='..'>` + `<use href='%23..'>`**: 단풍잎·꽃·눈결정·기어 같은 모티프를 한 번 정의하고
  코너마다 `transform='translate(..) rotate(..) scale(..)'` 로 재사용하면, 적은 코드로 **풍부한 디테일**을 얻습니다.
- **잎맥·면 분할 같은 미세 디테일**: 실루엣만 칠하지 말고 잎맥(가는 선), 보석 면 분할선, 금속 하이라이트 점을
  함께 그리면 **일러스트에 가까운 밀도**가 나옵니다.

---

## 5. 살아 있게 만들기 — 애니메이션 레시피

### 5.1 빛 반사(셔머) — 거의 모든 고급 테두리의 기본
화면 밖 → 화면 밖으로 **비스듬한 빛 띠**가 일정 주기로 카드를 쓸고 지나갑니다.
루프 양끝이 카드 밖이라 **끊김이 보이지 않습니다.**

```css
.cb-mytheme::after {
  content: "";
  position: absolute;
  top: 0; bottom: 0; left: -90%; width: 50%;   /* 카드 왼쪽 밖에서 시작 */
  pointer-events: none;
  background: linear-gradient(90deg, transparent 44%, rgba(255,255,255,.7) 50%, transparent 56%);
  mix-blend-mode: screen;                        /* 빛처럼 더해짐 */
  animation: mytheme-shine 5s cubic-bezier(.85,0,.15,1) infinite;
}
@keyframes mytheme-shine {
  0%   { transform: translateX(0)    skewX(-20deg); }
  100% { transform: translateX(500%) skewX(-20deg); }  /* 오른쪽 밖까지 */
}
```
- **3D 글린트**: 흰 코어 양옆에 시안/마젠타를 살짝 두면 유리 굴절(색수차) 느낌이 납니다.

### 5.2 떨어지는/피어오르는 입자 (꽃잎·눈·낙엽·불씨)
여러 점을 `radial-gradient` 로 찍고, 세로 타일을 무한 스크롤하면 **이음매 없이** 흐릅니다.

```css
.cb-mytheme::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background-repeat: repeat;
  background-size: 100% 220px;               /* 세로 타일 높이 */
  background-image:
    radial-gradient(6px 4px at 14px 18px,  rgba(255,170,205,.95), transparent 65%),
    radial-gradient(5px 3px at 72px 60px,  rgba(255,195,220,.85), transparent 65%),
    radial-gradient(7px 5px at 40px 120px, rgba(255,160,200,.9),  transparent 65%);
  animation: mytheme-fall 7.5s linear infinite,
             mytheme-sway 3.2s ease-in-out infinite alternate;
}
@keyframes mytheme-fall { from { background-position-y: 0; } to { background-position-y: 220px; } }
@keyframes mytheme-sway { from { transform: translateX(-6%); } to { transform: translateX(6%); } }
```
- 위로 피어오르게 하려면 `to { background-position-y: -220px; }` (불씨·기포).
- 타일 높이(`220px`)와 이동량을 **같게** 맞춰야 이음매가 없습니다.
- **입자도 SVG로**: 단순 점 대신 `<use>` 로 배치한 진짜 잎/꽃잎/눈결정 SVG를 타일에 넣으면 훨씬 사실적입니다.
- **2겹 패럴랙스**: `::after`(가깝고 크고 빠름) + `::before`(멀고 작고 느리고 흐림, `opacity:.5`)로 두 층을 겹치면
  깊이감이 생겨 "진짜 떨어지는" 느낌이 납니다. 두 층의 속도·크기·타일 높이를 다르게 두세요.

### 5.3 회전 (기어·룬)
```css
.cb-mytheme::before {
  content: ""; position: absolute; right: -8px; bottom: -8px; width: 34px; height: 34px;
  background: no-repeat center / contain url("data:image/svg+xml,...기어...");
  transform-origin: 50% 50%;
  animation: mytheme-spin 9s linear infinite;
}
@keyframes mytheme-spin { to { transform: rotate(360deg); } }
```

### 5.4 색상 순환 / 홀로그램
```css
.cb-mytheme::before { animation: mytheme-hue 8s linear infinite; }
@keyframes mytheme-hue { to { filter: hue-rotate(360deg); } }   /* 0=360 → 완벽 루프 */
```

### 5.5 글로우 맥박
```css
.cb-mytheme { animation: mytheme-glow 2.4s ease-in-out infinite; }
@keyframes mytheme-glow { 0%,100% { opacity: .85; } 50% { opacity: 1; } }
```

> **부드러운 루프 3원칙**
> 1) 셔머·입자는 **양끝이 화면 밖**이거나 **타일이 정확히 반복**되게.
> 2) 회전/색상은 `0deg→360deg` 로 자연 루프.
> 3) 속도가 다른 테두리들이 동기화되지 않도록 **주기를 서로 다르게**(예: 3.2s, 4.6s, 7.5s).

---

## 6. 블렌드 모드 — 빛을 빛처럼
- `mix-blend-mode: screen` — 흰/밝은 빛이 **더해지는** 느낌 (셔머·별·불씨).
- `mix-blend-mode: color-dodge` — 더 강하게 타오르는 홀로그램.
- 블렌드는 오버레이 내부에서만 합성되도록 앱이 격리(`isolation`)해 두었으니, 카드 밖 배경과 섞일 걱정은 없습니다.

---

## 7. 성능 & 접근성 체크리스트
- [ ] 레이어는 **3겹(본체+::before+::after)** 안에서 해결했는가
- [ ] 애니메이션은 `transform`/`opacity`/`filter`/`background-position` 위주(레이아웃 리플로우 없음)인가
- [ ] `@media (prefers-reduced-motion: reduce)` 로 애니메이션을 끄는 규칙을 넣었는가
- [ ] 클래스명·`@keyframes` 이름에 **고유 접두어**를 붙였는가
- [ ] 한 화면에 10장 떠도 과하지 않은 **밝기/채도**인가
- [ ] 글자(이름/시세) 가독성을 해치지 않는가(테두리는 가장자리에)

---

## 8. 등록 방법 (사이트에서)
1. `card-borders/` 폴더의 예시 파일을 열어 CSS를 복사하거나, 위 가이드대로 새로 작성합니다.
2. 관리자 → **상점 관리** → 종류 **테두리** 선택.
3. **적용 클래스명**(예: `cb-mydragon`)과 **CSS 코드**를 붙여넣습니다. 미리보기로 즉시 확인됩니다.
4. 이름·가격·활성화 설정 후 **추가**. 유저가 상점에서 구매해 카드에 장착할 수 있습니다.

> 별도 빌드·배포 없이, 입력한 CSS가 그대로 사이트에 주입되어 적용됩니다.

---

## 9. 예시 라이브러리
완성형 예시는 프로젝트 루트 **`card-borders/`** 폴더에 테마별로 들어 있습니다. 각 파일은 **그 파일 하나만으로 완성**됩니다.

| 파일 | 테마 | 핵심 연출 |
|---|---|---|
| `oriental.css`  | 동양풍 금장      | 금빛 이중 프레임 + 구름 코너 + 광택 |
| `medieval.css`  | 중세 강철 문장   | 강철·금장 + 리벳 + 방패 + 금속 광택 |
| `steampunk.css` | 스팀펑크         | 황동 프레임 + 회전 기어 2개 |
| `cyberpunk.css` | 사이버펑크       | 네온 회로 + 스캔라인 + 글로우 펄스 |
| `sakura.css`    | 벚꽃             | 분홍 프레임 + 떨어지는 꽃잎 |
| `beach.css`     | 여름 해변        | 청록 프레임 + 태양 + 움직이는 물결 |
| `autumn.css`    | 낙엽             | 단풍 프레임 + 떨어지는 낙엽 |
| `snow.css`      | 눈꽃             | 얼음 결정 + 내리는 눈 + 반짝임 |
| `royal.css`     | 로얄 골드        | 정교한 금장 + 보석 + 광택 |
| `galaxy.css`    | 갤럭시           | 성운(색 순환) + 반짝이는 별 |
| `volcano.css`   | 화산             | 흑요석 + 피어오르는 불씨 + 적열 |
| `prism.css`     | 프리즘 홀로      | 무지개 보더(흐름) + 광택 |

이 예시들을 **출발점**으로 삼되, 항상 한 단계 더 — **이미지 카드 스킨에 견줄 만한 완성도**를 목표로 다듬어 주세요. ✨
