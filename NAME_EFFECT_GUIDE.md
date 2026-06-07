# ✨ 카드 이름 효과(코스메틱) 제작 가이드

치카포(치지직 카드 포럼)의 **프리미엄 이름 효과**를 CSS만으로 만드는 방법을 처음부터 끝까지 설명합니다.
여기서 작성한 CSS를 관리자 페이지에 그대로 붙여넣으면 **별도 빌드·배포 없이 즉시 적용**됩니다.

> 테두리 제작은 [`CARD_BORDER_GUIDE.md`](./CARD_BORDER_GUIDE.md)를 참고하세요. 이 문서는 **카드의 스트리머 이름 글자**에 입히는 효과를 다룹니다.

> ## ⭐ 지향점 — "글자가 살아 있는 느낌"
> 이름 효과는 단순 색 변경이 아니라 **유료로 판매하는 텍스트 스킨**입니다.
> - 금빛 그라데이션, 네온 발광, 무지개 흐름, 불꽃·얼음 질감 같은 **고급 글자 연출**
> - 흐르는 그라데이션·깜빡임·글리치 같은 **생동감 있는 모션**
> - 무엇보다 **이름이 또렷이 읽혀야** 합니다(가독성 최우선).

---

## 1. 동작 원리 (필수 이해)

카드의 스트리머 이름은 다음과 같은 **텍스트 요소(span)** 로 렌더링됩니다.

```html
<span class="<레이아웃 클래스들> ne-myeffect">스트리머이름</span>
```

- 여러분이 작성한 CSS는 `<style>` 태그로 페이지에 **그대로 주입**되고, 그 안의 클래스(`.ne-myeffect`)가 이 글자 요소에 적용됩니다.
- 즉 여러분이 할 일은 **하나의 클래스(`.ne-myeffect`)로 완성되는 자기완결형 CSS**를 작성하는 것뿐입니다.
- 이 효과는 **보관함 카드, 카드 확대 모달, 프로필 대표 카드, 상점 미리보기, 관리자 미리보기** 등 이름이 보이는 모든 곳에 동일하게 적용됩니다.

### 알아둘 점
- 글자 요소는 **인라인 텍스트(span)** 입니다. 카드에 따라 `truncate`(말줄임), `drop-shadow`(흰 그림자), `font-bold` 등 레이아웃용 클래스가 함께 붙어 있습니다.
  여러분의 `.ne-*` 규칙은 `color`·`background`·`text-shadow`·`animation` 등을 **덮어써서** 효과를 입힙니다.
- 글자 자체에 효과를 주므로 `::before`/`::after`로 글자를 복제하는 기법(글자 내용을 모르기 때문에 `content: attr()` 불가)은 제한적입니다.
  대신 **그라데이션·그림자·필터·애니메이션**으로 충분히 화려하게 만들 수 있습니다.

---

## 2. 데이터 모델

이름 효과 상품은 `shop_items` 한 줄이며, `style_json` 필드에 저장됩니다. 두 가지 방식이 있습니다.

### (A) 클래스 + CSS 전문 — **권장(화려한 효과)**
```json
{ "class": "ne-aurora", "css": "...여기에 CSS 전문..." }
```
- `class` — 글자에 부여할 클래스명. **다른 효과와 겹치지 않는 고유 이름**(접두어 `ne-` 권장).
- `css` — 그 클래스를 완성하는 **CSS 코드 전문**. `@keyframes`·`@font-face`·`@import`까지 자유롭게.

### (B) 간단 인라인 스타일(JSON) — 레거시(간단 색/그림자)
```json
{ "color": "#ff44cc", "textShadow": "0 0 8px #ff44cc" }
```
- React 인라인 스타일 객체(카멜케이스 키)를 그대로 적용합니다. 애니메이션·가상요소는 못 씁니다.
- 이때는 관리자 폼의 **웹폰트 URL / font-family** 입력칸으로 폰트를 지정할 수 있습니다.
  (단, **(A) 클래스 방식에서는 폰트도 CSS 안에서** `@import`/`@font-face`로 불러와야 합니다 — 아래 6장 참고.)

관리자 페이지(상점 관리 → 종류 "이름 이펙트" → "커스텀 CSS 이름 이펙트")에서
**클래스명 + CSS 코드**를 입력하면 (A) JSON이 자동 구성되어 저장됩니다.

> ⚠️ **고유 이름 규칙**: 클래스명과 `@keyframes` 이름은 효과마다 고유해야 합니다.
> 여러 효과가 동시에 주입될 때 이름이 겹치면 서로 덮어써 깨집니다. 예: `ne-aurora`, `aurora-flow`.

---

## 3. 기본 템플릿 (복사해서 시작)

```css
/* 내 이름 효과 (클래스: ne-mytheme) */
.ne-mytheme {
  color: #ffd24a;                       /* 기본 글자색 */
  text-shadow: 0 0 6px rgba(255,200,80,.6);
  /* 필요하면 애니메이션 */
  animation: mytheme-glow 2.6s ease-in-out infinite;
}
@keyframes mytheme-glow {
  0%, 100% { text-shadow: 0 0 5px rgba(255,200,80,.5); }
  50%      { text-shadow: 0 0 12px rgba(255,200,80,.9); }
}

/* 모션 최소화 사용자는 애니메이션 정지 */
@media (prefers-reduced-motion: reduce) {
  .ne-mytheme { animation: none; }
}
```

---

## 4. 핵심 기법

### 4.1 그라데이션 글자 (background-clip: text)
글자 안을 그라데이션으로 채우는 가장 기본적이고 강력한 기법입니다.
```css
.ne-gold {
  background: linear-gradient(180deg, #fff6c0, #f7c948 45%, #a8741a);
  -webkit-background-clip: text;
          background-clip: text;
  -webkit-text-fill-color: transparent;
          color: transparent;
  /* 그라데이션 글자엔 text-shadow가 안 보이므로 글로우는 filter로 */
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.45));
}
```
> 그라데이션으로 채운 글자는 `text-shadow`가 보이지 않습니다. **외곽 발광/그림자는 `filter: drop-shadow()`** 로 주세요.

### 4.2 네온/발광 (text-shadow 다중)
```css
.ne-neon {
  color: #0ff;
  text-shadow: 0 0 4px #0ff, 0 0 10px #0ff, 0 0 18px #06f;
}
```

### 4.3 외곽선 (text-stroke)
```css
.ne-outline {
  color: #fff;
  -webkit-text-stroke: 1px #111;        /* 두께 1px, 검정 외곽선 */
  paint-order: stroke fill;             /* 외곽선이 글자 뒤로 */
}
```

### 4.4 무지개/색상 순환
```css
.ne-rainbow {
  color: #ff5db1;
  animation: rainbow-hue 6s linear infinite;
}
@keyframes rainbow-hue { to { filter: hue-rotate(360deg); } }   /* 0=360 → 완벽 루프 */
```

---

## 5. 애니메이션 레시피 (바로 붙여넣기)

### 5.1 흐르는 오로라 그라데이션
```css
.ne-aurora {
  background: linear-gradient(90deg, #5eead4, #818cf8, #f472b6, #5eead4);
  background-size: 200% auto;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: aurora-flow 4s linear infinite;
}
@keyframes aurora-flow { to { background-position: 200% center; } }
```

### 5.2 불꽃 (위로 일렁이는 그라데이션)
```css
.ne-fire {
  background: linear-gradient(0deg, #ff3d00, #ffb300 55%, #fff176);
  background-size: 100% 220%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  filter: drop-shadow(0 0 5px rgba(255,90,20,.6));
  animation: fire-flicker 1.6s ease-in-out infinite alternate;
}
@keyframes fire-flicker { from { background-position: 50% 0%; } to { background-position: 50% 100%; } }
```

### 5.3 얼음/서리
```css
.ne-frost {
  background: linear-gradient(180deg, #ffffff, #bfe9ff 60%, #7db8e8);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  filter: drop-shadow(0 0 4px rgba(191,233,255,.8));
}
```

### 5.4 네온 플리커
```css
.ne-neon-flicker {
  color: #39ff14;
  text-shadow: 0 0 4px #39ff14, 0 0 12px #1ec700;
  animation: neon-flicker 3s steps(60) infinite;
}
@keyframes neon-flicker {
  0%,100%, 92%, 96% { opacity: 1; }
  93% { opacity: .35; }
  95% { opacity: .8; }
}
```

### 5.5 글리치(색수차 흔들림)
```css
.ne-glitch {
  color: #fff;
  animation: glitch 1.8s steps(2,end) infinite;
}
@keyframes glitch {
  0%, 60%, 100% { text-shadow: 0 0 transparent; }
  62% { text-shadow: -1.5px 0 #ff00d4, 1.5px 0 #00eaff; }
  66% { text-shadow:  1.5px 0 #ff00d4,-1.5px 0 #00eaff; }
  70% { text-shadow: 0 0 transparent; }
}
```

### 5.6 홀로그램 (그라데이션 + 색 순환)
```css
.ne-holo {
  background: linear-gradient(90deg, #ff6ec4, #f9d423, #3ee6c4, #5b8def, #b06ef9, #ff6ec4);
  background-size: 300% auto;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: holo-flow 5s linear infinite;
}
@keyframes holo-flow { to { background-position: 300% center; } }
```

### 5.7 골드 펄스(맥박 발광)
```css
.ne-gold-pulse {
  background: linear-gradient(180deg, #fff6c0, #f7c948 45%, #a8741a);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  animation: gold-pulse 2.4s ease-in-out infinite;
}
@keyframes gold-pulse {
  0%,100% { filter: drop-shadow(0 0 3px rgba(247,201,72,.5)); }
  50%     { filter: drop-shadow(0 0 9px rgba(247,201,72,.95)); }
}
```

---

## 6. 폰트 적용 (웹폰트)

클래스 방식(A)에서는 **CSS 안에서 폰트를 직접 불러옵니다.**

### 6.1 구글 폰트 등 `@import`
```css
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700&display=swap');
.ne-cinzel { font-family: 'Cinzel', serif; color: #f7c948; letter-spacing: .04em; }
```
> ⚠️ `@import` 는 반드시 **CSS 맨 위(다른 규칙보다 먼저)** 에 와야 합니다.

### 6.2 `@font-face` 직접 정의
```css
@font-face {
  font-family: 'MyBrush';
  src: url('https://example.com/fonts/mybrush.woff2') format('woff2');
  font-display: swap;
}
.ne-brush { font-family: 'MyBrush', cursive; color: #fff; }
```

> 간단 인라인 방식(B)만 쓸 경우엔 관리자 폼의 **웹폰트 URL / font-family** 칸으로도 폰트를 지정할 수 있습니다.

---

## 7. 가독성 & 성능 체크리스트
- [ ] 어두운 카드 배경에서 **글자가 또렷이 읽히는가** (너무 어둡거나 저대비 금지)
- [ ] 그라데이션 글자에는 `filter: drop-shadow()` 로 살짝 외곽 발광/그림자를 줘 배경과 분리했는가
- [ ] 애니메이션은 `transform`/`opacity`/`filter`/`background-position` 위주(리플로우 없음)인가
- [ ] `@media (prefers-reduced-motion: reduce)` 로 애니메이션을 끄는 규칙을 넣었는가
- [ ] 클래스명과 `@keyframes` 이름에 **고유 접두어**(`ne-`)를 붙였는가
- [ ] `@import` 는 CSS 맨 위에 두었는가
- [ ] 깜빡임이 과해 **눈에 피로**를 주지 않는가(저빈도·짧게)

---

## 8. 등록 방법 (사이트에서)
1. 위 예시를 복사하거나 가이드대로 새로 작성합니다.
2. 관리자 → **상점 관리** → 종류 **이름 이펙트** 선택.
3. **커스텀 CSS 이름 이펙트** 칸에 **적용 클래스명**(예: `ne-aurora`)과 **CSS 코드**를 붙여넣습니다. 미리보기로 즉시 확인됩니다.
4. 이름·가격·(필요 시) 1인 최대 구매 갯수·활성화 설정 후 **추가**.
5. 유저가 상점에서 구매해 카드에 장착하면, 카드의 스트리머 이름에 효과가 입혀집니다.

> 별도 빌드·배포 없이, 입력한 CSS가 그대로 사이트에 주입되어 적용됩니다.

---

## 9. 바로 쓸 수 있는 프리셋 모음

| 클래스 | 느낌 | 핵심 |
|---|---|---|
| `ne-gold` | 골드 각인 | 금빛 세로 그라데이션 + drop-shadow |
| `ne-gold-pulse` | 맥박 골드 | 금빛 + 발광 펄스 |
| `ne-aurora` | 오로라 | 흐르는 청록·보라·핑크 그라데이션 |
| `ne-holo` | 홀로그램 | 무지개 그라데이션 흐름 |
| `ne-rainbow` | 무지개 | hue-rotate 색상 순환 |
| `ne-neon` | 네온 | 다중 text-shadow 발광 |
| `ne-neon-flicker` | 네온(점멸) | 발광 + 깜빡임 |
| `ne-fire` | 불꽃 | 일렁이는 적·황 그라데이션 |
| `ne-frost` | 서리 | 백·청 그라데이션 + 한기 글로우 |
| `ne-glitch` | 글리치 | 색수차 흔들림 |
| `ne-outline` | 외곽선 | text-stroke 테두리 |
| `ne-cinzel` | 세리프 폰트 | 웹폰트 + 골드 |

이 예시들을 **출발점**으로 삼되, **가독성을 지키면서** 한 단계 더 화려하게 다듬어 주세요. ✨
