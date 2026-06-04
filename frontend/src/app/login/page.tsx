'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const startLogin = async () => {
      try {
        const redirectUri = `${window.location.origin}/auth/chzzk/callback`;
        const response = await apiFetch(`/auth/chzzk/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
        if (!response.ok) throw new Error('로그인 주소를 가져오지 못했습니다.');

        const data = await response.json();
        if (data.auth_url) {
          window.location.href = data.auth_url;
        } else {
          throw new Error('로그인 URL이 제공되지 않았습니다.');
        }
      } catch (err: any) {
        console.error('Login redirection error:', err);
        setError(err.message || '로그인 연동 오류가 발생했습니다.');
      }
    };

    startLogin();
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-foreground">
      {error ? (
        <div className="text-center p-6 max-w-sm rounded-2xl border border-border bg-card shadow-lg animate-in zoom-in-95">
          <p className="text-sm font-bold text-rose-500">{error}</p>
          <p className="mt-2 text-xs text-muted-foreground">잠시 후 다시 시도해 주세요.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-xs text-muted-foreground font-bold">치지직 로그인 화면으로 이동 중입니다...</p>
        </div>
      )}
    </div>
  );
}
