'use client';

import React from 'react';
import { MainLayout } from '../MainLayout';
import { ArcadeTab } from '../ArcadeTab';

/**
 * 치카포 미니게임 아케이드 페이지 (/arcade)
 */
export default function ArcadePage() {
  return (
    <MainLayout>
      <ArcadeTab />
    </MainLayout>
  );
}
