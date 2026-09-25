'use client';

import React, { useMemo } from 'react';
import { cosmeticFrameConfig } from '../lib/cosmetics';

/** Admin diagnostics use the same parser as the actual card, including SSR. */
export const CosmeticFrameStatus = ({ styleJson }: { styleJson?: string | null }) => {
  const config = useMemo(() => cosmeticFrameConfig(styleJson), [styleJson]);
  if (config.layerError) return (
    <p role="alert" className="text-xs text-destructive">
      레이어 구성 오류: {config.layerError} 현재는 기본 배경만 표시됩니다.
    </p>
  );
  if (!config.layers) return null;
  return (
    <p role="status" className="text-[11px] text-muted-foreground">
      {config.imageLayerLayout === 'chuseok-webp-v1' ? '추석 호환 모드' : '공통 레이어 v1'} · 장식 레이어 {config.layers.length}개 인식.
      {' '}화면 밖·숨김 탭에서는 일시 정지하며, 기기의 모션 감소 설정이 켜져 있으면 정적으로 표시합니다.
    </p>
  );
};
