'use client';

import React, { useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../AppContext';
import { MainLayout } from '../MainLayout';
import { AdminTab } from '../AdminTab';

/**
 * 치카포 관리자 탭 컨텐츠 컴포넌트
 */
function AdminPageContent() {
  const { user, authLoading } = useApp();
  const router = useRouter();

  useEffect(() => {
    // 세션 로딩이 완료된 후, 유저 정보가 없거나 역할이 ADMIN이 아닌 경우
    if (!authLoading) {
      if (!user || user.role !== 'ADMIN') {
        router.replace('/');
      }
    }
  }, [user, authLoading, router]);

  // 로딩 중이거나 권한이 없는 경우 화면을 렌더링하지 않음
  if (authLoading || !user || user.role !== 'ADMIN') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return <AdminTab />;
}

/**
 * 치카포 관리자 전용 페이지 (/admin)
 * useSearchParams() 정적 베일아웃 에러 방지를 위해 Suspense 경계로 래핑하여 렌더링합니다.
 */
export default function AdminPage() {
  return (
    <MainLayout>
      <Suspense
        fallback={
          <div className="flex h-40 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      >
        <AdminPageContent />
      </Suspense>
    </MainLayout>
  );
}
