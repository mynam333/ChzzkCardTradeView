# 아레나 카드 프레임 스킨 제작 가이드

## 목적

카드 프레임 스킨은 카드 전투력과 무관하게 카드 외곽, 광택, 희귀도 감각을 바꾸는 프리미엄 치장 아이템이다.

## 제작 지시

- 이미지 에셋 없이 CSS만으로 구현한다.
- 카드 이름, 클래스, 공격력, 체력, 효과 키워드를 가리지 않는다.
- 카드 이미지 영역은 어둡게 덮지 않는다.
- 외곽 테두리, 내부 광택, 사선 샤인, 짧은 펄스 애니메이션으로 차이를 만든다.
- 애니메이션은 2~4초 루프로 만들고, 시선이 과하게 흔들리지 않게 한다.

## 권장 CSS 구조

```json
{
  "class": "arena-frame-prism-core",
  "css": ".arena-frame-prism-core{--frame-a:#67e8f9;--frame-b:#fb7185;--frame-c:#facc15;box-shadow:0 0 0 2px var(--frame-c),0 0 28px color-mix(in srgb,var(--frame-b) 55%,transparent)}.arena-frame-prism-core::after{content:\"\";position:absolute;inset:-20%;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.55) 48%,transparent 58%);animation:arena-frame-sweep 3s ease-in-out infinite}@keyframes arena-frame-sweep{0%,100%{transform:translateX(-45%)}50%{transform:translateX(45%)}}"
}
```

## 품질 기준

- 카드 축소 상태에서도 구매 전후 차이가 보여야 한다.
- 전투 화면에서 6장 이상 동시에 떠도 과하게 번쩍이지 않아야 한다.
- 라이트/다크 모드 모두에서 외곽선이 보여야 한다.
- `transform`, `opacity`, `filter` 중심으로 애니메이션을 구성한다.
