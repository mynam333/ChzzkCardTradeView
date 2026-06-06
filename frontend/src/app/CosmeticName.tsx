'use client';

import React, { useEffect } from 'react';
import {
  ensureCosmeticCss,
  ensureFont,
  nameEffectClass,
  nameEffectFontStyle,
  nameEffectStyle
} from '@/lib/cosmetics';

interface EffectLike { style_json?: string | null; font_url?: string | null; font_family?: string | null }

/**
 * 이름 이펙트가 적용된 텍스트.
 * - style_json 의 class 가 있으면 해당 클래스를 적용하고, {"css":..}가 있으면 문서에 1회 주입합니다.
 * - class 가 없으면 레거시 인라인 스타일(nameEffectStyle)을 적용합니다.
 */
export const CosmeticName: React.FC<{ effect?: EffectLike | null; className?: string; children: React.ReactNode }> = ({ effect, className, children }) => {
  const cls = nameEffectClass(effect);
  useEffect(() => {
    ensureCosmeticCss(effect);
    ensureFont(effect?.font_url, effect?.font_family);
  }, [effect?.style_json, effect?.font_url, effect?.font_family]);
  return (
    <span
      className={`${className || ''}${cls ? ` ${cls}` : ''}`}
      style={cls ? nameEffectFontStyle(effect) : nameEffectStyle(effect)}
    >
      {children}
    </span>
  );
};
