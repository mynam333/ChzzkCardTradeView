'use client';

import React from 'react';
import { useApp, TabId } from './AppContext';
import {
  Home,
  Layers,
  TrendingUp,
  User,
  Sun,
  Moon,
  Bell,
  Coins,
  Shield,
  Download
} from 'lucide-react';
import Image from 'next/image';
import { apiFetch } from '@/lib/api';

interface NavigationProps {
  onNotifyClick?: () => void;
}

export const MainLayout: React.FC<{ children: React.ReactNode; onNotifyClick?: () => void }> = ({ children, onNotifyClick }) => {
  const { activeTab, setActiveTab, theme, toggleTheme, user, authLoading, canInstall, promptInstall } = useApp();
  const touchStartX = React.useRef<number | null>(null);

  const handleLogin = async () => {
    try {
      const redirectUri = `${window.location.origin}/auth/chzzk/callback`;
      const response = await apiFetch(`/auth/chzzk/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
      if (!response.ok) throw new Error('로그인 URL 획득 실패');
      const data = await response.json();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (e) {
      console.error(e);
      alert('치지직 로그인 주소 요청 중 에러가 발생했습니다.');
    }
  };

  const navItems: { id: TabId; label: string; icon: typeof Home }[] = [
    { id: 'main', label: '메인', icon: Home },
    { id: 'gacha', label: '뽑기/보관함', icon: Layers },
    { id: 'ranking', label: '실시간 랭킹', icon: TrendingUp },
    { id: 'my-info', label: '내 정보', icon: User },
    ...(user?.role === 'ADMIN'
      ? [{ id: 'admin' as TabId, label: '관리자', icon: Shield }]
      : []),
  ];

  // 모바일 좌우 스와이프로 탭 전환
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 60) return;
    const ids = navItems.map((i) => i.id);
    const idx = ids.indexOf(activeTab);
    if (dx < 0 && idx < ids.length - 1) setActiveTab(ids[idx + 1]);
    else if (dx > 0 && idx > 0) setActiveTab(ids[idx - 1]);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground md:flex-row">
      
      {/* PC Side Navigation (md 이상 브레이크포인트에서 활성화) */}
      <aside className="hidden w-64 flex-col border-r border-border bg-card px-4 py-6 md:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <Image 
            src="/icon.png" 
            alt="CCTV Logo" 
            width={36} 
            height={36} 
            className="rounded-lg shadow-md object-contain"
          />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">CCTV</h1>
            <p className="text-xs text-muted-foreground">치지직 카드 트레이드 뷰</p>
          </div>
        </div>

        {/* 유저 상태 카드 또는 로그인 버튼 */}
        {authLoading ? (
          <div className="mb-6 rounded-xl bg-secondary/20 p-4 border border-border animate-pulse flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-secondary" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-2 bg-secondary rounded" />
                <div className="h-2 bg-secondary rounded w-5/6" />
              </div>
            </div>
          </div>
        ) : user ? (
          <div className="mb-6 rounded-xl bg-secondary/50 p-4 border border-border">
            <div className="flex items-center gap-3">
              <img src={user.avatarUrl} alt="Avatar" className="h-10 w-10 rounded-full border border-primary/20 bg-card" />
              <div className="overflow-hidden">
                <p className="truncate text-sm font-semibold">{user.username}</p>
                <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {user.role}
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Coins className="h-3 w-3 text-yellow-500" /> 보유 자산
              </span>
              <span className="text-sm font-bold text-foreground">{user.point.toLocaleString()} P</span>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-xl bg-secondary/30 p-4 border border-dashed border-border text-center">
            <p className="text-xs text-muted-foreground mb-3">간편하게 로그인하고<br />나만의 카드를 소집하세요!</p>
            <button
              onClick={handleLogin}
              className="w-full rounded-lg bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary/95 transition shadow-sm"
            >
              치지직 연동 로그인
            </button>
          </div>
        )}

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* PWA 설치 버튼 (설치 가능할 때만 노출) */}
        {canInstall && (
          <button
            onClick={promptInstall}
            className="mt-auto mb-3 flex items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 py-2 text-xs font-bold text-primary hover:bg-primary/20 transition"
          >
            <Download className="h-4 w-4" /> 앱 설치하기
          </button>
        )}

        {/* 테마 스위치 */}
        <div className={`${canInstall ? '' : 'mt-auto'} pt-4 border-t border-border`}>
          <div className="flex items-center justify-between px-2">
            <span className="text-xs text-muted-foreground">화면 테마</span>
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 hover:bg-secondary text-muted-foreground hover:text-foreground transition"
              title="테마 전환"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>

      {/* 모바일 상단 바 (Mobile Top Bar) */}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Image 
            src="/icon.png" 
            alt="CCTV Logo" 
            width={28} 
            height={28} 
            className="rounded"
          />
          <span className="font-bold text-foreground">CCTV</span>
          <span className="text-[0.65rem] text-muted-foreground self-end mb-[0.1rem]">치지직 카드 트레이드 뷰</span>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <div className="flex items-center gap-1 rounded-full bg-secondary/80 px-3 py-1 text-xs font-bold">
              <Coins className="h-3.5 w-3.5 text-yellow-500" />
              <span>{user.point.toLocaleString()}</span>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground hover:bg-primary/95 transition shadow-sm"
            >
              로그인
            </button>
          )}
          
          <button 
            onClick={onNotifyClick}
            className="rounded-full p-1.5 hover:bg-secondary text-muted-foreground"
          >
            <Bell className="h-4 w-4" />
          </button>

          <button
            onClick={toggleTheme}
            className="rounded-full p-1.5 hover:bg-secondary text-muted-foreground"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8 pb-24 md:pb-8 max-w-7xl mx-auto w-full"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </main>

      {/* 모바일 하단 탭 내비게이션 바 (Mobile Bottom Navigation) */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-border bg-card/90 backdrop-blur-md py-2 md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 px-3 py-1 transition-all ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

    </div>
  );
};
