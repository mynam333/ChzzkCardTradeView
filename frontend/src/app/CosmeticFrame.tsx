'use client';

import React, { useEffect } from 'react';
import { borderClass, ensureBorderCss } from '@/lib/cosmetics';

interface BorderLike { style_json?: string | null }

/**
 * 카드 위에 깔리는 테두리 코스메틱 오버레이.
 * - style_json 의 class 를 .cosmetic-frame 오버레이에 적용합니다.
 * - {"css":"..."} 가 함께 있으면 해당 원본 CSS를 문서에 1회 주입합니다.
 * - class 가 없으면 아무것도 렌더링하지 않습니다(레거시 인라인 테두리는 컨테이너 style로 처리).
 */
export const CosmeticFrame: React.FC<{ border?: BorderLike | null; className?: string }> = ({ border, className }) => {
  const cls = borderClass(border);
  useEffect(() => {
    ensureBorderCss(border);
  }, [border?.style_json]);
  if (!cls) return null;
  return <div className={`cosmetic-frame ${cls}${className ? ` ${className}` : ''}`} />;
};
