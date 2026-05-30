'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

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

  // 로컬 스토리지 또는 시스템 설정 동기화
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    } else {
      document.documentElement.classList.add('dark');
    }

    // 자동 모크 로그인 처리 (첫 진입 시 일반 유저로 세팅 - 0포인트)
    const savedUser = localStorage.getItem('user_session');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    } else {
      // 첫 방문 유저 자동 Mocking 로그인
      const mockUid = 'user_' + Math.random().toString(36).substring(2, 9);
      const defaultUser = {
        id: mockUid,
        username: `치지직유저_${mockUid.substring(0, 4)}`,
        avatarUrl: `https://api.dicebear.com/7.x/pixel-art/svg?seed=${mockUid}`,
        role: 'USER' as const,
        point: 0,
        lastFreeDraw: null
      };
      localStorage.setItem('user_session', JSON.stringify(defaultUser));
      setUser(defaultUser);
    }
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
      const response = await fetch(`http://localhost:5000/api/health`); // 백엔드 활성화 여부
      if (response.ok) {
        // 백엔드 연동 시 리프레시 로직 (여기서는 로컬 세션 기준으로 상태 동기화)
        const saved = localStorage.getItem('user_session');
        if (saved) setUser(JSON.parse(saved));
      }
    } catch (e) {
      // offline fallback
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
