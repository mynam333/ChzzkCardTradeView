'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../AppContext';
import { MainLayout } from '../MainLayout';
import { AdminTab } from '../AdminTab';

/**
 * CCTV 관리자 전용 페이지 (/admin)
 * 비관리자 계정이 진입 시 홈(/)으로 강제 리다이렉트 처리하는 가드가 포함되어 있습니다.
 */
export default function AdminPage() {
  const { user, authLoading, toast } = useApp();
  const router = useRouter();

  useEffect(() => {
    // 세션 로딩이 완료된 후, 유저 정보가 없거나 역할이 ADMIN이 아닌 경우
    if (!authLoading) {
      if (!user || user.role !== 'ADMIN') {
        toast('관리자 권한이 필요합니다.', 'error');
        router.replace('/');
      }
    }
  }, [user, authLoading, router, toast]);

  // 로딩 중이거나 권한이 없는 경우 화면을 렌더링하지 않음
  if (authLoading || !user || user.role !== 'ADMIN') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return (
    <MainLayout>
      <AdminTab />
    </MainLayout>
  );
}
