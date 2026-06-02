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

/** 이름 이펙트 객체로부터 적용할 스타일(폰트 포함) 생성 */
export const nameEffectStyle = (effect?: { style_json?: string | null; font_url?: string | null; font_family?: string | null } | null): React.CSSProperties => {
  if (!effect) return {};
  ensureFont(effect.font_url);
  const style = parseStyle(effect.style_json);
  if (effect.font_family) style.fontFamily = effect.font_family;
  return style;
};

/** 테두리 코스메틱 스타일 */
export const borderStyle = (border?: { style_json?: string | null } | null): React.CSSProperties => {
  if (!border) return {};
  return parseStyle(border.style_json);
};
