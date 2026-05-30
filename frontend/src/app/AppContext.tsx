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
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  };

  const logout = () => {
    localStorage.removeItem('user_session');
    localStorage.removeItem('cctv_jwt_token');
    setUser(null);
    setActiveTab('main');
    alert('로그아웃되었습니다.');
  };

  const refreshUserData = async () => {
    const token = localStorage.getItem('cctv_jwt_token');
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/users/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        const updated = {
          id: data.id,
          username: data.username,
          avatarUrl: data.avatarUrl,
          role: data.role,
          point: data.point,
          lastFreeDraw: data.lastFreeDraw
        };
        localStorage.setItem('user_session', JSON.stringify(updated));
        setUser(updated);
      } else if (response.status === 401) {
        // 만료되었거나 비정상적인 토큰인 경우 로그아웃 처리
        localStorage.removeItem('user_session');
        localStorage.removeItem('cctv_jwt_token');
        setUser(null);
      }
    } catch (e) {
      console.error('[AppContext] 유저 세션 갱신 실패:', e);
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
