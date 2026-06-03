'use client';

import React from 'react';
import { MainLayout } from '../MainLayout';
import { MyInfoTab } from '../MyInfoTab';

/**
 * CCTV 내 정보 페이지 (/my-info)
 */
export default function MyInfoPage() {
  return (
    <MainLayout>
      <MyInfoTab />
    </MainLayout>
  );
}
