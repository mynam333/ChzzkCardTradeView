'use client';

import React, { Suspense } from 'react';
import { MainLayout } from '../MainLayout';
import { ShopTab } from '../ShopTab';

/**
 * CCTV 상점 페이지 (/shop)
 * useSearchParams() 정적 베일아웃 에러를 차단하기 위해 Suspense 경계로 감싸 렌더링합니다.
 */
export default function ShopPage() {
  return (
    <MainLayout>
      <Suspense
        fallback={
          <div className="flex h-40 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      >
        <ShopTab />
      </Suspense>
    </MainLayout>
  );
}
