# 🏅 칭호 제작 가이드

치카포(치지직 카드 포럼)의 **유저 칭호 배지**를 CSS만으로 만드는 방법을 처음부터 끝까지 설명합니다.
여기서 작성한 CSS를 관리자 페이지의 칭호 CSS 칸에 그대로 붙여넣으면 **별도 빌드·배포 없이 즉시 적용**됩니다.

> 테두리 제작은 [`CARD_BORDER_GUIDE.md`](./CARD_BORDER_GUIDE.md), 카드 이름 효과 제작은 [`NAME_EFFECT_GUIDE.md`](./NAME_EFFECT_GUIDE.md)를 참고하세요.
> 이 문서는 **프로필·랭킹·메인 사이드바·내 정보 화면에 표시되는 유저 칭호 배지**를 다룹니다.

> ## ⭐ 지향점 — "작지만 강한 소장 가치"
> 칭호는 작은 UI 배지지만, 유저가 직접 대표로 장착하는 **정체성 아이템**입니다.
> - 한눈에 주제와 등급이 읽히는 **명확한 색·아이콘·문구**
> - 작은 크기에서도 무너지지 않는 **선명한 테두리, 그림자, 대비**
> - 은은한 글로우·반짝임·스캔라이트 같은 **끊김 없는 반복 애니메이션**
> - 무엇보다 **칭호명이 또렷이 읽혀야** 합니다(가독성 최우선).

---

## 1. 동작 원리 (필수 이해)

칭호는 다음과 같은 **인라인 배지 요소(span)** 로 렌더링됩니다.

```html
<span class="user-title-123">
  <svg>...</svg>
  <span>칭호명</span>
</span>
```

- 앱은 칭호마다 `user-title-{id}` 형태의 자동 클래스를 붙입니다.
- 여러분이 작성한 CSS는 `<style>` 태그로 페이지에 **그대로 주입**됩니다.
- 관리자 입력 CSS에 `{{selector}}`를 쓰면 앱이 자동으로 `.user-title-{id}`로 치환합니다.
- 칭호는 **메인 사이드바, 프로필 모달, 랭킹, 내 정보, 관리자 미리보기** 등 여러 크기에서 동일하게 재사용됩니다.

### 알아둘 점
- 칭호 배지는 기본적으로 `inline-flex`, `rounded-full`, 작은 글자 크기, 아이콘, 텍스트를 포함합니다.
- 일반 표시 크기는 약 `10px`, compact 표시 크기는 약 `9px`입니다. 세밀한 장식은 **작은 크기에서도 보이는 것만** 남기세요.
- CSS가 `{`를 포함하지 않는 단순 선언문이면 앱이 자동으로 해당 칭호에만 감싸서 적용합니다.
- 복합 효과(`::before`, `::after`, `@keyframes`, 자식 선택자)를 쓰려면 **`{{selector}}` 방식**을 권장합니다.
- 직접 `.my-title { ... }` 같은 클래스를 쓰는 완성 CSS도 지원되지만, 여러 칭호와 충돌하지 않도록 반드시 고유 접두어를 붙이세요.

---

## 2. 데이터 모델

칭호는 `user_titles` 데이터이며, 관리자 페이지에서 다음 항목을 입력합니다.

| 항목 | 설명 | 제한 |
|---|---|---|
| 칭호명 | 배지에 표시되는 텍스트 | 1~40자 |
| 칭호 설명 | 마우스 오버/포커스 시 보이는 설명 | 300자 이하 |
| Lucide 아이콘명 | `Award`, `Crown`, `Star`, `Sparkles` 등 lucide-react 아이콘명 | 영문/숫자, 영문 시작 |
| 아이콘 색상 | 아이콘 기본 색 | `#facc15` 같은 6자리 HEX |
| 칭호 CSS | 배지 시각 효과 | 20,000자 이하 |

관리자 페이지(관리자 → **칭호**)에서 칭호를 만들고, 유저에게 수여하거나 구독 칭호 자동 지급 규칙에 연결할 수 있습니다.
유저는 내 정보에서 보유 칭호 중 1개를 대표 칭호로 장착합니다.

---

## 3. CSS 입력 방식

### (A) 단순 선언문 — 간단한 색/그림자
```css
background: linear-gradient(135deg, #713f12, #facc15);
color: #fff7d6;
box-shadow: 0 0 12px rgba(250, 204, 21, .35);
```

앱이 자동으로 다음처럼 감쌉니다.

```css
.user-title-123 {
  background: linear-gradient(135deg, #713f12, #facc15);
  color: #fff7d6;
  box-shadow: 0 0 12px rgba(250, 204, 21, .35);
}
```

### (B) `{{selector}}` + CSS 전문 — **권장(화려한 효과)**
```css
{{selector}} {
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #0f172a, #2563eb);
  color: white;
}

{{selector}}::before {
  content: "";
  position: absolute;
  inset: 0;
}
```

- `{{selector}}`는 해당 칭호의 자동 클래스(`.user-title-123`)로 치환됩니다.
- 칭호 ID가 바뀌어도 그대로 재사용할 수 있어 가장 안전합니다.
- `::before`, `::after`, `@keyframes`, `svg`, `> span` 스타일링까지 모두 가능합니다.

### (C) 직접 클래스 CSS — 특수한 경우만
```css
.ut-myevent {
  background: #111827;
  color: #fff;
}
```

- 앱은 CSS에서 첫 번째 클래스명(`ut-myevent`)을 찾아 칭호 요소에 추가합니다.
- 클래스명과 `@keyframes` 이름이 겹치면 다른 칭호를 깨뜨릴 수 있습니다.
- 직접 클래스 방식은 반드시 `ut-이벤트명-*`, `chikapo-이벤트명-*`처럼 고유 접두어를 붙이세요.

> ⚠️ **고유 이름 규칙**: `@keyframes` 이름은 전역입니다.
> 예: `shine`, `pulse`, `scan` 금지. `chikapo-2026-summer-title-shine`처럼 길고 고유하게 작성하세요.

---

## 4. 기본 템플릿 (복사해서 시작)

```css
/*
 * Title name: 내 칭호
 * Lucide icon: Sparkles
 * Icon color: #38bdf8
 *
 * Paste this entire CSS into the title CSS field.
 * {{selector}} is replaced with the title's generated class.
 */

{{selector}} {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(56, 189, 248, 0.72);
  background:
    radial-gradient(circle at 18% 50%, rgba(125, 211, 252, 0.22), transparent 28%),
    linear-gradient(135deg, #082f49 0%, #1e40af 48%, #312e81 100%);
  color: #eff6ff;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 2px rgba(15, 23, 42, 0.72);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.1),
    0 0 0 1px rgba(56, 189, 248, 0.12),
    0 0.18rem 0.62rem rgba(37, 99, 235, 0.2);
  animation: chikapo-mytitle-breathe 3.2s ease-in-out infinite;
}

{{selector}}::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: -70% auto -70% -42%;
  width: 24%;
  transform: rotate(18deg);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.42), transparent);
  filter: blur(0.04rem);
  animation: chikapo-mytitle-light 4.4s cubic-bezier(0.45, 0, 0.2, 1) infinite;
}

{{selector}} > * {
  position: relative;
  z-index: 1;
}

{{selector}} svg {
  filter: drop-shadow(0 0 0.2rem rgba(125, 211, 252, 0.8));
}

@keyframes chikapo-mytitle-breathe {
  0%,
  100% {
    border-color: rgba(56, 189, 248, 0.72);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.1),
      0 0 0 1px rgba(56, 189, 248, 0.12),
      0 0.18rem 0.62rem rgba(37, 99, 235, 0.2);
  }

  50% {
    border-color: rgba(186, 230, 253, 0.92);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.16),
      0 0 0 1px rgba(56, 189, 248, 0.22),
      0 0.22rem 0.82rem rgba(37, 99, 235, 0.32);
  }
}

@keyframes chikapo-mytitle-light {
  0%,
  18% {
    left: -42%;
    opacity: 0;
  }

  36% {
    opacity: 0.78;
  }

  64%,
  100% {
    left: 124%;
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  {{selector}},
  {{selector}}::before {
    animation: none;
  }
}
```

---

## 5. 핵심 기법

### 5.1 아이콘과 텍스트를 앞으로 올리기
가상요소를 쓰면 배경 장식이 아이콘과 글자 위를 덮을 수 있습니다.
항상 실제 콘텐츠를 위 레이어로 올리세요.

```css
{{selector}} {
  position: relative;
  isolation: isolate;
  overflow: hidden;
}

{{selector}}::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0;
}

{{selector}} > * {
  position: relative;
  z-index: 1;
}
```

### 5.2 아이콘 강조
아이콘은 `icon_color` 필드로 기본 색이 들어가지만, CSS에서 더 정교하게 조정할 수 있습니다.

```css
{{selector}} svg {
  color: #facc15 !important;
  filter:
    drop-shadow(0 0 0.12rem rgba(254, 240, 138, 0.8))
    drop-shadow(0 0 0.28rem rgba(250, 204, 21, 0.45));
}
```

### 5.3 텍스트 가독성 보호
그라데이션과 장식이 강한 칭호는 텍스트 뒤에 아주 약한 음영을 둘 수 있습니다.

```css
{{selector}} > span {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.36);
  box-shadow:
    -0.14rem 0 0 rgba(15, 23, 42, 0.36),
    0.14rem 0 0 rgba(15, 23, 42, 0.36);
}
```

### 5.4 작은 크기 기준 설계
- `px`보다 `rem` 단위를 우선 사용하면 compact 표시에서도 상대적으로 안정적입니다.
- 장식 폭은 대략 `2.5rem~3rem` 안에서 해결하세요.
- 긴 칭호명도 고려해 배경 장식은 오른쪽 끝이나 배지 전체 후경에 두고, 글자 중앙을 지나치게 가리지 마세요.

---

## 6. 애니메이션 설계 규칙

칭호 애니메이션은 반드시 **처음과 끝이 이어져서 반복**되어야 합니다.
작은 배지는 움직임의 끊김이 더 잘 보이므로, 아래 규칙을 지키지 않은 CSS는 등록하지 마세요.

### 6.1 완벽 루프의 기본
```css
@keyframes chikapo-mytitle-pulse {
  0%,
  100% {
    opacity: 0.82;
    transform: translateY(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-0.03rem);
  }
}
```

- `0%`와 `100%`의 값은 반드시 같아야 합니다.
- 왕복 모션은 `0% = 100%`, `50% = 정점` 구조를 기본으로 합니다.
- `alternate`를 쓰더라도 양 끝의 상태가 어색하게 튀지 않는지 미리보기로 확인하세요.

### 6.2 스캔라이트/셔머
셔머는 시작과 끝에서 **완전히 배지 밖**에 있고, 그때 `opacity: 0`이어야 합니다.

```css
{{selector}}::after {
  content: "";
  position: absolute;
  z-index: 0;
  inset: -80% auto -80% -40%;
  width: 22%;
  transform: rotate(18deg);
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
  animation: chikapo-mytitle-scan 4s ease-in-out infinite;
}

@keyframes chikapo-mytitle-scan {
  0%,
  18% {
    left: -40%;
    opacity: 0;
  }

  35% {
    opacity: 0.8;
  }

  64%,
  100% {
    left: 122%;
    opacity: 0;
  }
}
```

> 시작점과 끝점의 위치가 달라도 보이지 않는 상태라면 점프가 감지되지 않습니다.
> 보이는 상태에서 `left: 122%`에서 `left: -40%`로 순간 이동하면 끊긴 루프입니다.

### 6.3 흐르는 그라데이션
그라데이션 흐름은 첫 색과 마지막 색을 같게 두고, 이동 거리를 배경 주기와 맞춥니다.

```css
{{selector}} {
  background: linear-gradient(90deg, #22d3ee, #a78bfa, #f472b6, #22d3ee);
  background-size: 200% 100%;
  animation: chikapo-mytitle-gradient 5s linear infinite;
}

@keyframes chikapo-mytitle-gradient {
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
```

- `linear-gradient`의 첫 색과 마지막 색이 같아야 색 경계가 끊기지 않습니다.
- `background-size`와 `background-position` 이동량을 짝으로 맞추세요.
- 단순 왕복 그라데이션은 `0%`, `50%`, `100%` 방식으로 작성하면 안전합니다.

### 6.4 색상 순환/회전
```css
{{selector}} {
  animation: chikapo-mytitle-hue 8s linear infinite;
}

@keyframes chikapo-mytitle-hue {
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(360deg); }
}
```

- 각도·색상 순환은 `0deg -> 360deg`처럼 수학적으로 같은 상태로 끝내세요.
- 배지 전체에 과한 `filter`를 걸면 텍스트 대비가 흔들릴 수 있습니다.

### 6.5 타일 파티클
작은 별·눈·먼지 같은 배경 파티클은 타일 크기와 이동 거리를 정확히 맞춥니다.

```css
{{selector}}::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: -0.2rem;
  background:
    radial-gradient(circle at 20% 30%, rgba(255,255,255,.8) 0 0.04rem, transparent 0.05rem),
    radial-gradient(circle at 78% 62%, rgba(125,211,252,.7) 0 0.035rem, transparent 0.045rem);
  background-size: 1.2rem 0.8rem;
  animation: chikapo-mytitle-dust 6s linear infinite;
}

@keyframes chikapo-mytitle-dust {
  0% { background-position: 0 0; }
  100% { background-position: 1.2rem 0.8rem; }
}
```

> **부드러운 루프 4원칙**
> 1. `0%`와 `100%`는 같거나, 보이지 않는 상태에서만 점프해야 합니다.
> 2. 반복 배경은 타일 크기와 이동 거리를 정확히 맞춥니다.
> 3. 회전·색상 순환은 `0deg -> 360deg`처럼 같은 상태로 끝냅니다.
> 4. 서로 다른 칭호가 동시에 보여도 동기화되지 않도록 주기를 다르게 둡니다(예: 2.8s, 4.1s, 5.6s).

---

## 7. 바로 쓸 수 있는 레시피

### 7.1 골드 레전드
```css
{{selector}} {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(254, 240, 138, 0.86);
  background: linear-gradient(135deg, #451a03 0%, #b45309 48%, #facc15 72%, #78350f 100%);
  background-size: 180% 180%;
  color: #fffbeb;
  text-shadow: 0 1px 0 rgba(69, 26, 3, 0.9), 0 0 0.24rem rgba(254, 240, 138, 0.58);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.16), 0 0 .8rem rgba(250,204,21,.28);
  animation: chikapo-title-gold-breathe 3.6s ease-in-out infinite;
}

{{selector}} svg {
  color: #fde68a !important;
  filter: drop-shadow(0 0 0.22rem rgba(250,204,21,.72));
}

@keyframes chikapo-title-gold-breathe {
  0%,
  100% {
    background-position: 0% 50%;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.16), 0 0 .8rem rgba(250,204,21,.28);
  }

  50% {
    background-position: 100% 50%;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,.24), 0 0 1.05rem rgba(250,204,21,.42);
  }
}

@media (prefers-reduced-motion: reduce) {
  {{selector}} { animation: none; }
}
```

### 7.2 별빛 수집가
```css
{{selector}} {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(165, 180, 252, 0.72);
  background: linear-gradient(135deg, #111827, #312e81 55%, #0f172a);
  color: #eef2ff;
  text-shadow: 0 1px 2px rgba(15, 23, 42, 0.75);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08), 0 0 .7rem rgba(129,140,248,.22);
}

{{selector}}::before {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 0.12rem 0.35rem 0.12rem auto;
  width: 2.8rem;
  opacity: 0.62;
  background:
    radial-gradient(circle at 10% 52%, #fef3c7 0 0.05rem, transparent 0.065rem),
    radial-gradient(circle at 36% 34%, #c4b5fd 0 0.045rem, transparent 0.06rem),
    radial-gradient(circle at 62% 64%, #fef3c7 0 0.05rem, transparent 0.065rem),
    radial-gradient(circle at 88% 42%, #bfdbfe 0 0.045rem, transparent 0.06rem);
  filter: drop-shadow(0 0 .2rem rgba(199,210,254,.6));
  animation: chikapo-title-stars-twinkle 2.4s ease-in-out infinite;
}

{{selector}} > * {
  position: relative;
  z-index: 1;
}

@keyframes chikapo-title-stars-twinkle {
  0%,
  100% {
    opacity: 0.48;
    transform: translateY(0);
  }

  50% {
    opacity: 0.9;
    transform: translateY(-0.035rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  {{selector}}::before { animation: none; }
}
```

### 7.3 사이버 인증
```css
{{selector}} {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border: 1px solid rgba(34, 211, 238, 0.78);
  background:
    linear-gradient(90deg, rgba(34,211,238,.16) 1px, transparent 1px),
    linear-gradient(135deg, #0f172a, #155e75 48%, #1e1b4b);
  background-size: 0.42rem 100%, 100% 100%;
  color: #ecfeff;
  text-shadow: 0 0 .34rem rgba(103,232,249,.72);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08), 0 0 .75rem rgba(34,211,238,.22);
  animation: chikapo-title-cyber-grid 5s linear infinite;
}

{{selector}}::after {
  content: "";
  position: absolute;
  z-index: 0;
  inset: -80% auto -80% -36%;
  width: 20%;
  transform: rotate(16deg);
  background: linear-gradient(90deg, transparent, rgba(236,254,255,.62), transparent);
  animation: chikapo-title-cyber-scan 3.8s ease-in-out infinite;
}

{{selector}} > * {
  position: relative;
  z-index: 1;
}

@keyframes chikapo-title-cyber-grid {
  0% { background-position: 0 0, 50% 50%; }
  100% { background-position: 0.42rem 0, 50% 50%; }
}

@keyframes chikapo-title-cyber-scan {
  0%,
  20% {
    left: -36%;
    opacity: 0;
  }

  38% {
    opacity: 0.78;
  }

  68%,
  100% {
    left: 120%;
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  {{selector}},
  {{selector}}::after { animation: none; }
}
```

---

## 8. 성능 & 접근성 체크리스트

- [ ] 칭호명이 작은 크기에서도 또렷이 읽히는가
- [ ] 아이콘과 텍스트가 `::before`/`::after` 장식보다 위에 있는가
- [ ] 애니메이션의 `0%`와 `100%`가 같거나, 점프 구간이 완전히 보이지 않는 상태인가
- [ ] 스캔라이트는 시작/끝이 배지 밖이고 `opacity: 0`인가
- [ ] 흐르는 그라데이션은 첫 색과 마지막 색이 같거나 왕복 구조인가
- [ ] 타일 파티클은 `background-size`와 `background-position` 이동 거리가 정확히 맞는가
- [ ] 애니메이션은 `transform`/`opacity`/`filter`/`background-position` 위주인가
- [ ] `@media (prefers-reduced-motion: reduce)`로 애니메이션을 끄는 규칙을 넣었는가
- [ ] 클래스명과 `@keyframes` 이름에 고유 접두어를 붙였는가
- [ ] 한 화면에 여러 칭호가 떠도 과하지 않은 밝기/채도인가
- [ ] compact 표시(약 9px)에서도 레이아웃이 깨지지 않는가
- [ ] CSS가 20,000자 제한 안에 들어가는가

---

## 9. 등록 방법 (사이트에서)

1. 위 템플릿이나 `title-effects/` 폴더의 예시 파일을 복사해 CSS를 작성합니다.
2. 관리자 → **칭호** → **새 칭호 생성**으로 이동합니다.
3. 칭호명, 설명, Lucide 아이콘명, 아이콘 색상, 칭호 CSS를 입력합니다.
4. 미리보기에서 일반 크기와 긴 칭호명을 확인합니다.
5. 저장 후 유저에게 수여하거나, 구독 칭호 자동 지급 규칙에 연결합니다.
6. 유저가 내 정보에서 해당 칭호를 장착하면 프로필·랭킹·메인 사이드바 등에 표시됩니다.

> 별도 빌드·배포 없이, 입력한 CSS가 그대로 사이트에 주입되어 적용됩니다.

---

## 10. 예시 라이브러리

완성형 예시는 프로젝트 루트 **`title-effects/`** 폴더에 들어 있습니다.
각 파일은 관리자 칭호 CSS 칸에 그대로 붙여넣을 수 있습니다.

| 파일 | 테마 | 핵심 연출 |
|---|---|---|
| `beta-tester.css` | 베타테스터 | 청록·보라 그라데이션 + 스캔라이트 |
| `five-star-card.css` | 별이다섯개 | 별빛 배경 + 은은한 반짝임 |
| `supporter.css` | 후원자 | 따뜻한 골드 브라운 + 하트/후원 모티프 |

이 예시들을 출발점으로 삼되, 새 칭호를 만들 때는 항상 **끊김 없는 반복, 작은 크기 가독성, 고유 keyframes 이름**을 먼저 검증하세요.
