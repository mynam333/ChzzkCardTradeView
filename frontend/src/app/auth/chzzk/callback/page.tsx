'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '../../../AppContext';

import { Loader2 } from 'lucide-react';

const ChzzkCallbackContent: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser } = useApp() as any; // 타입 캐스팅 편의용
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!code) {
      setError('치지직 인증 코드(Authorization Code)가 전달되지 않았습니다.');
      setLoading(false);
      return;
    }

    const exchangeCodeForToken = async () => {
      try {
        const response = await fetch('http://localhost:5000/api/auth/chzzk/callback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ code, state }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.message || '토큰 교환에 실패했습니다.');
        }

        const data = await response.json();
        
        // 세션 및 사용자 정보 로컬스토리지 보존
        const sessionUser = {
          id: data.user.id,
          username: data.user.username,
          avatarUrl: data.user.avatar_url || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${data.user.id}`,
          role: data.user.role,
          point: data.user.point,
          lastFreeDraw: null,
          token: data.token
        };

        localStorage.setItem('user_session', JSON.stringify(sessionUser));
        localStorage.setItem('cctv_jwt_token', data.token);

        if (setUser) {
          setUser(sessionUser);
        }

        // 로그인 성공 알림 및 메인 페이지 이동
        alert(`${sessionUser.username}님, 치지직 인증 로그인이 완료되었습니다.`);
        router.push('/');
      } catch (err: any) {
        console.error('[ChzzkCallback] 토큰 획득 에러:', err);
        setError(err.message || '서버와의 통신 도중 에러가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    exchangeCodeForToken();
  }, [searchParams, router, setUser]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="mt-4 text-sm font-semibold tracking-tight">치지직 계정 연동 및 로그인 세션 수립 중...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground px-4 text-center">
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 max-w-md">
          <h2 className="text-lg font-bold text-destructive">로그인 실패</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="mt-6 w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground shadow-md transition hover:opacity-90"
          >
            메인 홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default function ChzzkCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="mt-4 text-sm font-semibold">로딩 중...</p>
      </div>
    }>
      <ChzzkCallbackContent />
    </Suspense>
  );
}
