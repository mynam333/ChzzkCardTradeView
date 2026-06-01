'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { registerServiceWorker } from '@/lib/push';

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
  // PWA 설치 프롬프트
  canInstall: boolean;
  promptInstall: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark'); // 기본 다크모드 선호
  const [activeTab, setActiveTab] = useState<TabId>('main');
  const [user, setUser] = useState<AppContextType['user']>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true); // 초기 인증 검증 완료 상태 대기
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

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
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    const handleInstalled = () => setDeferredPrompt(null);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
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
    alert('로그아웃되었습니다.');
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

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch {
      // 사용자가 닫은 경우 무시
    }
    setDeferredPrompt(null);
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
      canInstall: !!deferredPrompt,
      promptInstall
    }}>
      {children}
    </AppContext.Provider>
  );
};


export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
