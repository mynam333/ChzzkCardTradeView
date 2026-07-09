# 아레나 이름 플레어 제작 가이드

## 목적

이름 플레어는 카드명 또는 플레이어명이 더 고급스럽게 보이도록 텍스트에만 적용하는 치장 아이템이다.

## 제작 지시

- 이미지 없이 CSS 텍스트 효과로 구현한다.
- 글자 판독성을 최우선으로 유지한다.
- 배경 클리핑 그라데이션, 글로우, 얇은 샤인 스윕을 사용한다.
- 글자가 흔들리거나 위치가 변하는 애니메이션은 사용하지 않는다.
- 한국어 완성형 글자에서 깨지지 않는 폰트와 fallback을 고려한다.

## 권장 CSS 구조

```json
{
  "class": "arena-name-aurora-script",
  "css": ".arena-name-aurora-script{background:linear-gradient(90deg,#22d3ee,#f472b6,#a7f3d0,#22d3ee);background-size:260% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 0 18px rgba(244,114,182,.28);animation:arena-name-aurora 2.4s linear infinite}@keyframes arena-name-aurora{to{background-position:260% 0}}"
}
```

## 품질 기준

- 12px 이하 작은 UI에서도 읽혀야 한다.
- 이름 길이가 길어도 줄바꿈/말줄임 레이아웃을 깨지 않아야 한다.
- 텍스트 그림자는 2겹 이하로 제한한다.
- 색상 대비는 WCAG AA에 준하는 수준을 목표로 한다.
