# 🎴 카드 테두리(코스메틱) 제작 가이드

치카포(치지직 카드 포럼)의 **프리미엄 카드 테두리**를 CSS만으로 만드는 방법을 처음부터 끝까지 설명합니다.
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
- 카드 사진 바로 위, 하단 그라데이션 및 텍스트 아래(`z-index: 5`)에 위치합니다. 이를 통해 **카드 하단의 어두워지는 효과(가독성 오버레이)가 테두리 위로 부드럽게 덮여** 자연스럽게 융합됩니다.
- 여러분이 작성한 CSS는 `<style>` 태그로 페이지에 **그대로 주입**되고, 그 안의 클래스(`.cb-xxx`)가 이 오버레이에 적용됩니다.

즉 여러분이 할 일은 **하나의 클래스(`.cb-xxx`)로 완성되는 자기완결형 CSS**를 작성하는 것뿐입니다.

### 층위 구조 (z-index 레이아웃)
정교한 렌더링을 위해 앱 내부의 카드 레이어는 다음과 같은 순서로 겹쳐 있습니다:
1. **카드 이미지** (`z-0`)
2. **코스메틱/테두리 오버레이** (`z-5`)
3. **하단 그라데이션 가독성 오버레이** (`z-15`) - 테두리 하단도 자연스럽게 덮어 씌우는 효과
4. **텍스트 및 별 등급, 숫자 등 콘텐츠** (`z-20`)

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
  z-index: 5;
  border-radius: 3.43px;     /* 64px 논리 폭 기준 곡률; 런타임이 실제 카드 폭에 맞게 변환 */
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

### 4.2 꼭짓점 모서리 곡률 규격 (rx, ry 값 계산)
치카포의 카드 모서리 둥글기는 Tailwind CSS 기준 **`rounded-xl` (`border-radius: 12px`)**로 규격화되어 있습니다. 테두리 곡선이 카드의 외곽 모서리와 틈 없이 완벽하게 들어맞으려면 SVG의 모서리 반경(`rx`, `ry`) 계산 공식을 지켜야 합니다.

> 💡 **중요 — 모서리 잘림 버그 방지 (border-radius: 3.43px)**
> 카드 테두리 CSS의 URL 바깥 `px` 값은 **카드 가로 `64px`를 기준으로 한 논리 단위**입니다. 런타임은 CSS를 주입하기 전에 data URI 같은 `url(...)` 토큰을 보호한 뒤, 나머지 `Npx`를 `calc(var(--cosmetic-frame-unit) * N)`으로 바꿉니다. 이때 `--cosmetic-frame-unit`은 `calc(100cqw / 64)`입니다.
>
> `.cosmetic-frame` 자체는 처음부터 카드 전체 크기이며 전역 스타일에서 `transform: none !important`를 사용합니다. 즉 **64px짜리 엘리먼트를 `transform: scale(...)`로 확대하지 않습니다.** 예를 들어 카드 폭이 `224px`이면 논리 `3.43px`는 `3.43 × (224 / 64) ≈ 12px`로 직접 렌더링되고, 다른 카드 크기에서도 같은 비율로 변합니다. 따라서 `border-radius: inherit`이나 화면 기준 `12px`를 직접 쓰지 말고, 논리 반경 **`3.43px`**를 유지하세요.

- **기본 곡률 반경**: 카드 너비 100 기준 외곽선 곡률은 **`5.36` (약 `5.4`)**입니다.
- **안쪽 오프셋 반영 공식**: 테두리 선이 카드 가장자리에서 안쪽으로 `d`만큼 들어와서 그려질 경우, 평행한 곡선을 유지하기 위해 둥글기 반경을 줄여야 합니다.
  $$\text{rx} = \text{ry} = 5.36 - d$$
  *(단, $d$는 viewBox 100x160 기준 선의 중심선이 안쪽으로 들어간 오프셋 거리)*

#### 오프셋별 권장 `rx`/`ry` 가이드:
- **오프셋이 없는 경우** (가장자리에 딱 붙임: `x="0" y="0"`):
  - `rx="5.4"` `ry="5.4"`
- **오프셋이 2px인 경우** (약간 들임: `x="2" y="2" width="96" height="156"`):
  - `rx="3.4"` `ry="3.4"`
- **오프셋이 3px인 경우** (표준 들임: `x="3" y="3" width="94" height="154"`):
  - `rx="2.4"` `ry="2.4"`

> ⚠️ **주의**: rx 값이 이보다 크거나 작으면 꼭짓점 꺾임의 둥글기가 카드 모서리와 어긋나 틈이 보이거나 카드 밖으로 튀어나가게 됩니다. 정교한 마감을 위해 반드시 위 공식에 맞추어 `rx`, `ry`를 기재하세요.

### 4.3 작성 → 인코딩 절차
1. 보기 좋게 일반 SVG로 먼저 그립니다:
   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160" preserveAspectRatio="none">
     <rect x="3" y="3" width="94" height="154" rx="2.36" ry="2.36" fill="none" stroke="#e8c66a" stroke-width="2.6"/>
     <rect x="4.6" y="4.6" width="90.8" height="150.8" rx="0.76" ry="0.76" fill="none" stroke="#b8451f" stroke-width="1.1"/>
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
   background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 160' preserveAspectRatio='none'%3E%3Crect x='3' y='3' width='94' height='154' rx='2.36' ry='2.36' fill='none' stroke='%23e8c66a' stroke-width='2.6'/%3E%3Crect x='4.6' y='4.6' width='90.8' height='150.8' rx='.76' ry='.76' fill='none' stroke='%23b8451f' stroke-width='1.1'/%3E%3C/svg%3E");
   ```

### 4.4 완성도를 높이는 디테일
- **이중/삼중 프레임**: 굵은 금속선 + 얇은 보조선 + 점선 패턴으로 깊이를 줍니다.
- **코너 장식**: 네 모서리에 구름·덩굴·기어·보석 등 모티프를 배치하면 "스킨" 느낌이 확 삽니다.
- **모서리 비대칭**: 한쪽 코너를 더 화려하게(예: 사이버펑크 L자 브래킷) 두면 시선이 살아납니다.
- **비대칭 광원**: `box-shadow` 의 외곽 발광 + `inset` 음영으로 **유리/금속 질감**을 연출합니다.

> 모서리가 둥근 곡선 장식은 `preserveAspectRatio='none'` 로 약간 늘어납니다.
> 너무 동그란 모티프보다 **사선·결정·기하학** 모티프가 늘어짐을 잘 견딥니다.

---

## 5. 살아 있게 만들기 — 애니메이션 레시피

### 5.1 빛 반사(셔머) 및 공간감 연출 가이드
> ⚠️ **[중요] 좌에서 우로 단순히 슬라이드되는 기계적이고 획일적인 광택(셔머) 효과는 지양하세요.**
> 카드를 대각선으로 휩쓸고 지나가는 단순 1차원 광택 띠 애니메이션은 프리미엄 코스메틱의 고급스러운 질감을 떨어뜨릴 수 있습니다. 대신 다음 방식을 지향하세요:
> 1. **3D 패럴랙스 입체 입자 유영**: 광택 띠 대신, 후경(`::before`)과 전경(`::after`)의 파티클 스크롤 속도 및 3D 회전 각도를 엇갈리게 주어 깊이를 연출합니다.
> 2. **유리 굴절 글린트**: 광택 효과가 꼭 필요한 테마라면 흰 코어 양옆에 시안/마젠타를 살짝 두어 유리 굴절(색수차) 느낌을 정교하게 주거나, 맥박 형태의 은은한 글로우를 활용하세요.


### 5.2 떨어지는/피어오르는 입자 (진짜 벚꽃잎·눈결정·단풍잎·불꽃 등) — 160px 정밀 루프 및 복합 스웨이 설계법
단순히 `radial-gradient`나 단순 원형(`circle`), 혹은 투박한 패스로 찌그러진 정체불명의 덩어리를 그리는 것은 프리미엄 테두리로서 부적합합니다. **여러 개의 그라데이션, 명암선, 하이라이트선 등 세밀한 벡터 패스 조합으로 구현된 고화질 SVG 소스를 사전에 공들여 디자인하여 적용**해야 상용 등급의 퀄리티를 얻을 수 있습니다.

또한, 입자가 수직으로만 떨어지면 기계적이고 지루합니다. **배경 스크롤(Y축)과 수평 산들 흔들림(translateX) 및 공기 저항 회전(rotate/skewX)을 단일 키프레임 속에 정밀하게 연동**하여 극강의 부드러움을 구현하세요.

> ⚠️ **[필수] 파티클 크기 및 가독성 제한**
> 화면을 떠다니는 입자의 크기가 지나치게 크면 스트리머의 얼굴이나 카드 내 텍스트 가독성을 심각하게 방해합니다.
> - **대형 메인 파티클**: viewBox 너비 100 기준 최대 `scale(0.4)` 이하로 통제되어야 합니다.
> - **보조/배경 파티클**: `scale(0.15~0.25)` 이하로 작고 은은하게 세팅하여 은밀히 감싸는 공간감을 주어야 합니다.

```css
.cb-mytheme::before {
  content: ""; 
  position: absolute; 
  /* [중요] 흔들리거나 요동칠 때 카드 바깥 경계선이 툭 잘려 보이는 현상을 방지하는 마진 가이드 */
  inset: -15px; 
  pointer-events: none;
  background-repeat: repeat;
  background-size: 100% 160px;               /* 백가운드 타일 세로 주기를 160px로 박제 */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 160'%3E%3C!-- [핵심] 상하단 루프 완벽 일치를 위한 반 가른 보완용 장식 쌍 (예: Y=0 및 Y=160 에 나누어 배치) --%3E%3Cpath d='M50,-7 L52,-15 L55,-12 L60,-19 ...' fill='%23e03f1b' /%3E%3Cpath d='M50,153 L52,145 L55,148 L60,141 ...' fill='%23e03f1b' /%3E%3C!-- 중앙 지역 자유로운 리얼 일러스트 장물들 --%3E%3Cg transform='translate(15, 30)'%3E...%3C/g%3E%3C/svg%3E");
  
  /* 마법의 자연 풍향 2선식 복합 애니메이션 구현 */
  animation: mytheme-drift 8.5s linear infinite;
  mix-blend-mode: screen;
}

/* [최고급 품질의 정수] 단순 이동이 아닌, 복합 물리 변환(translation + rotation)으로 산들산들 낙하하는 낙엽/꽃잎 기류 재현 */
@keyframes mytheme-drift {
  0% {
    background-position-y: 0px;
    transform: translateX(-4px) rotate(0deg);
  }
  50% {
    /* 낙하 중간점에 수평 관성 흔들림과 미세 공용 회전각을 기여 */
    transform: translateX(4px) rotate(1deg);
  }
  100% {
    /* 타일링 주기인 160px에 정확히 끝점을 수렴시켜 무단절 연결 보장 */
    background-position-y: 160px;
    transform: translateX(-4px) rotate(0deg);
  }
}
```
- **상향 표류 (불씨·수중 기포)**: 피어오르는 효과는 이동 방향을 반대로 주어 `0% { background-position-y: 160px; } 100% { background-position-y: 0px; }` 처럼 위로 올리면서, `skewX(-0.5deg) -> skewX(0.5deg)` 와 같이 뜨거운 열풍 전단 진동을 가입하면 환상적입니다.
- **경계 보호(Over-scan/Inset 오프셋)**: `translateX`나 `rotate` 변환을 실행하면 레이어 외각 모서리가 안쪽으로 침범되어 빈 구석이 노출됩니다. 이를 극복하기 위해 반드시 **`inset: -15px` 이상**을 부여하여 여유 프레임을 사전에 확보하세요.

### 5.3 3D 입체감 있는 파티클 & 소품의 다차원 물리 애니메이션 설계 (3D Stereoscopic Animation System)
단순한 2D 평면 `translateX`와 `Y`는 눈이 쉽게 모션의 패턴을 인식하여 단조롭게 보입니다. 파티클이나 소품이 3D 공간을 유영하는 것처럼 느끼게 만들기 위해서는 변환 함수(`transform`)에 입체 오프셋과 원근 축을 통합해야 합니다:

1. **`perspective()`와 3D 축 회전**: `transform: perspective(400px) rotateX(...) rotateY(...)`를 사용해 평면 벡터 이미지에 3D 기울임(Tilt)을 주면, 입자들이 화면 뒤로 넘어갔다 앞으로 다가오는 듯한 입체 궤적을 그립니다.
2. **다차원 바람 저항 (3-Way Pitch/Roll/Yaw)**: 나뭇잎, 벚꽃잎, 눈꽃송이 등 비정형 소품들은 하강 시 3D 공간 상에서 앞뒷면을 미세하게 뒤집어야 생동감이 극대화됩니다. `rotate3d(x, y, z, deg)` 혹은 `rotateX()`와 `rotateY()`를 독립적으로 교차 진동시켜 입체 나풀거림(3D Fluttering)을 더하세요.
3. **가속 및 감속 물리 (Natural Ease)**: 선형적인 `linear` 스크롤뿐만 아니라, `cubic-bezier(0.445, 0.05, 0.55, 0.95)` 등 감속 곡선을 활용한 흔들림이나 다중 입자 레이어의 원근 격차(Parallax Depth)를 연동하면 마치 카메라 렌즈 안에 깊이가 생긴 듯한 가상 3D 공간이 탄생합니다.

> 🔍 **[검증 절차] 3D 자연스러움과 배율 체크**
> 작성된 3D 궤적 애니메이션이 꺾이는 반환점에서 움직임이 딱딱하게 덜컥거리지 않는지 브라우저에서 반드시 여러 차례 검증하세요. `ease-in-out` 또는 부드러운 cubic-bezier 가속도를 활용하고, **64px 논리 폭 대비 실제 카드 크기가 2×~4×인 환경**에서도 파티클 모션이 튀어나오거나 이음매가 끊기지 않는지 교차 테스트해야 합니다.


```css
/* 3D 원근감을 입힌 단풍잎 전경의 입체 궤적 예시 */
@keyframes mytheme-drift-3d {
  0% {
    background-position-y: 0px;
    transform: perspective(500px) rotateX(4deg) rotateY(-4deg) translateX(-4px) translateZ(0px);
  }
  50% {
    /* 하강 중간점: 3D 면회전을 가입하여 나풀거림과 공간 깊이를 표현 (앞으로 돌출했다가 들어가는 효과) */
    transform: perspective(500px) rotateX(-5deg) rotateY(15deg) translateX(4px) translateZ(8px);
  }
  100% {
    background-position-y: 160px;
    transform: perspective(500px) rotateX(4deg) rotateY(-4deg) translateX(-4px) translateZ(0px);
  }
}
```

### 5.4 회전 (기어·룬)
```css
.cb-mytheme::before {
  content: ""; position: absolute; right: -8px; bottom: -8px; width: 34px; height: 34px;
  background: no-repeat center / contain url("data:image/svg+xml,...기어...");
  transform-origin: 50% 50%;
  animation: mytheme-spin 9s linear infinite;
}
@keyframes mytheme-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); } /* 0deg와 시각적으로 동일한 폐쇄 종점 */
}
```

### 5.5 색상 순환 / 홀로그램
```css
.cb-mytheme::before { animation: mytheme-hue 8s linear infinite; }
@keyframes mytheme-hue {
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(360deg); } /* 0deg와 시각적으로 동일한 폐쇄 종점 */
}
```

### 5.6 글로우 맥박
```css
.cb-mytheme { animation: mytheme-glow 2.4s ease-in-out infinite; }
@keyframes mytheme-glow { 0%,100% { opacity: .85; } 50% { opacity: 1; } }
```

### 5.7 SVG 내부 SMIL — 재질 자체가 움직이는 프리미엄 연출
CSS 애니메이션은 전체 레이어의 이동·원근·타일 순환을 담당하고, SVG 내부 SMIL은 **보석 면의 굴절, 금속 각인의 열광, 회로 노드, 유약 반사, 꽃잎·기어 같은 개별 조형**을 움직이는 데 사용합니다. 둘을 역할별로 나누면 프레임 전체가 한꺼번에 점멸하는 값싼 효과를 피하면서 훨씬 풍부한 움직임을 만들 수 있습니다.

```svg
<path d="M5 5H95V155H5Z" fill="none" stroke="#7ff9ff"
      stroke-width=".45" stroke-dasharray="2 7" opacity=".38">
  <animate attributeName="stroke-dashoffset"
           values="0;-18;0" keyTimes="0;.5;1"
           dur="8.4s" repeatCount="indefinite"/>
  <animate attributeName="opacity"
           values=".28;.82;.28" keyTimes="0;.5;1"
           calcMode="spline" keySplines=".45 .05 .55 .95;.45 .05 .55 .95"
           dur="5.7s" repeatCount="indefinite"/>
</path>
```

- 허용 요소는 기본적으로 `<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>`입니다. `<script>`, SVG 내부 `<style>`, 이벤트 핸들러(`onbegin` 등), 외부 URL·폰트·이미지는 사용하지 않습니다.
- 한 SVG에는 SMIL 타임라인을 **최대 8개**까지만 두고, 동일 속성을 수십 개 도형에 따로 걸기보다 상위 `<g>`나 대표 하이라이트 패스를 움직입니다.
- 반복 애니메이션은 `repeatCount="indefinite"`와 **동일한 첫값·끝값**을 사용합니다. 회전만 `0→360`처럼 시각적으로 동일한 종점을 허용합니다.
- 왕복 운동은 `keyTimes`와 `calcMode="spline"`/`keySplines`를 사용하고, 기본 주기는 **2.8초 이상**으로 잡아 급격한 점멸을 피합니다.
- 기존 `transform`이 있는 `<g>`/`<use>`에 `<animateTransform>`을 추가할 때는 `additive="sum"`으로 정적 배치가 사라지지 않게 합니다.
- 시그니처 모션은 실제 카드 2× 배율에서도 한 주기 안에 식별되어야 합니다. 대표 하이라이트는 밝기·불투명도 차이를 충분히 확보하고, 회전·굴절·파동은 해당 재질이 인지될 만큼의 진폭을 주되 전체 프레임을 동시에 번쩍이게 만들지는 않습니다. 최소 두 종류의 재질 모션을 서로 다른 주기로 엇갈리게 배치해 정지 화면처럼 보이는 구간을 줄입니다.
- SMIL을 제거해도 아름다운 **정적 base state**가 반드시 남아야 합니다. 런타임은 `prefers-reduced-motion: reduce`일 때 data SVG의 SMIL 요소를 제거해 다시 주입하고, 테마의 미디어 쿼리는 바깥 CSS 애니메이션을 함께 중지합니다.
- 카드 크기 자체에는 상한을 두지 않습니다. 대신 런타임은 화면에 보이는 서로 다른 SMIL 테마 중 **최대 3종·복잡도 가중 합산 가시 면적 90,000 CSS px²**만 동시에 재생합니다. 테마당 약 7개 SMIL 타임라인을 가중치 1로 보고, 그보다 정교한 테마는 타임라인 수에 비례해 예산을 더 사용하므로 밀집 화면에서는 가벼운 테마 3종 또는 고밀도 테마 1~2종이 자연스럽게 활성화됩니다. 예산 밖 테마와 화면에 보이는 인스턴스가 하나도 없는 테마는 SMIL을 제거한 정적 SVG로 다시 주입합니다. 같은 테마가 화면 안팎에 동시에 존재하면 공유 SVG는 유지하되 화면 밖 개별 프레임의 바깥 CSS를 정지하고 브라우저의 오프스크린 페인트 컬링을 활용합니다. 카드가 화면 중앙에 가까워지거나 hover/focus되면 즉시 우선권을 넘깁니다. **화면에 한 장만 보이는 큰 카드**는 면적이 예산을 넘어도 최소 1종을 재생하므로 상세 화면과 임의의 확대 배율에는 크기 제한이 생기지 않습니다. 반대로 동일 테마가 여러 장 보이면 그 면적을 합산하고 단일 카드 예외를 적용하지 않아, 반복 인스턴스가 예산을 우회하지 못하게 합니다.
- 전체 프레임의 불투명도를 빠르게 깜빡이거나 중앙을 가로지르는 대형 발광은 금지합니다. 움직임은 테두리·코너·장식물에 집중합니다.

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
- [ ] SVG 내부 SMIL도 정적 base state가 완성되어 있고 감소 모션 런타임에서 제거되는가
- [ ] SVG당 SMIL 8개 이하, 주기 2.8초 이상, 첫값·끝값 동일 규칙을 지켰는가
- [ ] 2× 카드에서 시그니처 모션이 명확히 보이면서도 프레임 전체가 한꺼번에 점멸하지 않는가
- [ ] 모든 CSS `@keyframes`의 0%·100%가 동일하거나 정확한 160px 타일/360° 등가 종점인가
- [ ] SVG에 `<script>`·내부 `<style>`·이벤트 핸들러·외부 리소스가 없는가
- [ ] 밀집 목록에서 동시 모션 예산 전환 후에도 정적 상태가 완성도 있게 보이고, hover/focus 카드가 자연스럽게 활성화되는가
- [ ] 클래스명·`@keyframes` 이름에 **고유 접두어**를 붙였는가
- [ ] 한 화면에 10장 떠도 과하지 않은 **밝기/채도**인가
- [ ] 글자(이름/시세) 가독성을 해치지 않는가(테두리는 가장자리에)
- [ ] 단순 1차원적인 좌→우 슬라이드 광택 셔머를 피하고 깊이 있는 공간감을 살렸는가
- [ ] 파티클은 `circle` 등 정체불명의 투박한 형상이 아닌, 디테일이 살아있는 고품질 SVG와 다중 그라데이션으로 구현되었는가
- [ ] 대형 파티클이 `scale(0.4)` 이하의 규격을 만족하여 카드 중요 정보를 가리지 않는가
- [ ] 3D 반환점 감속 곡선 및 64px 논리 폭 대비 카드 크기 2×~4× 환경에서의 동작을 여러 번 검증했는가

프로젝트 예시 13종은 다음 명령으로 PostCSS 파싱, data SVG 안전성, 정적 렌더, SMIL 개수·주기·무단절 종점과 CSS keyframe의 폐쇄 종점을 한 번에 검사할 수 있습니다.

```bash
node scripts/validate-card-border-smil.mjs
```


---

## 8. 등록 방법 (사이트에서)
1. `card-borders/` 폴더의 예시 파일을 열어 CSS를 복사하거나, 위 가이드대로 새로 작성합니다.
2. 관리자 → **상점 관리** → 종류 **테두리** 선택.
3. **적용 클래스명**(예: `cb-mydragon`)과 **CSS 코드**를 붙여넣습니다. 미리보기로 즉시 확인됩니다.
4. 이름·가격·활성화 설정 후 **추가**. 유저가 상점에서 구매해 카드에 장착할 수 있습니다.

> 별도 빌드·배포 없이, 입력한 CSS가 그대로 사이트에 주입되어 적용됩니다.
>
> **파일 크기 정책:** CSS나 그 안의 상세 SVG 문자열만을 별도로 잘라내는 인위적 파일 크기 제한은 두지 않습니다. 관리자 상점 상품 등록·수정 요청의 전송 한도는 `ADMIN_SHOP_ITEM_BODY_SIZE_LIMIT`이며 기본값은 `50mb`이고 환경 변수로 조정할 수 있습니다. 일반 API의 `API_BODY_SIZE_LIMIT` 기본값은 보안을 위해 `2mb`로 유지합니다. MySQL의 `shop_items.style_json`은 `LONGTEXT`로 생성되며 기존 `TEXT`/`MEDIUMTEXT` 컬럼도 서버 시작 마이그레이션에서 `LONGTEXT`로 확장됩니다. 관리자 전용 한도에 걸리면 작품의 SVG 디테일을 축약하기보다 서버 환경의 전송 한도와, 필요하면 MySQL `max_allowed_packet`을 함께 조정하세요.

---

## 9. 예시 라이브러리
완성형 예시는 프로젝트 루트 **`card-borders/`** 폴더에 테마별로 들어 있습니다. 각 파일은 **그 파일 하나만으로 완성**됩니다.

| 파일 | 테마 | 핵심 연출 |
|---|---|---|
| `abyssal-reliquary.css` | 심연의 성물함 | 흑진주·산화 은 + 앵무조개·화석 산호 + 생물발광 상승 |
| `autumn.css` | 동판 식물표본 | 산화 동판 + 압인 표본 + 단풍·참나무 잎·도토리 |
| `beach.css` | 여름 해변 | 코너 태양·야자수·갈매기 + 깊이가 다른 3겹 파도 |
| `cheese-fondue.css` | 크리미 치즈 퐁듀 | 시그니처 옐로우 + 에멘탈 조형 + 소형 3D 치즈 파티클 |
| `cyberpunk.css` | 사이버펑크 야간 PCB | 흑연 회로판 + 비대칭 신호 노드 + 3D 회로 룬 패킷 |
| `galaxy.css` | 갤럭시 아스트랄 오러리 | 다중 금속·성운 + 고리 행성·별자리 + 3D 별밭 |
| `ginkgo-lacquer-wind.css` | 은행 옻칠 바람 | 흑적색 옻칠 + 금박 은행잎 + 전·후경 무단절 낙엽 |
| `goryeo-celadon.css` | 고려청자 상감 | 비취·회청 유약 + 백흑 상감 당초·연화 + 학·구름과 미세 빙렬 |
| `hanok-yeonhwa-border-wind.optimized.css` | 한옥 연화 바람 | 한옥 처마·창살 + 연화·노리개 + 무단절 바람 흔들림 |
| `heart-pop.css` | 하트 팝 | 핑크·로즈 이중 프레임 + 상승 하트 + 코너 클러스터 바운스 |
| `medieval.css` | 흑철 문장갑 | 산화 강철 + 심홍·남청 에나멜 문장 + 팔각 리벳·체인메일 |
| `oriental.css` | 묵빛 금동 장석 | 먹빛 고가구 + 금동 경첩 + 운문·당초 음각·녹청 |
| `prism.css` | 분광 광학 실험기 | 티타늄 계측 레일 + 렌즈 셀 + 분광 결정·국소 색수차 |
| `royal.css` | 백금 왕실 성물 | 백금·샴페인 골드 + 실크 자수 + 왕관·정교한 컷 젬 |
| `sakura.css` | 칠기 비단 겹벚꽃 | 흑자주 칠기 + 자개 비단선 + 수묵 가지·무단절 겹꽃잎 |
| `snow.css` | 빙하 결정학 | 프로스트 은세공 + 육각 격자 + 정교한 가지형 눈 결정 |
| `stained-glass-nocturne.css` | 스테인드 글라스 녹턴 | 산화 은빛 납선 + 비대칭 장미창 + 가장자리 굴절광 |
| `steampunk.css` | 스팀펑크 | 황동 배관 프레임 + 3단 회전 기어 + 입체 분출 증기 |
| `volcano.css` | 흑요석 화산 성소 | 현무암 절리 + 용암 유리·균열광 + 정교한 불씨 상승 |

이 예시들을 **출발점**으로 삼되, 항상 한 단계 더 — **이미지 카드 스킨에 견줄 만한 완성도**를 목표로 다듬어 주세요. ✨
