'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { registerServiceWorker, subscribeToPush, isPushSupported } from '@/lib/push';

export type TabId = 'main' | 'gacha' | 'ranking' | 'my-info' | 'admin';

// 다크모드/라이트모드 및 현재 선택 탭, 사용자 인증 상태, 보유 재화 전역 관리
interface AppContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  user: {
    id: string;
    username: string;
    avatarUrl: string;
    role: 'USER' | 'ADMIN';
    point: number;
    lastFreeDraw: string | null;
    representativeCardChannelId: string | null;
  } | null;
  authLoading: boolean;
  setUser: React.Dispatch<React.SetStateAction<AppContextType['user']>>;
  logout: () => void;
  refreshUserData: () => Promise<void>;
  updatePoints: (diff: number) => Promise<void>;
  // 전역 토스트 알림 (alert 대체)
  toast: (message: string, type?: ToastType) => void;
}

type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark'); // 기본 다크모드 선호
  const [activeTab, setActiveTab] = useState<TabId>('main');
  const [user, setUser] = useState<AppContextType['user']>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true); // 초기 인증 검증 완료 상태 대기

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // 설치 프롬프트 이벤트는 제스처 핸들러(클로저)에서 직접 접근하므로 ref로만 보관
  const deferredPromptRef = useRef<any>(null);

  const toast = (message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  };
  const askedPushRef = useRef(false);       // 알림 권한 자동 요청 1회만
  const promptedInstallRef = useRef(false); // 설치 프롬프트 자동 노출 1회만

  // 로컬 스토리지에서 저장된 테마만 복원 및 초기 인증 처리
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    } else {
      document.documentElement.classList.add('dark');
    }

    // JWT 토큰이 있으면 매 마운트 시 서버에 검증된 정보(/users/me)를 호출하여 로드
    refreshUserData();

    // PWA 서비스 워커 등록 (푸시 알림 수신 기반 마련)
    registerServiceWorker();

    // PWA 설치 프롬프트 이벤트 캡처 (브라우저가 기본 배너 대신 우리가 제어)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e;
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    const handleInstalled = () => { deferredPromptRef.current = null; };
    window.addEventListener('appinstalled', handleInstalled);

    // 브라우저 정책상 제스처 없이 시스템 프롬프트를 띄울 수 없으므로,
    // 사용자의 "첫 상호작용" 시점에 네이티브 알림 권한 → 앱 설치 다이얼로그를 순차 노출한다.
    const handleFirstGesture = async () => {
      // 1순위: 알림 권한 (아직 묻지 않은 경우에만 네이티브 프롬프트)
      if (!askedPushRef.current && isPushSupported() && Notification.permission === 'default') {
        askedPushRef.current = true;
        try { await subscribeToPush(); } catch { /* 권한 거부/실패 무시 */ }
        return; // 이번 제스처는 알림에 사용, 설치는 다음 제스처에서 (제스처 활성화 만료 방지)
      }
      // 2순위: 앱 설치 (설치 가능 & 아직 노출 안 함) — 제스처 동기 호출이어야 함
      if (deferredPromptRef.current && !promptedInstallRef.current) {
        promptedInstallRef.current = true;
        const dp = deferredPromptRef.current;
        deferredPromptRef.current = null;
        try { dp.prompt(); await dp.userChoice; } catch { /* 무시 */ }
      }
      // 둘 다 끝났으면 리스너 제거
      if (askedPushRef.current && promptedInstallRef.current) {
        window.removeEventListener('pointerdown', handleFirstGesture);
      }
    };
    window.addEventListener('pointerdown', handleFirstGesture);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('pointerdown', handleFirstGesture);
    };
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  };

  const logout = () => {
    localStorage.removeItem('cctv_jwt_token');
    setUser(null);
    setActiveTab('main');
    toast('로그아웃되었습니다.', 'info');
  };

  const refreshUserData = async () => {
    const token = localStorage.getItem('cctv_jwt_token');
    if (!token) {
      setUser(null);
      setAuthLoading(false);
      return;
    }
    setAuthLoading(true);
    try {
      const response = await apiFetch('/users/me');
      if (response.ok) {
        const data = await response.json();
        setUser({
          id: data.id,
          username: data.username,
          avatarUrl: data.avatarUrl,
          role: data.role,
          point: data.point,
          lastFreeDraw: data.lastFreeDraw,
          representativeCardChannelId: data.representativeCardChannelId ?? null
        });
      } else if (response.status === 401) {
        // 만료되었거나 비정상적인 토큰인 경우 로그아웃 처리
        localStorage.removeItem('cctv_jwt_token');
        setUser(null);
      }
    } catch (e) {
      console.error('[AppContext] 유저 세션 갱신 실패:', e);
    } finally {
      setAuthLoading(false);
    }
  };

  const updatePoints = async (diff: number) => {
    if (!user) return;
    // UI에만 즉시 피드백을 주기 위해 React State만 업데이트합니다 (외부 변조 및 불법 갱신 방지)
    setUser({
      ...user,
      point: Math.max(0, user.point + diff)
    });
  };

  return (
    <AppContext.Provider value={{
      theme,
      toggleTheme,
      activeTab,
      setActiveTab,
      user,
      authLoading,
      setUser,
      logout,
      refreshUserData,
      updatePoints,
      toast
    }}>
      {children}

      {/* 전역 토스트 컨테이너 */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const tone =
            t.type === 'success' ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
            : t.type === 'error' ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
            : t.type === 'warning' ? 'border-amber-500/40 bg-amber-500/15 text-amber-100'
            : 'border-sky-500/40 bg-sky-500/15 text-sky-100';
          return (
            <div
              key={t.id}
              className={`pointer-events-auto rounded-xl border px-4 py-3 text-xs font-bold shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-200 ${tone}`}
            >
              {t.message}
            </div>
          );
        })}
      </div>
    </AppContext.Provider>
  );
};


export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
