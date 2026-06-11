import React from 'react';
import { API_BASE_URL } from './api';

/**
 * 외부/교차 출처 이미지를 백엔드 프록시(동일 출처 + CORS 허용)로 우회시킵니다.
 * 프로필 카드 캡처(html-to-image) 시 캔버스 오염 및 표시 깨짐을 방지합니다.
 * data:/blob: URL이나 빈 값은 그대로 둡니다.
 */
export const proxiedImage = (
  url?: string | null,
  options: { width?: number; quality?: number } = {}
): string => {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  const shouldResize = !!options.width;
  if (!shouldResize && (url.startsWith('/uploads/') || url.startsWith('uploads/'))) return url.startsWith('/') ? url : `/${url}`;
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : API_BASE_URL;
    const parsed = new URL(url, baseOrigin);
    const apiBase = new URL(API_BASE_URL, baseOrigin);
    if (!shouldResize && parsed.pathname.startsWith('/uploads/') && parsed.origin === apiBase.origin) {
      return parsed.toString();
    }
  } catch {
    // URL 파싱 실패 시 기존 프록시 경로로 폴백합니다.
  }
  const params = new URLSearchParams({ url });
  if (options.width && Number.isFinite(options.width)) {
    params.set('w', String(Math.max(16, Math.floor(options.width))));
  }
  if (options.quality && Number.isFinite(options.quality)) {
    params.set('q', String(Math.max(45, Math.min(92, Math.floor(options.quality)))));
  }
  return `${API_BASE_URL}/image-proxy?${params.toString()}`;
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
const FONT_FILE_PATTERN = /\.(?:woff2?|ttf|otf)(?:[?#].*)?$/i;

const cssString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ');

const fontFormat = (url: string): string => {
  const pathname = url.split(/[?#]/, 1)[0].toLowerCase();
  if (pathname.endsWith('.woff2')) return 'woff2';
  if (pathname.endsWith('.woff')) return 'woff';
  if (pathname.endsWith('.ttf')) return 'truetype';
  return 'opentype';
};

/**
 * 이름 이펙트용 웹폰트를 1회만 주입합니다.
 * - CSS URL(Google Fonts 등): <link rel="stylesheet">
 * - 폰트 파일 URL(.woff2/.woff/.ttf/.otf): font_family 이름으로 @font-face 생성
 */
export const ensureFont = (url?: string | null, family?: string | null) => {
  const normalizedUrl = url?.trim();
  if (!normalizedUrl || typeof document === 'undefined') return;

  const normalizedFamily = family?.trim();
  const isFontFile = FONT_FILE_PATTERN.test(normalizedUrl);
  const key = `${isFontFile ? 'file' : 'css'}:${normalizedUrl}:${normalizedFamily || ''}`;
  if (loadedFonts.has(key)) return;

  if (isFontFile) {
    if (!normalizedFamily) return;
    const style = document.createElement('style');
    style.setAttribute('data-name-effect-font', normalizedFamily);
    style.textContent = `@font-face{font-family:"${cssString(normalizedFamily)}";src:url("${cssString(normalizedUrl)}") format("${fontFormat(normalizedUrl)}");font-display:swap;}`;
    document.head.appendChild(style);
  } else {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = normalizedUrl;
    document.head.appendChild(link);
  }

  loadedFonts.add(key);
};

/** 이름 이펙트 객체로부터 적용할 폰트 스타일 생성 */
export const nameEffectFontStyle = (
  effect?: { font_family?: string | null } | null
): React.CSSProperties => {
  const family = effect?.font_family?.trim();
  return family ? { fontFamily: family } : {};
};

/** 이름 이펙트 객체로부터 적용할 스타일(폰트 포함) 생성 - 레거시 인라인 방식 */
export const nameEffectStyle = (effect?: { style_json?: string | null; font_url?: string | null; font_family?: string | null } | null): React.CSSProperties => {
  if (!effect) return {};
  const style = parseStyle(effect.style_json);
  return { ...style, ...nameEffectFontStyle(effect) };
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
  let targetUrl = '';
  for (let j = s; j >= 0; j--) {
    if (imgs[j]) {
      targetUrl = imgs[j] as string;
      break;
    }
  }
  if (!targetUrl) {
    targetUrl = streamer.logo_url || '';
  }
  return targetUrl;
};

/**
 * 스트리머 프로필/아바타 아이콘은 카드 커스텀 이미지와 분리해
 * 항상 치지직 기본 프로필(logo_url)을 사용합니다.
 */
export const streamerProfileImage = (
  streamer?: { logo_url?: string | null } | null,
  fallback: string = '/icon.png'
): string => streamer?.logo_url || fallback;

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

/**
 * CSS 안의 인라인 SVG 데이터 URI를 브라우저가 처리할 수 있도록 정규화합니다.
 * - url("data:image/svg+xml,...") / url('...') 의 SVG 페이로드만 대상으로,
 *   CSS·URL 파서를 깨뜨리는 문자( `<` `>` `#` , 줄바꿈/탭 )를 퍼센트 인코딩/공백 치환합니다.
 * - 이미 인코딩된 SVG(`%3C` 등)는 변화가 없습니다(멱등). base64 데이터 URI는 건드리지 않습니다.
 * 이렇게 하면 관리자가 인코딩을 일부 빠뜨린 SVG를 붙여넣어도 브라우저처럼 정상 렌더됩니다.
 */
export const normalizeSvgInCss = (css: string): string => {
  if (!css || css.indexOf('data:image/svg+xml,') === -1) return css;
  // url( <quote> data:image/svg+xml, <payload> <same quote> )  — base64(;base64,)는 매칭되지 않음
  return css.replace(
    /(url\(\s*)(['"])(data:image\/svg\+xml,)([\s\S]*?)\2(\s*\))/gi,
    (_m, pre: string, quote: string, prefix: string, payload: string, post: string) => {
      const fixed = payload
        .replace(/[\r\n\t]+/g, ' ') // 줄바꿈/탭 → 공백 (CSS 문자열 파싱 보호)
        .replace(/</g, '%3C')
        .replace(/>/g, '%3E')
        .replace(/#/g, '%23');      // 색상 #fff, 참조 url(#id) 등 — 이미 %23이면 변화 없음
      return `${pre}${quote}${prefix}${fixed}${quote}${post}`;
    }
  );
};

// 커스텀 코스메틱 CSS를 클래스 단위로 1회 주입(또는 변경 시 갱신)
const injectedBorderCss = new Map<string, HTMLStyleElement>();

/**
 * 코스메틱(테두리·이름 이펙트)이 style_json에 {"class":..,"css":..} 형태로 원본 CSS를 담고 있으면,
 * 해당 CSS를 <style data-cb-css="class"> 태그로 문서에 주입합니다(클래스 단위 dedupe·갱신).
 * 주입 직전 SVG 데이터 URI를 정규화하여 인코딩 누락(`#`·`<`·`>`·줄바꿈)도 브라우저처럼 처리합니다.
 * css 없이 class만 있으면 아무것도 주입하지 않습니다.
 */
export const ensureCosmeticCss = (cosmetic?: { style_json?: string | null } | null): void => {
  if (typeof document === 'undefined' || !cosmetic?.style_json) return;
  let obj: any;
  try { obj = JSON.parse(cosmetic.style_json); } catch { return; }
  if (!obj || typeof obj.class !== 'string') return;
  const key = obj.class.trim();
  if (typeof obj.css !== 'string' || !obj.css.trim()) {
    const stale = injectedBorderCss.get(key);
    if (stale) {
      stale.remove();
      injectedBorderCss.delete(key);
    }
    return;
  }
  let cssText = normalizeSvgInCss(obj.css);
  if (obj.fallback_ks_active && typeof obj.fallback_ks_css === 'string' && obj.fallback_ks_css.trim()) {
    const fontNameMatch = obj.fallback_ks_css.match(/font-family\s*:\s*['"]([^'"]+)['"]/);
    const fallbackFontName = fontNameMatch ? fontNameMatch[1] : 'GMarketSans';
    cssText += `\n${obj.fallback_ks_css}\n.${key} .ne-fallback-char { font-family: "${fallbackFontName}" !important; }`;
  }
  let el = injectedBorderCss.get(key);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('data-cb-css', key);
    document.head.appendChild(el);
    injectedBorderCss.set(key, el);
  }
  if (el.textContent !== cssText) el.textContent = cssText;
};
/** 하위 호환 별칭 */
export const ensureBorderCss = ensureCosmeticCss;

// (테두리 프리셋 목록은 제거됨 — 이제 관리자가 card-borders/*.css 의 CSS를 직접 입력해 등록합니다)
