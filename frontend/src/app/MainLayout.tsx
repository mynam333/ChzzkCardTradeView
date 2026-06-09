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
    <div className="relative flex min-h-screen w-full flex-col text-foreground md:flex-row">
      <div className="pointer-events-none fixed left-4 top-6 -z-10 hidden h-24 w-24 rounded-full bg-white/55 blur-2xl md:block dark:bg-primary/10" />
      <div className="pointer-events-none fixed bottom-10 right-8 -z-10 hidden h-40 w-40 rounded-full bg-primary/12 blur-3xl md:block dark:bg-primary/10" />
      
      {/* PC Side Navigation (md 이상 브레이크포인트에서 활성화) */}
      <aside className="cute-surface scrollbar-none sticky top-0 z-20 hidden h-screen w-72 flex-col overflow-y-auto overscroll-contain rounded-r-[2rem] border-y-0 border-l-0 px-4 py-6 md:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-white/80 p-1.5 shadow-[0_10px_24px_rgba(22,136,240,0.18)] dark:bg-white/10">
            <Image
              src="/icon.png"
              alt="치카포 로고"
              width={38}
              height={38}
              className="object-contain"
            />
          </div>
          <div className="flex-1">
            <h1 className="cute-display-font cute-outline-soft text-2xl font-black tracking-tight text-foreground">치카포</h1>
            <p className="text-[11px] font-bold text-primary">치지직 카드 포럼</p>
          </div>
          {user && <NotificationBell align="left" />}
        </div>

        {/* 유저 상태 카드 또는 로그인 버튼 */}
        {authLoading ? (
          <div className="mb-6 flex flex-col gap-3 rounded-3xl border border-border bg-secondary/40 p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-secondary" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-2 bg-secondary rounded" />
                <div className="h-2 bg-secondary rounded w-5/6" />
              </div>
            </div>
          </div>
        ) : user ? (
          <div className="cute-card-pop mb-6 rounded-3xl border border-primary/15 bg-gradient-to-br from-white/85 via-secondary/70 to-accent/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:from-white/10 dark:via-secondary/70 dark:to-primary/10">
            <div className="flex items-center gap-3">
              <img src={user.avatarUrl} alt="Avatar" className="h-11 w-11 rounded-2xl border-2 border-white bg-card object-cover shadow-sm dark:border-white/10" />
              <div className="overflow-hidden">
                <p className="truncate text-sm font-black">{user.username}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  <span className="cute-pill inline-block rounded-full px-2 py-0.5 text-[10px] font-black">
                    {user.role}
                  </span>
                  <UserTitleList titles={user.titles} compact />
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
              <span className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
                <Coins className="h-3.5 w-3.5 text-primary" /> 보유 자산
              </span>
              <span className="text-sm font-black text-foreground">{user.point.toLocaleString()} P</span>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-3xl border border-dashed border-primary/30 bg-secondary/55 p-4 text-center">
            <p className="mb-3 text-xs font-bold leading-relaxed text-muted-foreground">간편하게 로그인하고<br />나만의 카드를 소집하세요!</p>
            <button
              onClick={handleLogin}
              className="cute-wiggle-hover w-full rounded-2xl bg-primary py-2.5 text-xs font-black text-primary-foreground shadow-md shadow-primary/20 hover:-translate-y-0.5 hover:bg-primary/95"
            >
              치지직 연동 로그인
            </button>
          </div>
        )}

        <nav className="min-h-0 flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`cute-wiggle-hover flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-bold transition-all duration-200 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20 -translate-y-0.5'
                    : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground hover:translate-x-0.5'
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
            <span className="text-xs font-bold text-muted-foreground">화면 테마</span>
            <button
              onClick={toggleTheme}
              className="rounded-2xl border border-border bg-secondary/70 p-2 text-muted-foreground hover:-translate-y-0.5 hover:text-foreground"
              title="테마 전환"
            >
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>

      {/* 모바일 상단 바 (Mobile Top Bar) */}
      <header className="cute-surface sticky top-0 z-40 mx-3 mt-3 flex items-center justify-between rounded-3xl px-4 py-3.5 md:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 p-1 shadow-sm dark:bg-white/10">
            <Image
              src="/icon.png"
              alt="치카포 로고"
              width={32}
              height={32}
              className="object-contain"
            />
          </span>
          <div className="flex min-w-0 flex-col justify-center leading-none">
            <span className="cute-loading-logo truncate text-[1.62rem] font-black tracking-tight">치카포</span>
            <span className="mt-1 truncate text-[0.68rem] font-bold text-muted-foreground">치지직 카드 포럼</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <div className="cute-pill flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black">
              <Coins className="h-3.5 w-3.5" />
              <span>{user.point.toLocaleString()}</span>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="cute-wiggle-hover rounded-full bg-primary px-3 py-1 text-[11px] font-black text-primary-foreground shadow-sm hover:bg-primary/95"
            >
              로그인
            </button>
          )}
          
          {user && <NotificationBell />}

          <button
            onClick={toggleTheme}
            className="rounded-full border border-border bg-secondary/70 p-1.5 text-muted-foreground hover:text-foreground"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className="relative mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-4 pb-24 pt-6 md:px-8 md:py-8"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {children}
        <p className="mx-auto mt-8 max-w-3xl text-center text-[10px] font-bold leading-relaxed text-muted-foreground/80">
          치카포는 비공식 서드파티 서비스이며 네이버/치지직과 제휴 또는 공식 서비스가 아님을 밝힙니다.
        </p>
      </main>

      {/* 모바일 하단 탭 내비게이션 바 (Mobile Bottom Navigation) */}
      <nav className="cute-surface fixed bottom-3 left-3 right-3 z-50 flex items-center justify-center rounded-[2rem] px-1.5 py-2 backdrop-blur-md md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`cute-wiggle-hover flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-1.5 transition-all ${
                isActive ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground'
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
