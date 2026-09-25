'use client';

import React, { useEffect, useMemo } from 'react';
import { cosmeticFrameConfig, ensureBorderCss } from '../lib/cosmetics';
import type { CosmeticFrameLayer } from '../lib/cosmeticFrameLayers';

interface BorderLike { style_json?: string | null }

// Build once per CSS change, not per animation frame. Full paths keep sibling
// identity stable; iterative construction avoids a recursive parser/render walk.
const renderLayers = (layers?: readonly CosmeticFrameLayer[]): React.ReactNode => {
  if (!layers) return null;
  const children = new Map<string | undefined, React.ReactNode[]>();
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    const node = <span key={layer.path} data-cosmetic-layer={layer.name} data-cosmetic-layer-path={layer.path}>
      {children.get(layer.path)?.reverse()}
    </span>;
    const siblings = children.get(layer.parentPath) ?? [];
    siblings.push(node);
    children.set(layer.parentPath, siblings);
  }
  return children.get(undefined)?.reverse();
};

/**
 * 카드 위에 깔리는 테두리 코스메틱 오버레이.
 * - style_json 의 class 를 .cosmetic-frame 오버레이에 적용합니다.
 * - {"css":"..."} 가 함께 있으면 해당 원본 CSS를 문서에 1회 주입합니다.
 * - class 가 없으면 아무것도 렌더링하지 않습니다(레거시 인라인 테두리는 컨테이너 style로 처리).
 */
export const CosmeticFrame: React.FC<{ border?: BorderLike | null; className?: string }> = ({ border, className }) => {
  const styleJson = border?.style_json;
  const { className: cls, imageLayerLayout, layers, layerError } = useMemo(() => cosmeticFrameConfig(styleJson), [styleJson]);
  const decoration = useMemo(() => renderLayers(layers), [layers]);
  useEffect(() => {
    ensureBorderCss({ style_json: styleJson });
  }, [styleJson]);
  if (!cls) return null;
  return (
    <div className={`cosmetic-frame ${cls}${className ? ` ${className}` : ''}`} data-cosmetic-layout={imageLayerLayout} data-cosmetic-layer-error={layerError ? 'true' : undefined} aria-hidden="true">
      {decoration}
    </div>
  );
};
