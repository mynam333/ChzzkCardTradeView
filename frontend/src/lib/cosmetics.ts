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
let cosmeticMotionMutationObserver: MutationObserver | null = null;
let cosmeticMotionResizeObserver: ResizeObserver | null = null;

const compileCosmeticCss = (source: InjectedCosmeticCssSource): string => {
  let cssText = normalizeSvgInCss(source.css);
  const prefersReducedMotion = !!reducedMotionMediaQuery?.matches;
  const exceedsMotionBudget = source.hasSvgSmil && cosmeticMotionBudgetLimitedKeys.has(source.key);
  if (prefersReducedMotion || exceedsMotionBudget) {
    cssText = stripSvgSmilAnimationsInCss(cssText);
  }
  if (source.isFrame) {
    cssText = migrateFramePxToContainerUnits(cssText);
  }
  if (source.isFrame && (prefersReducedMotion || exceedsMotionBudget) && source.motionSelector) {
    cssText += `\n${source.motionSelector},${source.motionSelector}::before,${source.motionSelector}::after{animation-play-state:paused!important;}`;
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

const clearCosmeticMotionPausedAttributes = (key: string): void => {
  if (
    typeof document === 'undefined'
    || typeof document.getElementsByClassName !== 'function'
  ) return;
  for (const element of Array.from(document.getElementsByClassName(key))) {
    element.removeAttribute(COSMETIC_MOTION_PAUSED_ATTRIBUTE);
  }
};

type VisibleCosmeticRect = {
  area: number;
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
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
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

const refreshCosmeticSvgMotionBudget = (): void => {
  if (
    typeof document === 'undefined'
    || typeof window === 'undefined'
    || typeof document.getElementsByClassName !== 'function'
  ) return;

  const candidates: CosmeticSvgMotionCandidate[] = [];
  const elementsByKey = new Map<string, { all: Element[]; visible: Set<Element> }>();
  const pageIsHidden = document.visibilityState === 'hidden';
  let order = 0;
  for (const source of injectedCosmeticCssSources.values()) {
    if (!source.isFrame || !source.hasSvgSmil) continue;
    let visibleArea = 0;
    let distance = Number.POSITIVE_INFINITY;
    let engaged = false;
    const elements = Array.from(document.getElementsByClassName(source.key));
    const visibleElements = new Set<Element>();
    elementsByKey.set(source.key, { all: elements, visible: visibleElements });
    if (pageIsHidden) {
      order += 1;
      continue;
    }
    for (const element of elements) {
      const visibleRect = visibleCosmeticRect(element);
      if (!visibleRect) continue;
      visibleElements.add(element);
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

  for (const [key, elements] of elementsByKey) {
    for (const element of elements.all) {
      const shouldPause = !activeKeys.has(key) || !elements.visible.has(element);
      if (shouldPause) {
        element.setAttribute(COSMETIC_MOTION_PAUSED_ATTRIBUTE, 'true');
      } else {
        element.removeAttribute(COSMETIC_MOTION_PAUSED_ATTRIBUTE);
      }
    }
  }

  const nextLimitedKeys = new Set<string>();
  for (const source of injectedCosmeticCssSources.values()) {
    if (source.isFrame && source.hasSvgSmil && !activeKeys.has(source.key)) {
      nextLimitedKeys.add(source.key);
    }
  }

  const previousLimitedKeys = cosmeticMotionBudgetLimitedKeys;
  const changedKeys = new Set(
    [...previousLimitedKeys, ...nextLimitedKeys].filter(
      (key) => previousLimitedKeys.has(key) !== nextLimitedKeys.has(key)
    )
  );
  cosmeticMotionBudgetLimitedKeys = nextLimitedKeys;
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
    // 가이드 기준의 보통 SVG(테마당 약 7개 타임라인)를 1로 보고,
    // 더 촘촘한 테마는 가시 면적 예산을 비례해 사용합니다.
    svgSmilMotionWeight: Math.max(
      1,
      (css.match(new RegExp(SVG_SMIL_RAW_OR_ENCODED_START.source, 'gi'))?.length ?? 0) / 7
    ),
    motionSelector: cosmeticClassSelector(key)
  };
  if (!source.hasSvgSmil) {
    clearCosmeticMotionPausedAttributes(key);
    cosmeticMotionBudgetLimitedKeys.delete(key);
  }
  injectedCosmeticCssSources.set(key, source);
  ensureReducedMotionObserver();
  ensureCosmeticSvgMotionBudgetObserver();
  let el = injectedBorderCss.get(key);
  if (!el) {
    el = document.createElement('style');
    el.setAttribute('data-cb-css', key);
    document.head.appendChild(el);
    injectedBorderCss.set(key, el);
  }
  syncInjectedCosmeticCss(source);
  scheduleCosmeticSvgMotionBudgetRefresh();
};
/** 하위 호환 별칭 */
export const ensureBorderCss = ensureCosmeticCss;

// (테두리 프리셋 목록은 제거됨 — 이제 관리자가 card-borders/*.css 의 CSS를 직접 입력해 등록합니다)
