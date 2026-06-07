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
  Coins,
  Shield,
  Store,
  Gamepad2
} from 'lucide-react';
import Image from 'next/image';
import { apiFetch } from '@/lib/api';
import { NotificationBell } from './NotificationBell';
import { UserTitleList } from './UserTitleBadge';

interface NavigationProps {
  onNotifyClick?: () => void;
}

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeTab, setActiveTab, theme, toggleTheme, user, authLoading, toast } = useApp();
  const touchStartX = React.useRef<number | null>(null);
  const touchStartY = React.useRef<number | null>(null);
  const touchStartTime = React.useRef<number>(0);

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
      toast('치지직 로그인 주소 요청 중 에러가 발생했습니다.', 'error');
    }
  };

  const navItems: { id: TabId; label: string; icon: typeof Home }[] = [
    { id: 'main', label: '메인', icon: Home },
    { id: 'shop', label: '상점', icon: Store },
    { id: 'inventory', label: '보관함', icon: Layers },
    { id: 'arcade', label: '미니게임', icon: Gamepad2 },
    { id: 'ranking', label: '실시간 랭킹', icon: TrendingUp },
    { id: 'my-info', label: '내 정보', icon: User },
    ...(user?.role === 'ADMIN'
      ? [{ id: 'admin' as TabId, label: '관리자', icon: Shield }]
      : []),
  ];

  // 모바일 좌우 스와이프로 탭 전환 (오작동 방지를 위해 둔감하게 조정)
  const SWIPE_MIN_DISTANCE = 110;   // 최소 가로 이동 거리(px)
  const SWIPE_MAX_DURATION = 700;   // 너무 느린(스크롤성) 제스처 제외(ms)
  const SWIPE_HORIZONTAL_RATIO = 2; // 가로 이동이 세로보다 충분히 커야 함

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    const dt = Date.now() - touchStartTime.current;
    touchStartX.current = null;
    touchStartY.current = null;

    // 1) 충분히 길고 빠른 가로 스와이프만 인정, 2) 세로 이동(스크롤) 대비 가로가 우세할 때만
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;
    if (dt > SWIPE_MAX_DURATION) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_RATIO) return;

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
            alt="치카포 로고"
            width={36}
            height={36}
            className="rounded-lg shadow-md object-contain"
          />
          <div className="flex-1">
            <h1 className="text-lg font-bold tracking-tight text-foreground">치카포</h1>
            <p className="text-xs text-muted-foreground">치지직 카드 포럼</p>
          </div>
          {user && <NotificationBell align="left" />}
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
              <img src={user.avatarUrl} alt="Avatar" className="h-10 w-10 rounded-full border border-primary/20 bg-card object-cover" />
              <div className="overflow-hidden">
                <p className="truncate text-sm font-semibold">{user.username}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {user.role}
                  </span>
                  <UserTitleList titles={user.titles} compact />
                </div>
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

        {/* 테마 스위치 */}
        <div className="mt-auto pt-4 border-t border-border">
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
            alt="치카포 로고"
            width={28} 
            height={28} 
            className="rounded"
          />
          <span className="font-bold text-foreground">치카포</span>
          <span className="text-[0.65rem] text-muted-foreground self-end mb-[0.1rem]">치지직 카드 포럼</span>
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
          
          {user && <NotificationBell />}

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
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center border-t border-border bg-card/90 backdrop-blur-md py-2 md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-1 transition-all min-w-0 ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium truncate w-full text-center">{item.label}</span>
            </button>
          );
        })}
      </nav>

    </div>
  );
};
