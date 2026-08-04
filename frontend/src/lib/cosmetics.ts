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
  const minigameImagePrefix = 'minigame-image:v1:';
  if (url.startsWith(minigameImagePrefix)) {
    const token = url.slice(minigameImagePrefix.length);
    return token
      ? `${API_BASE_URL}/image-proxy/minigame?mg=${encodeURIComponent(token)}`
      : '';
  }
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
const SVG_DATA_URI_CSS = /(url\(\s*)(['"])(data:image\/svg\+xml,)([\s\S]*?)\2(\s*\))/gi;

export const normalizeSvgInCss = (css: string): string => {
  if (!css || css.indexOf('data:image/svg+xml,') === -1) return css;
  // url( <quote> data:image/svg+xml, <payload> <same quote> )  — base64(;base64,)는 매칭되지 않음
  return css.replace(
    SVG_DATA_URI_CSS,
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

const SVG_SMIL_TAG = 'animate(?:Color|Motion|Transform)?|set';
const SVG_ENCODED_OR_LITERAL_SLASH = '(?:%2F|\\/)';
const SVG_SMIL_START = new RegExp(`%3C(?:${SVG_SMIL_TAG})\\b`, 'i');
const SVG_SMIL_RAW_OR_ENCODED_START = new RegExp(`(?:<|%3C)(?:${SVG_SMIL_TAG})\\b`, 'i');
const SVG_ENCODED_TAG_CONTENT = '(?:(?!%3E)[\\s\\S])*?';
const SVG_SMIL_PAIRED = new RegExp(
  `%3C(${SVG_SMIL_TAG})\\b${SVG_ENCODED_TAG_CONTENT}%3E[\\s\\S]*?%3C${SVG_ENCODED_OR_LITERAL_SLASH}\\1(?:\\s|%20)*%3E`,
  'gi'
);
const SVG_SMIL_SELF_CLOSING = new RegExp(
  `%3C(?:${SVG_SMIL_TAG})\\b${SVG_ENCODED_TAG_CONTENT}${SVG_ENCODED_OR_LITERAL_SLASH}%3E`,
  'gi'
);

/**
 * 감소 모션 환경에서는 CSS data SVG 안의 SMIL 타임라인만 제거합니다.
 * 정적 SVG 도형과 CSS 애니메이션 규칙은 유지되며, 후자는 각 테마의
 * prefers-reduced-motion 규칙에서 별도로 중지됩니다.
 */
export const stripSvgSmilAnimationsInCss = (css: string): string => {
  const normalized = normalizeSvgInCss(css);
  if (!normalized || !SVG_SMIL_START.test(normalized)) return normalized;

  return normalized.replace(
    SVG_DATA_URI_CSS,
    (_match, pre: string, quote: string, prefix: string, payload: string, post: string) => {
      const staticPayload = payload
        // 같은 태그의 <animate/>와 <animate>...</animate>가 섞여 있을 때
        // paired 정규식이 앞의 self-closing 태그부터 닫는 태그까지 삼키지 않도록 먼저 제거합니다.
        .replace(SVG_SMIL_SELF_CLOSING, '')
        .replace(SVG_SMIL_PAIRED, '');
      return `${pre}${quote}${prefix}${staticPayload}${quote}${post}`;
    }
  );
};

/**
 * 대형 카드에서는 세 SVG 가운데 테마를 가장 선명하게 설명하는 한 레이어만
 * 동적으로 유지합니다. 선택되지 않은 data SVG는 도형을 그대로 둔 채 SMIL만
 * 제거하므로 확대 품질과 정적 세공은 손실되지 않습니다.
 */
export const stripSvgSmilAnimationsExceptDataSvgIndexInCss = (
  css: string,
  dynamicSvgIndex: number
): string => {
  const normalized = normalizeSvgInCss(css);
  if (!normalized || !SVG_SMIL_START.test(normalized)) return normalized;

  let svgIndex = 0;
  return normalized.replace(
    SVG_DATA_URI_CSS,
    (_match, pre: string, quote: string, prefix: string, payload: string, post: string) => {
      const currentIndex = svgIndex;
      svgIndex += 1;
      if (currentIndex === dynamicSvgIndex) {
        return `${pre}${quote}${prefix}${payload}${quote}${post}`;
      }
      const staticPayload = payload
        .replace(SVG_SMIL_SELF_CLOSING, '')
        .replace(SVG_SMIL_PAIRED, '');
      return `${pre}${quote}${prefix}${staticPayload}${quote}${post}`;
    }
  );
};

const CSS_URL_TOKEN = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi;
const CSS_PX_LENGTH = /(-?\d*\.?\d+)px\b/g;

const withCssUrlsProtected = (css: string, transform: (protectedCss: string) => string): string => {
  const urls: string[] = [];
  const protectedCss = css.replace(CSS_URL_TOKEN, (value) => {
    const index = urls.push(value) - 1;
    return `__CHIKAPO_CSS_URL_${index}__`;
  });
  return transform(protectedCss).replace(/__CHIKAPO_CSS_URL_(\d+)__/g, (_match, index) => urls[Number(index)] ?? '');
};

/**
 * 카드 테두리 CSS는 기존 64px x 102.4px 좌표계로 작성되어 있습니다.
 * 프레임 자체를 transform scale로 키우면 3D hover 중 래스터 확대가 겹쳐 흐려질 수 있으므로,
 * px 길이값을 카드 폭 기준 컨테이너 단위로 바꿔 같은 비율을 직접 렌더링합니다.
 */
export const migrateFramePxToContainerUnits = (css: string): string => {
  if (!css || !css.includes('px')) return css;
  return withCssUrlsProtected(css, (protectedCss) =>
    protectedCss.replace(CSS_PX_LENGTH, (_match, rawNumber: string) => {
      const value = Number(rawNumber);
      if (!Number.isFinite(value) || value === 0) return '0';
      return `calc(var(--cosmetic-frame-unit) * ${Number(value.toFixed(4))})`;
    })
  );
};

type InjectedCosmeticCssSource = {
  key: string;
  css: string;
  isFrame: boolean;
  fallbackCss: string;
  hasSvgSmil: boolean;
  svgSmilMotionWeight: number;
  motionSelector: string;
};

type CosmeticSvgMotionCandidate = {
  key: string;
  engaged: boolean;
  distance: number;
  visibleArea: number;
  visibleInstances?: number;
  motionWeight?: number;
  order: number;
};

/**
 * SMIL data SVG는 개별 카드에서는 풍부하지만 서로 다른 자산을 한꺼번에
 * 많이 재생하면 페인트 비용이 급증합니다. 카드 크기는 제한하지 않고,
 * 현재 화면에서 동시에 움직이는 서로 다른 테마의 수와 면적만 예산화합니다.
 */
export const MAX_CONCURRENT_SVG_MOTION_THEMES = 3;
export const MAX_CONCURRENT_SVG_MOTION_AREA = 90_000;

/**
 * 이 면적부터 초대형 경계 전까지 바깥 CSS 루프를 멈추고, 세 SVG 중
 * 시그니처 한 장만 동적으로 유지합니다. 나머지는 정적 벡터 세공을 그대로
 * 보존해 크기를 제한하지 않으면서 대형 표면의 재페인트 비용을 줄입니다.
 * 4× 논리 카드(256 × 409.6 = 104,857.6px²)는 전체 모션 범위에 남깁니다.
 */
export const SVG_SMIL_ONLY_MIN_RENDER_AREA = 120_000;

/**
 * 512 × 819.2(약 419k)는 시그니처 SMIL 단계에 남기고, 768 × 1228.8
 * 같은 초대형 카드부터는 SVG를 정적으로 캐시한 채 바깥 CSS 루프만 재생합니다.
 */
export const SVG_CSS_ONLY_MIN_RENDER_AREA = 500_000;

/**
 * base / micro-detail / particle-projection 순서의 0-based SVG 인덱스입니다.
 * 각 테마의 대형 카드에서 가장 식별력 높은 시그니처 움직임 한 장만 남깁니다.
 */
const ADAPTIVE_DYNAMIC_SMIL_LAYER_BY_FRAME_KEY = new Map<string, number>([
  ['cb-autumn', 2],
  ['cb-sakura', 2],
  ['cb-snow', 2],
  ['cb-beach', 2],
  ['cb-cheese-fondue', 1],
  ['cb-ginkgo-lacquer-wind', 2],
  ['cb-goryeo-celadon', 2],
  ['cb-hanok-yeonhwa', 2],
  ['cb-heart-pop', 1],
  ['cb-cyberpunk', 2],
  ['cb-retro-8bit-arcade', 2],
  ['cb-galaxy', 0],
  ['cb-prism', 1],
  ['cb-volcano', 0],
  ['cb-abyssal-reliquary', 2],
  ['cb-medieval', 2],
  ['cb-oriental', 0],
  ['cb-royal', 0],
  ['cb-stained-glass-nocturne', 0],
  ['cb-steampunk', 0]
]);

export const selectActiveCosmeticSvgMotionKeys = (
  candidates: readonly CosmeticSvgMotionCandidate[],
  maxThemes: number = MAX_CONCURRENT_SVG_MOTION_THEMES,
  maxVisibleArea: number = MAX_CONCURRENT_SVG_MOTION_AREA
): Set<string> => {
  const sorted = [...candidates].sort((a, b) =>
    Number(b.engaged) - Number(a.engaged)
    || a.distance - b.distance
    || a.order - b.order
  );
  const active = new Set<string>();
  let usedArea = 0;
  const themeLimit = Math.max(1, Math.floor(maxThemes));
  const areaLimit = Math.max(1, maxVisibleArea);

  for (const candidate of sorted) {
    if (active.size >= themeLimit) break;
    const area = Math.max(0, Number.isFinite(candidate.visibleArea) ? candidate.visibleArea : 0);
    const motionWeight = candidate.motionWeight !== undefined && Number.isFinite(candidate.motionWeight)
      ? Math.max(1, candidate.motionWeight)
      : 1;
    const weightedArea = area * motionWeight;
    const visibleInstances = candidate.visibleInstances !== undefined && Number.isFinite(candidate.visibleInstances)
      ? Math.max(0, Math.floor(candidate.visibleInstances))
      : 1;
    // 카드 크기에는 상한을 두지 않되, 이 예외는 실제로 한 장만 보이는
    // 테마에만 허용합니다. 동일 테마 반복 카드의 합산 면적은 예산을 우회하지 않습니다.
    const canExceedAreaAsSingleCard = active.size === 0 && visibleInstances === 1;
    if (usedArea + weightedArea > areaLimit && !canExceedAreaAsSingleCard) continue;
    active.add(candidate.key);
    usedArea += weightedArea;
  }
  return active;
};

const cosmeticClassSelector = (key: string): string => {
  const escape = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape
    : (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  return key.split(/\s+/).filter(Boolean).map((token) => `.${escape(token)}`).join('');
};

// 커스텀 코스메틱 CSS를 클래스 단위로 1회 주입(또는 변경 시 갱신)
const injectedBorderCss = new Map<string, HTMLStyleElement>();
const injectedCosmeticCssSources = new Map<string, InjectedCosmeticCssSource>();
let reducedMotionMediaQuery: MediaQueryList | null = null;
let cosmeticMotionBudgetInitialized = false;
let cosmeticMotionBudgetFrame: number | null = null;
let cosmeticMotionBudgetLimitedKeys = new Set<string>();
let cosmeticMotionAdaptiveLodKeys = new Set<string>();
let cosmeticMotionCssOnlyKeys = new Set<string>();
let cosmeticMotionMutationObserver: MutationObserver | null = null;
let cosmeticMotionResizeObserver: ResizeObserver | null = null;
let cosmeticMotionIntersectionObserver: IntersectionObserver | null = null;
let observedCosmeticMotionElements = new Set<Element>();

const compileCosmeticCss = (source: InjectedCosmeticCssSource): string => {
  let cssText = normalizeSvgInCss(source.css);
  const prefersReducedMotion = !!reducedMotionMediaQuery?.matches;
  const exceedsMotionBudget = source.hasSvgSmil && cosmeticMotionBudgetLimitedKeys.has(source.key);
  const usesCssOnlyLod = source.hasSvgSmil && cosmeticMotionCssOnlyKeys.has(source.key);
  if (prefersReducedMotion || exceedsMotionBudget || usesCssOnlyLod) {
    cssText = stripSvgSmilAnimationsInCss(cssText);
  } else if (source.hasSvgSmil && cosmeticMotionAdaptiveLodKeys.has(source.key)) {
    const dynamicSvgIndex = ADAPTIVE_DYNAMIC_SMIL_LAYER_BY_FRAME_KEY.get(source.key);
    if (dynamicSvgIndex !== undefined) {
      cssText = stripSvgSmilAnimationsExceptDataSvgIndexInCss(cssText, dynamicSvgIndex);
    }
  }
  if (source.isFrame) {
    cssText = migrateFramePxToContainerUnits(cssText);
  }
  if (source.isFrame && (prefersReducedMotion || exceedsMotionBudget) && source.motionSelector) {
    cssText += `\n${source.motionSelector},${source.motionSelector}::before,${source.motionSelector}::after{animation-play-state:paused!important;}`;
  }
  if (
    source.isFrame
    && source.motionSelector
    && ADAPTIVE_DYNAMIC_SMIL_LAYER_BY_FRAME_KEY.has(source.key)
  ) {
    const smilOnlySelector = `${source.motionSelector}[data-cosmetic-motion-smil-only="true"]`;
    cssText += `\n${smilOnlySelector},${smilOnlySelector}::before,${smilOnlySelector}::after{animation:none!important;}`;
  }
  return source.fallbackCss ? `${cssText}\n${source.fallbackCss}` : cssText;
};

const syncInjectedCosmeticCss = (source: InjectedCosmeticCssSource): void => {
  const el = injectedBorderCss.get(source.key);
  if (!el) return;
  const cssText = compileCosmeticCss(source);
  if (el.textContent !== cssText) el.textContent = cssText;
};

const syncAllInjectedCosmeticCss = (): void => {
  for (const source of injectedCosmeticCssSources.values()) {
    syncInjectedCosmeticCss(source);
  }
};

const COSMETIC_MOTION_PAUSED_ATTRIBUTE = 'data-cosmetic-motion-paused';
const COSMETIC_MOTION_SMIL_ONLY_ATTRIBUTE = 'data-cosmetic-motion-smil-only';
const COSMETIC_MOTION_CSS_ONLY_ATTRIBUTE = 'data-cosmetic-motion-css-only';

const clearCosmeticMotionPausedAttributes = (key: string): void => {
  if (
    typeof document === 'undefined'
    || typeof document.getElementsByClassName !== 'function'
  ) return;
  for (const element of Array.from(document.getElementsByClassName(key))) {
    element.removeAttribute(COSMETIC_MOTION_PAUSED_ATTRIBUTE);
    element.removeAttribute(COSMETIC_MOTION_SMIL_ONLY_ATTRIBUTE);
    element.removeAttribute(COSMETIC_MOTION_CSS_ONLY_ATTRIBUTE);
  }
};

type VisibleCosmeticRect = {
  area: number;
  renderArea: number;
  centerX: number;
  centerY: number;
};

const visibleCosmeticRect = (element: Element): VisibleCosmeticRect | null => {
  if (typeof element.getBoundingClientRect !== 'function') return null;
  const visibilityAwareElement = element as Element & {
    checkVisibility?: (options?: {
      checkOpacity?: boolean;
      checkVisibilityCSS?: boolean;
      contentVisibilityAuto?: boolean;
    }) => boolean;
  };
  if (typeof visibilityAwareElement.checkVisibility === 'function') {
    try {
      if (!visibilityAwareElement.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        contentVisibilityAuto: true
      })) return null;
    } catch {
      // 구형 구현이 옵션 객체를 거부하면 아래의 계산 스타일 폴백을 사용합니다.
    }
  }

  const rect = element.getBoundingClientRect();
  let left = Math.max(rect.left, 0);
  let right = Math.min(rect.right, window.innerWidth);
  let top = Math.max(rect.top, 0);
  let bottom = Math.min(rect.bottom, window.innerHeight);
  if (right <= left || bottom <= top) return null;

  if (typeof window.getComputedStyle === 'function') {
    let current: Element | null = element;
    while (current) {
      const style = window.getComputedStyle(current);
      if (
        style.display === 'none'
        || style.visibility === 'hidden'
        || style.visibility === 'collapse'
        || style.contentVisibility === 'hidden'
        || Number.parseFloat(style.opacity || '1') <= 0.001
      ) return null;

      if (current !== element) {
        const clipsX = style.overflowX !== 'visible';
        const clipsY = style.overflowY !== 'visible';
        if (clipsX || clipsY) {
          const ancestorRect = current.getBoundingClientRect();
          if (clipsX) {
            left = Math.max(left, ancestorRect.left);
            right = Math.min(right, ancestorRect.right);
          }
          if (clipsY) {
            top = Math.max(top, ancestorRect.top);
            bottom = Math.min(bottom, ancestorRect.bottom);
          }
          if (right <= left || bottom <= top) return null;
        }
      }
      current = current.parentElement;
    }
  }

  return {
    area: (right - left) * (bottom - top),
    renderArea: Math.max(0, rect.width) * Math.max(0, rect.height),
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
};

type CosmeticMotionElements = {
  all: Element[];
  visible: Set<Element>;
  smilOnly: Set<Element>;
  cssOnly: Set<Element>;
};

const mutationTouchesCosmeticFrame = (node: Node): boolean => {
  if (!(node instanceof Element)) return false;
  if (node.matches('.cosmetic-frame') || node.querySelector('.cosmetic-frame')) return true;
  if (node.closest('.cosmetic-frame')) return true;
  return !!node.parentElement?.querySelector(':scope > .cosmetic-frame');
};

const cosmeticFrameMutationNeedsRefresh = (records: MutationRecord[]): boolean =>
  records.some((record) => {
    if (record.type === 'attributes') return mutationTouchesCosmeticFrame(record.target);
    return [...record.addedNodes, ...record.removedNodes].some(mutationTouchesCosmeticFrame);
  });

const syncObservedCosmeticMotionElements = (
  elementsByKey: ReadonlyMap<string, CosmeticMotionElements>
): void => {
  if (!cosmeticMotionIntersectionObserver && !cosmeticMotionResizeObserver) return;

  const nextObservedElements = new Set<Element>();
  for (const elements of elementsByKey.values()) {
    for (const element of elements.all) nextObservedElements.add(element);
  }

  for (const element of observedCosmeticMotionElements) {
    if (nextObservedElements.has(element)) continue;
    cosmeticMotionIntersectionObserver?.unobserve(element);
    cosmeticMotionResizeObserver?.unobserve(element);
  }
  for (const element of nextObservedElements) {
    if (observedCosmeticMotionElements.has(element)) continue;
    cosmeticMotionIntersectionObserver?.observe(element);
    cosmeticMotionResizeObserver?.observe(element);
  }
  observedCosmeticMotionElements = nextObservedElements;
};

const refreshCosmeticSvgMotionBudget = (): void => {
  if (
    typeof document === 'undefined'
    || typeof window === 'undefined'
    || typeof document.getElementsByClassName !== 'function'
  ) return;

  const candidates: CosmeticSvgMotionCandidate[] = [];
  const elementsByKey = new Map<string, CosmeticMotionElements>();
  const pageIsHidden = document.visibilityState === 'hidden';
  let order = 0;
  for (const source of injectedCosmeticCssSources.values()) {
    if (!source.isFrame || !source.hasSvgSmil) continue;
    let visibleArea = 0;
    let distance = Number.POSITIVE_INFINITY;
    let engaged = false;
    const elements = Array.from(document.getElementsByClassName(source.key));
    const visibleElements = new Set<Element>();
    const smilOnlyElements = new Set<Element>();
    const cssOnlyElements = new Set<Element>();
    elementsByKey.set(source.key, {
      all: elements,
      visible: visibleElements,
      smilOnly: smilOnlyElements,
      cssOnly: cssOnlyElements
    });
    if (pageIsHidden) {
      order += 1;
      continue;
    }
    for (const element of elements) {
      const visibleRect = visibleCosmeticRect(element);
      if (!visibleRect) continue;
      visibleElements.add(element);
      if (
        ADAPTIVE_DYNAMIC_SMIL_LAYER_BY_FRAME_KEY.has(source.key)
        && visibleRect.renderArea >= SVG_CSS_ONLY_MIN_RENDER_AREA
      ) {
        cssOnlyElements.add(element);
      } else if (
        ADAPTIVE_DYNAMIC_SMIL_LAYER_BY_FRAME_KEY.has(source.key)
        && visibleRect.renderArea >= SVG_SMIL_ONLY_MIN_RENDER_AREA
      ) {
        smilOnlyElements.add(element);
      }
      visibleArea += visibleRect.area;
      distance = Math.min(
        distance,
        Math.hypot(
          visibleRect.centerX - window.innerWidth / 2,
          visibleRect.centerY - window.innerHeight / 2
        )
      );
      const engagementTarget = element.parentElement ?? element;
      engaged ||= (
        typeof engagementTarget.matches === 'function'
        && engagementTarget.matches(':hover')
      ) || !!(
        document.activeElement
        && typeof engagementTarget.contains === 'function'
        && engagementTarget.contains(document.activeElement)
      );
    }
    if (visibleArea > 0) {
      candidates.push({
        key: source.key,
        engaged,
        distance,
        visibleArea,
        visibleInstances: visibleElements.size,
        motionWeight: source.svgSmilMotionWeight,
        order
      });
    }
    order += 1;
  }

  const activeKeys = pageIsHidden
    ? new Set<string>()
    : selectActiveCosmeticSvgMotionKeys(candidates);

  syncObservedCosmeticMotionElements(elementsByKey);

  for (const [key, elements] of elementsByKey) {
    // data SVG CSS는 key별로 한 style을 공유하므로, 같은 테마의 가시 인스턴스가
    // 서로 다른 크기라면 가장 높은 LOD를 그 key 전체에 일관되게 적용합니다.
    const usesCssOnlyTier = activeKeys.has(key) && elements.cssOnly.size > 0;
    const usesSmilOnlyTier = (
      activeKeys.has(key)
      && !usesCssOnlyTier
      && elements.smilOnly.size > 0
    );
    for (const element of elements.all) {
      const shouldPause = !activeKeys.has(key) || !elements.visible.has(element);
      if (shouldPause) {
        element.setAttribute(COSMETIC_MOTION_PAUSED_ATTRIBUTE, 'true');
      } else {
        element.removeAttribute(COSMETIC_MOTION_PAUSED_ATTRIBUTE);
      }
      if (!shouldPause && usesSmilOnlyTier) {
        element.setAttribute(COSMETIC_MOTION_SMIL_ONLY_ATTRIBUTE, 'true');
      } else {
        element.removeAttribute(COSMETIC_MOTION_SMIL_ONLY_ATTRIBUTE);
      }
      if (!shouldPause && usesCssOnlyTier) {
        element.setAttribute(COSMETIC_MOTION_CSS_ONLY_ATTRIBUTE, 'true');
      } else {
        element.removeAttribute(COSMETIC_MOTION_CSS_ONLY_ATTRIBUTE);
      }
    }
  }

  const nextLimitedKeys = new Set<string>();
  const nextAdaptiveLodKeys = new Set<string>();
  const nextCssOnlyKeys = new Set<string>();
  for (const source of injectedCosmeticCssSources.values()) {
    if (source.isFrame && source.hasSvgSmil && !activeKeys.has(source.key)) {
      nextLimitedKeys.add(source.key);
    }
    const elements = elementsByKey.get(source.key);
    if (
      source.isFrame
      && source.hasSvgSmil
      && activeKeys.has(source.key)
      && !elements?.cssOnly.size
      && !!elements?.smilOnly.size
    ) {
      nextAdaptiveLodKeys.add(source.key);
    } else if (
      source.isFrame
      && source.hasSvgSmil
      && activeKeys.has(source.key)
      && !!elements?.cssOnly.size
    ) {
      nextCssOnlyKeys.add(source.key);
    }
  }

  const previousLimitedKeys = cosmeticMotionBudgetLimitedKeys;
  const previousAdaptiveLodKeys = cosmeticMotionAdaptiveLodKeys;
  const previousCssOnlyKeys = cosmeticMotionCssOnlyKeys;
  const changedKeys = new Set(
    [
      ...previousLimitedKeys,
      ...nextLimitedKeys,
      ...previousAdaptiveLodKeys,
      ...nextAdaptiveLodKeys,
      ...previousCssOnlyKeys,
      ...nextCssOnlyKeys
    ].filter(
      (key) => (
        previousLimitedKeys.has(key) !== nextLimitedKeys.has(key)
        || previousAdaptiveLodKeys.has(key) !== nextAdaptiveLodKeys.has(key)
        || previousCssOnlyKeys.has(key) !== nextCssOnlyKeys.has(key)
      )
    )
  );
  cosmeticMotionBudgetLimitedKeys = nextLimitedKeys;
  cosmeticMotionAdaptiveLodKeys = nextAdaptiveLodKeys;
  cosmeticMotionCssOnlyKeys = nextCssOnlyKeys;
  for (const key of changedKeys) {
    const source = injectedCosmeticCssSources.get(key);
    if (source) syncInjectedCosmeticCss(source);
  }
};

const scheduleCosmeticSvgMotionBudgetRefresh = (): void => {
  if (typeof window === 'undefined') return;
  // 백그라운드 탭에서는 rAF가 장시간 정지할 수 있습니다. 새 테마가 이 상태에서
  // 등록되어도 동적 SVG가 한 프레임조차 남지 않도록 즉시 정적 버전으로 재컴파일합니다.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    if (cosmeticMotionBudgetFrame !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(cosmeticMotionBudgetFrame);
    }
    cosmeticMotionBudgetFrame = null;
    refreshCosmeticSvgMotionBudget();
    return;
  }
  if (typeof window.requestAnimationFrame !== 'function') {
    refreshCosmeticSvgMotionBudget();
    return;
  }
  if (cosmeticMotionBudgetFrame !== null) return;
  cosmeticMotionBudgetFrame = window.requestAnimationFrame(() => {
    cosmeticMotionBudgetFrame = null;
    refreshCosmeticSvgMotionBudget();
  });
};

const handleCosmeticVisibilityChange = (): void => {
  if (document.visibilityState === 'hidden') {
    if (cosmeticMotionBudgetFrame !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(cosmeticMotionBudgetFrame);
    }
    cosmeticMotionBudgetFrame = null;
    refreshCosmeticSvgMotionBudget();
    return;
  }
  scheduleCosmeticSvgMotionBudgetRefresh();
};

const ensureCosmeticSvgMotionBudgetObserver = (): void => {
  if (
    cosmeticMotionBudgetInitialized
    || typeof window === 'undefined'
    || typeof document === 'undefined'
    || typeof window.addEventListener !== 'function'
  ) return;
  cosmeticMotionBudgetInitialized = true;
  window.addEventListener('resize', scheduleCosmeticSvgMotionBudgetRefresh, { passive: true });
  window.addEventListener('scroll', scheduleCosmeticSvgMotionBudgetRefresh, { passive: true, capture: true });
  document.addEventListener('pointerover', scheduleCosmeticSvgMotionBudgetRefresh, true);
  document.addEventListener('pointerout', scheduleCosmeticSvgMotionBudgetRefresh, true);
  document.addEventListener('focusin', scheduleCosmeticSvgMotionBudgetRefresh, true);
  document.addEventListener('focusout', scheduleCosmeticSvgMotionBudgetRefresh, true);
  document.addEventListener('visibilitychange', handleCosmeticVisibilityChange);
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    cosmeticMotionMutationObserver = new MutationObserver((records) => {
      if (cosmeticFrameMutationNeedsRefresh(records)) scheduleCosmeticSvgMotionBudgetRefresh();
    });
    cosmeticMotionMutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }
  if (typeof ResizeObserver !== 'undefined' && document.documentElement) {
    cosmeticMotionResizeObserver = new ResizeObserver(scheduleCosmeticSvgMotionBudgetRefresh);
    cosmeticMotionResizeObserver.observe(document.documentElement);
  }
  if (typeof IntersectionObserver !== 'undefined') {
    cosmeticMotionIntersectionObserver = new IntersectionObserver(
      scheduleCosmeticSvgMotionBudgetRefresh,
      { threshold: [0, 0.001, 0.25, 0.5, 0.75, 1] }
    );
  }
  scheduleCosmeticSvgMotionBudgetRefresh();
};

const ensureReducedMotionObserver = (): void => {
  if (reducedMotionMediaQuery || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (typeof reducedMotionMediaQuery.addEventListener === 'function') {
    reducedMotionMediaQuery.addEventListener('change', syncAllInjectedCosmeticCss);
  } else {
    reducedMotionMediaQuery.addListener(syncAllInjectedCosmeticCss);
  }
};

/** 테스트 모듈 재로딩 사이에 전역 observer와 주입 상태가 남지 않도록 정리합니다. */
export const __resetCosmeticRuntimeForTests = (): void => {
  if (typeof window !== 'undefined') {
    if (cosmeticMotionBudgetFrame !== null && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(cosmeticMotionBudgetFrame);
    }
    if (cosmeticMotionBudgetInitialized && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', scheduleCosmeticSvgMotionBudgetRefresh);
      window.removeEventListener('scroll', scheduleCosmeticSvgMotionBudgetRefresh, true);
    }
  }
  if (
    cosmeticMotionBudgetInitialized
    && typeof document !== 'undefined'
    && typeof document.removeEventListener === 'function'
  ) {
    document.removeEventListener('pointerover', scheduleCosmeticSvgMotionBudgetRefresh, true);
    document.removeEventListener('pointerout', scheduleCosmeticSvgMotionBudgetRefresh, true);
    document.removeEventListener('focusin', scheduleCosmeticSvgMotionBudgetRefresh, true);
    document.removeEventListener('focusout', scheduleCosmeticSvgMotionBudgetRefresh, true);
    document.removeEventListener('visibilitychange', handleCosmeticVisibilityChange);
  }

  for (const element of observedCosmeticMotionElements) {
    cosmeticMotionIntersectionObserver?.unobserve(element);
    cosmeticMotionResizeObserver?.unobserve(element);
  }
  cosmeticMotionMutationObserver?.disconnect();
  cosmeticMotionResizeObserver?.disconnect();
  cosmeticMotionIntersectionObserver?.disconnect();

  if (reducedMotionMediaQuery) {
    if (typeof reducedMotionMediaQuery.removeEventListener === 'function') {
      reducedMotionMediaQuery.removeEventListener('change', syncAllInjectedCosmeticCss);
    } else if (typeof reducedMotionMediaQuery.removeListener === 'function') {
      reducedMotionMediaQuery.removeListener(syncAllInjectedCosmeticCss);
    }
  }

  for (const key of injectedCosmeticCssSources.keys()) clearCosmeticMotionPausedAttributes(key);
  for (const style of injectedBorderCss.values()) style.remove();
  injectedBorderCss.clear();
  injectedCosmeticCssSources.clear();
  cosmeticMotionBudgetLimitedKeys = new Set<string>();
  cosmeticMotionAdaptiveLodKeys = new Set<string>();
  cosmeticMotionCssOnlyKeys = new Set<string>();
  observedCosmeticMotionElements = new Set<Element>();
  cosmeticMotionBudgetFrame = null;
  cosmeticMotionBudgetInitialized = false;
  cosmeticMotionMutationObserver = null;
  cosmeticMotionResizeObserver = null;
  cosmeticMotionIntersectionObserver = null;
  reducedMotionMediaQuery = null;
};

/**
 * 코스메틱(테두리·이름 이펙트)이 style_json에 {"class":..,"css":..} 형태로 원본 CSS를 담고 있으면,
 * 해당 CSS를 <style data-cb-css="class"> 태그로 문서에 주입합니다(클래스 단위 dedupe·갱신).
 * 주입 직전 SVG 데이터 URI를 정규화하여 인코딩 누락(`#`·`<`·`>`·줄바꿈)도 브라우저처럼 처리합니다.
 * css 없이 class만 있으면 아무것도 주입하지 않습니다.
 */
export const ensureCosmeticCss = (cosmetic?: { style_json?: string | null } | null): void => {
  if (typeof document === 'undefined' || !cosmetic?.style_json) return;
  let parsed: unknown;
  try { parsed = JSON.parse(cosmetic.style_json); } catch { return; }
  if (!parsed || typeof parsed !== 'object') return;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.class !== 'string') return;
  const key = obj.class.trim();
  if (!key) return;
  if (typeof obj.css !== 'string' || !obj.css.trim()) {
    clearCosmeticMotionPausedAttributes(key);
    const stale = injectedBorderCss.get(key);
    if (stale) {
      stale.remove();
      injectedBorderCss.delete(key);
    }
    injectedCosmeticCssSources.delete(key);
    cosmeticMotionBudgetLimitedKeys.delete(key);
    cosmeticMotionAdaptiveLodKeys.delete(key);
    cosmeticMotionCssOnlyKeys.delete(key);
    scheduleCosmeticSvgMotionBudgetRefresh();
    return;
  }
  const css = obj.css;
  let fallbackCss = '';
  if (obj.fallback_ks_active && typeof obj.fallback_ks_css === 'string' && obj.fallback_ks_css.trim()) {
    const fontNameMatch = obj.fallback_ks_css.match(/font-family\s*:\s*['"]([^'"]+)['"]/);
    const fallbackFontName = fontNameMatch ? fontNameMatch[1] : 'GMarketSans';
    fallbackCss = `${obj.fallback_ks_css}\n.${key} .ne-fallback-char { font-family: "${fallbackFontName}" !important; }`;
  }
  const source: InjectedCosmeticCssSource = {
    key,
    css,
    isFrame: key.startsWith('cb-'),
    fallbackCss,
    hasSvgSmil: SVG_SMIL_RAW_OR_ENCODED_START.test(css),
    // 7개 타임라인을 비용 1의 기준 단위로 두며, 현재 운영 테마의
    // 20~24개 SMIL은 약 2.86~3.43배의 가시 면적 예산을 사용합니다.
    svgSmilMotionWeight: Math.max(
      1,
      (css.match(new RegExp(SVG_SMIL_RAW_OR_ENCODED_START.source, 'gi'))?.length ?? 0) / 7
    ),
    motionSelector: cosmeticClassSelector(key)
  };
  const previousSource = injectedCosmeticCssSources.get(key);
  const needsSvgMotionBudgetReapproval = source.isFrame && source.hasSvgSmil && (
    !previousSource
    || !previousSource.hasSvgSmil
    || previousSource.css !== source.css
    || previousSource.svgSmilMotionWeight !== source.svgSmilMotionWeight
  );
  if (!source.isFrame || !source.hasSvgSmil) {
    clearCosmeticMotionPausedAttributes(key);
    cosmeticMotionBudgetLimitedKeys.delete(key);
    cosmeticMotionAdaptiveLodKeys.delete(key);
    cosmeticMotionCssOnlyKeys.delete(key);
  } else if (needsSvgMotionBudgetReapproval) {
    // 신규·정적→동적 전환·동적 CSS/SMIL 비용 변경은 모두 먼저 정적으로
    // 주입합니다. 동일 CSS의 반복 호출은 현재 승인 상태를 유지합니다.
    // 다음 rAF에서 실제 DOM 가시 면적을 합산해 승인된 테마만 되살립니다.
    cosmeticMotionBudgetLimitedKeys.add(key);
  }
  injectedCosmeticCssSources.set(key, source);
  ensureReducedMotionObserver();
  let el = injectedBorderCss.get(key);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('data-cb-css', key);
    document.head.appendChild(el);
    injectedBorderCss.set(key, el);
  }
  syncInjectedCosmeticCss(source);
  if (source.isFrame && source.hasSvgSmil) ensureCosmeticSvgMotionBudgetObserver();
  scheduleCosmeticSvgMotionBudgetRefresh();
};
/** 하위 호환 별칭 */
export const ensureBorderCss = ensureCosmeticCss;

// (테두리 프리셋 목록은 제거됨 — 이제 관리자가 card-borders/*.css 의 CSS를 직접 입력해 등록합니다)
