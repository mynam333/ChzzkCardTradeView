'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_BASE_URL } from '@/lib/api';

// 다크모드/라이트모드 및 현재 선택 탭, 사용자 인증 상태, 보유 재화 전역 관리
interface AppContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activeTab: 'main' | 'gacha' | 'ranking' | 'my-info';
  setActiveTab: (tab: 'main' | 'gacha' | 'ranking' | 'my-info') => void;
  user: {
    id: string;
    username: string;
    avatarUrl: string;
    role: 'USER' | 'ADMIN';
    point: number;
    lastFreeDraw: string | null;
  } | null;
  setUser: React.Dispatch<React.SetStateAction<AppContextType['user']>>;
  loginMock: (role: 'USER' | 'ADMIN') => void;
  logout: () => void;
  refreshUserData: () => Promise<void>;
  updatePoints: (diff: number) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark'); // 기본 다크모드 선호
  const [activeTab, setActiveTab] = useState<'main' | 'gacha' | 'ranking' | 'my-info'>('main');
  const [user, setUser] = useState<AppContextType['user']>(null);

  // 로컬 스토리지에서 저장된 세션 복원 (치지직 로그인 완료 후 저장된 경우만)
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    } else {
      document.documentElement.classList.add('dark');
    }

    // 치지직 OAuth 로그인 후 저장된 세션이 있는 경우에만 복원
    const savedUser = localStorage.getItem('user_session');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    // 미로그인 상태 = null 유지 (자동 모크 로그인 없음)
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  };

  const loginMock = (role: 'USER' | 'ADMIN') => {
    const mockUid = role === 'ADMIN' ? 'admin_test_uid' : 'user_test_uid';
    const mockUser = {
      id: mockUid,
      username: role === 'ADMIN' ? '치지직관리자' : '치지직유저_테스트',
      avatarUrl: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${mockUid}`,
      role: role,
      point: role === 'ADMIN' ? 999999 : 0, // 관리자는 풍족하게, 유저는 0포인트로 시작
      lastFreeDraw: null
    };
    localStorage.setItem('user_session', JSON.stringify(mockUser));
    setUser(mockUser);
    alert(`${role === 'ADMIN' ? '관리자' : '일반 유저'} 모드로 전환 로그인되었습니다.`);
  };

  const logout = () => {
    localStorage.removeItem('user_session');
    localStorage.removeItem('cctv_jwt_token');
    setUser(null);
    alert('로그아웃되었습니다.');
  };

  const refreshUserData = async () => {
    if (!user) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${apiUrl}/health`.replace('/api/health', '/health'));
      if (response.ok) {
        const saved = localStorage.getItem('user_session');
        if (saved) setUser(JSON.parse(saved));
      }
    } catch (e) {
      // 오프라인 폴백: 로컬 세션으로 동기화
      const saved = localStorage.getItem('user_session');
      if (saved) setUser(JSON.parse(saved));
    }
  };

  const updatePoints = async (diff: number) => {
    if (!user) return;
    const updated = {
      ...user,
      point: Math.max(0, user.point + diff)
    };
    localStorage.setItem('user_session', JSON.stringify(updated));
    setUser(updated);
  };

  return (
    <AppContext.Provider value={{
      theme,
      toggleTheme,
      activeTab,
      setActiveTab,
      user,
      setUser,
      loginMock,
      logout,
      refreshUserData,
      updatePoints
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
