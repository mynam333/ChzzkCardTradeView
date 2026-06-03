'use client';

import React from 'react';
import { MainLayout } from '../MainLayout';
import { GachaTab } from '../GachaTab';

/**
 * CCTV 보관함 페이지 (/inventory)
 * 기존 /gacha 경로를 /inventory 경로로 수정하여 적용했습니다.
 */
export default function InventoryPage() {
  return (
    <MainLayout>
      <GachaTab />
    </MainLayout>
  );
}
