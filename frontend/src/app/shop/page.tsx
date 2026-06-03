'use client';

import React from 'react';
import { MainLayout } from '../MainLayout';
import { ShopTab } from '../ShopTab';

/**
 * CCTV 상점 페이지 (/shop)
 */
export default function ShopPage() {
  return (
    <MainLayout>
      <ShopTab />
    </MainLayout>
  );
}
