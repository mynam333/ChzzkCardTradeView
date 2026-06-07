'use client';

import React from 'react';
import { MainLayout } from './MainLayout';
import { MainTab } from './MainTab';

/**
 * 루트 경로(/)에 진입 시 치카포 메인 화면을 바로 노출하도록 설정
 */
export default function Home() {
  return (
    <MainLayout>
      <MainTab />
    </MainLayout>
  );
}
