'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '../../../AppContext';
import { apiFetch, setAuthFlag } from '@/lib/api';
import {
  buildCouponDeepLink,
  LEGACY_PENDING_COUPON_STORAGE_KEY,
  normalizeCouponDeepLinkCode,
  PENDING_COUPON_STORAGE_KEY
} from '@/lib/couponDeepLink';

import { Loader2 } from 'lucide-react';

const ChzzkCallbackContent: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, toast } = useApp() as any; // 타입 캐스팅 편의용
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const exchangeStartedRef = React.useRef(false);

  useEffect(() => {
    const getCallbackParams = () => {
      const currentUrl = new URL(window.location.href);
      return {
        code: currentUrl.searchParams.get('code') || searchParams.get('code'),
        state: currentUrl.searchParams.get('state') || searchParams.get('state')
      };
    };

    if (exchangeStartedRef.current) return;

    let cancelled = false;
    let waitTimer: number | undefined;

    const waitForCallbackParams = async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const params = getCallbackParams();
        if (params.code) return params;
        await new Promise<void>((resolve) => {
          waitTimer = window.setTimeout(resolve, 150);
        });
      }
      return getCallbackParams();
    };

    const waitForConfirmedSession = async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await apiFetch('/users/me');
        if (response.ok) return response.json();
        if (response.status !== 401) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.message || '로그인 세션 확인에 실패했습니다.');
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250 + attempt * 150));
      }
      throw new Error('로그인 세션 쿠키가 저장되지 않았습니다. 모바일 브라우저의 쿠키 차단 설정을 확인해 주세요.');
    };

    const exchangeCodeForToken = async () => {
      try {
        const { code, state } = await waitForCallbackParams();
        if (cancelled) return;
        if (!code) {
          throw new Error('치지직 인증 코드(Authorization Code)가 전달되지 않았습니다.');
        }

        exchangeStartedRef.current = true;
        window.history.replaceState(null, '', '/auth/chzzk/callback');

        const response = await apiFetch('/auth/chzzk/callback', {
          method: 'POST',
          body: JSON.stringify({ code, state }),
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.message || '토큰 교환에 실패했습니다.');
        }

        const data = await response.json();
        const confirmedUser = await waitForConfirmedSession();

        const sessionUser = {
          id: confirmedUser.id || data.user.id,
          username: confirmedUser.username || data.user.username,
          avatarUrl: confirmedUser.avatarUrl || data.user.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/png?seed=${data.user.id}`,
          role: confirmedUser.role || data.user.role,
          statusMessage: confirmedUser.statusMessage ?? null,
          titles: confirmedUser.titles || [],
          ownedTitles: confirmedUser.ownedTitles || confirmedUser.titles || [],
          point: confirmedUser.point ?? data.user.point,
          lastFreeDraw: confirmedUser.lastFreeDraw ?? null,
          freeDrawTickets: confirmedUser.freeDrawTickets ?? 0,
          bonusFreeDrawTickets: confirmedUser.bonusFreeDrawTickets ?? 0,
          freeDrawMaxStack: confirmedUser.freeDrawMaxStack ?? 1,
          representativeCardChannelId: confirmedUser.representativeCardChannelId ?? null,
          representativeCardStar: confirmedUser.representativeCardStar ?? null,
          drawCost: confirmedUser.drawCost ?? 10000,
          freeDrawInterval: confirmedUser.freeDrawInterval ?? 24,
          isFreeDrawEligible: !!confirmedUser.isFreeDrawEligible,
          nextFreeDrawAt: confirmedUser.nextFreeDrawAt ?? null,
          interactionRestrictedUntil: confirmedUser.interactionRestrictedUntil ?? null
        };

        // 인증은 백엔드가 발급한 httpOnly 세션 쿠키로 유지됨. JS에는 민감 토큰 대신 비민감 플래그만 저장.
        setAuthFlag();

        if (setUser) {
          setUser(sessionUser);
        }

        // 로그인 성공 알림 및 쿠폰 딥링크 복원
        if (toast) toast(`${sessionUser.username}님, 치지직 인증 로그인이 완료되었습니다.`, 'success');
        const pendingCoupon = normalizeCouponDeepLinkCode(
          localStorage.getItem(PENDING_COUPON_STORAGE_KEY)
            || localStorage.getItem(LEGACY_PENDING_COUPON_STORAGE_KEY)
        );
        router.push(pendingCoupon ? buildCouponDeepLink(pendingCoupon) : '/');
      } catch (err: any) {
        console.error('[ChzzkCallback] 토큰 획득 에러:', err);
        setError(err.message || '서버와의 통신 도중 에러가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    exchangeCodeForToken();
    return () => {
      cancelled = true;
      if (waitTimer) window.clearTimeout(waitTimer);
    };
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
