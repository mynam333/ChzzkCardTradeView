import React from 'react';
import { API_BASE_URL } from './api';

/**
 * 외부/교차 출처 이미지를 백엔드 프록시(동일 출처 + CORS 허용)로 우회시킵니다.
 * 프로필 카드 캡처(html-to-image) 시 캔버스 오염 및 표시 깨짐을 방지합니다.
 * data:/blob: URL이나 빈 값은 그대로 둡니다.
 */
export const proxiedImage = (url?: string | null): string => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${API_BASE_URL}/image-proxy?url=${encodeURIComponent(url)}`;
};

/** shop_items.style_json(JSON 문자열)을 React 인라인 스타일 객체로 파싱 */
export const parseStyle = (json?: string | null): React.CSSProperties => {
  if (!json) return {};
  try {
    return JSON.parse(json) as React.CSSProperties;
  } catch {
    return {};
  }
};

const loadedFonts = new Set<string>();

/** 이름 이펙트용 웹폰트를 1회만 <link>로 주입 */
export const ensureFont = (url?: string | null) => {
  if (!url || typeof document === 'undefined' || loadedFonts.has(url)) return;
  loadedFonts.add(url);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
};

/** 이름 이펙트 객체로부터 적용할 스타일(폰트 포함) 생성 — 레거시 인라인 방식 */
export const nameEffectStyle = (effect?: { style_json?: string | null; font_url?: string | null; font_family?: string | null } | null): React.CSSProperties => {
  if (!effect) return {};
  ensureFont(effect.font_url);
  const style = parseStyle(effect.style_json);
  if (effect.font_family) style.fontFamily = effect.font_family;
  return style;
};

/**
 * 이름 이펙트(클래스 기반) 식별: style_json 에 {"class":"ne-xxx"} 가 있으면 클래스명을 반환합니다.
 * 실제 비주얼 CSS는 함께 저장된 {"css":...}가 ensureCosmeticCss로 주입됩니다.
 * (테두리의 borderClass 와 동일한 규칙 — 텍스트 요소에 적용)
 */
export const nameEffectClass = (effect?: { style_json?: string | null } | null): string => borderClass(effect);

/**
 * 카드 별(0~5성)에 맞는 커스텀 이미지를 해석합니다.
 * 해당 성에 등록된 이미지가 없으면 더 낮은 성의 등록 이미지로 폴백하고,
 * 그래도 없으면 기본 치지직 프로필(logo_url)을 사용합니다.
 */
export const cardImage = (
  streamer?: { custom_images?: (string | null)[] | null; custom_image_url?: string | null; logo_url?: string | null } | null,
  star: number = 0
): string => {
  if (!streamer) return '';
  const imgs = streamer.custom_images && streamer.custom_images.length
    ? streamer.custom_images
    : [streamer.custom_image_url ?? null];
  const s = Math.max(0, Math.min(5, Math.floor(star || 0)));
  for (let j = s; j >= 0; j--) {
    if (imgs[j]) return imgs[j] as string;
  }
  return streamer.logo_url || '';
};

/** 테두리 코스메틱 스타일 (레거시 인라인 JSON 방식) */
export const borderStyle = (border?: { style_json?: string | null } | null): React.CSSProperties => {
  if (!border) return {};
  return parseStyle(border.style_json);
};

/**
 * 프리미엄 테두리(클래스 기반) 식별:
 * style_json 에 {"class":"cb-xxx"} 가 있으면 해당 클래스명을 반환합니다.
 * 실제 비주얼 CSS는 함께 저장된 {"css":...}가 ensureBorderCss로 주입됩니다.
 * (예시 라이브러리: 프로젝트 루트 card-borders/*.css)
 */
export const borderClass = (border?: { style_json?: string | null } | null): string => {
  if (!border?.style_json) return '';
  try {
    const obj = JSON.parse(border.style_json);
    return typeof obj?.class === 'string' ? obj.class.trim() : '';
  } catch {
    return '';
  }
};

// 커스텀 테두리 CSS를 클래스 단위로 1회 주입(또는 변경 시 갱신)
const injectedBorderCss = new Map<string, HTMLStyleElement>();

/**
 * 코스메틱(테두리·이름 이펙트)이 style_json에 {"class":..,"css":..} 형태로 원본 CSS를 담고 있으면,
 * 해당 CSS를 <style data-cb-css="class"> 태그로 문서에 주입합니다(클래스 단위 dedupe·갱신).
 * 입력된 CSS가 그대로 적용되며, css 없이 class만 있으면 아무것도 주입하지 않습니다.
 */
export const ensureCosmeticCss = (cosmetic?: { style_json?: string | null } | null): void => {
  if (typeof document === 'undefined' || !cosmetic?.style_json) return;
  let obj: any;
  try { obj = JSON.parse(cosmetic.style_json); } catch { return; }
  if (!obj || typeof obj.class !== 'string' || typeof obj.css !== 'string' || !obj.css.trim()) return;
  const key = obj.class.trim();
  let el = injectedBorderCss.get(key);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('data-cb-css', key);
    document.head.appendChild(el);
    injectedBorderCss.set(key, el);
  }
  if (el.textContent !== obj.css) el.textContent = obj.css;
};
/** 하위 호환 별칭 */
export const ensureBorderCss = ensureCosmeticCss;

// (테두리 프리셋 목록은 제거됨 — 이제 관리자가 card-borders/*.css 의 CSS를 직접 입력해 등록합니다)
