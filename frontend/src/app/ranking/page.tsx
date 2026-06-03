'use client';

import React from 'react';
import { MainLayout } from '../MainLayout';
import { RankingTab } from '../RankingTab';

/**
 * CCTV 실시간 랭킹 페이지 (/ranking)
 */
export default function RankingPage() {
  return (
    <MainLayout>
      <RankingTab />
    </MainLayout>
  );
}
