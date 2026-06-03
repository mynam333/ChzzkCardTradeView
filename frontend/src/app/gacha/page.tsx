'use client';

import React from 'react';
import { MainLayout } from '../MainLayout';
import { GachaTab } from '../GachaTab';

/**
 * CCTV 보관함 페이지 (/gacha)
 */
export default function GachaPage() {
  return (
    <MainLayout>
      <GachaTab />
    </MainLayout>
  );
}
