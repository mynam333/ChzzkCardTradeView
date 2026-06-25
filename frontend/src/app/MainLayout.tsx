'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useApp, TabId } from './AppContext';
import {
  Home,
  Layers,
  TrendingUp,
  User,
  MessageCircle,
  Sun,
  Moon,
  Coins,
  Shield,
  Store,
  Gamepad2,
  Award,
  Swords
} from 'lucide-react';
import Image from 'next/image';
import { apiFetch } from '@/lib/api';
import { NotificationBell } from './NotificationBell';
import { UserTitleList } from './UserTitleBadge';
import { MobileLoopDock } from './MobileLoopDock';

type NavItem = { id: TabId; label: string; icon: typeof Home };

const LOGO_EASTER_EGG_SESSION_KEY = 'chikapo:easter-egg:logo-clicks';
const LOGO_EASTER_EGG_REQUIRED_CLICKS = 9;
const LOGO_EASTER_EGG_WINDOW_MS = 3600;
const LOGO_EASTER_EGG_MAX_GAP_MS = 520;

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeTab, setActiveTab, theme, toggleTheme, user, authLoading, toast } = useApp();
  const router = useRouter();
  const logoEasterEggClicks = React.useRef<number[]>([]);
  const logoEasterEggPulseTimer = React.useRef<number | null>(null);
  const [logoEasterEggPulse, setLogoEasterEggPulse] = React.useState(false);

  React.useEffect(() => () => {
    if (logoEasterEggPulseTimer.current !== null) window.clearTimeout(logoEasterEggPulseTimer.current);
  }, []);

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

  const navItems: NavItem[] = [
    { id: 'main', label: '메인', icon: Home },
    { id: 'shop', label: '상점', icon: Store },
    { id: 'inventory', label: '보관함', icon: Layers },
    { id: 'arcade', label: '미니게임', icon: Gamepad2 },
    { id: 'achievements', label: '업적', icon: Award },
    { id: 'ranking', label: '실시간 랭킹', icon: TrendingUp },
    { id: 'friends', label: '친구', icon: MessageCircle },
    { id: 'my-info', label: '내 정보', icon: User },
    ...(user?.role === 'ADMIN'
      ? [{ id: 'admin' as TabId, label: '관리자', icon: Shield }]
      : []),
  ];
  const arenaNavItem: NavItem = { id: 'arena', label: '아레나', icon: Swords };

  const mobileNavOrder: TabId[] = ['inventory', 'shop', 'main', 'arena', 'achievements', 'ranking', 'friends', 'arcade', 'my-info', 'admin'];
  const mobileNavItems = mobileNavOrder
    .map((id) => id === 'arena' ? arenaNavItem : navItems.find((item) => item.id === id))
    .filter((item): item is NavItem => Boolean(item));

  const handleDesktopLogoClick = () => {
    setActiveTab('main');
    const now = Date.now();
    let persistedClicks: number[] = [];
    try {
      persistedClicks = JSON.parse(window.sessionStorage.getItem(LOGO_EASTER_EGG_SESSION_KEY) || '[]') as number[];
    } catch {
      persistedClicks = [];
    }
    const previousClicks = [...logoEasterEggClicks.current, ...persistedClicks]
      .filter((time, index, all) => Number.isFinite(time) && now - time <= LOGO_EASTER_EGG_WINDOW_MS && all.indexOf(time) === index)
      .sort((a, b) => a - b);
    const lastClick = previousClicks.at(-1);
    const clicks = lastClick && now - lastClick > LOGO_EASTER_EGG_MAX_GAP_MS
      ? [now]
      : [...previousClicks, now];
    if (clicks.length >= LOGO_EASTER_EGG_REQUIRED_CLICKS) {
      logoEasterEggClicks.current = [];
      try { window.sessionStorage.removeItem(LOGO_EASTER_EGG_SESSION_KEY); } catch { /* ignore */ }
      setLogoEasterEggPulse(true);
      if (logoEasterEggPulseTimer.current !== null) window.clearTimeout(logoEasterEggPulseTimer.current);
      logoEasterEggPulseTimer.current = window.setTimeout(() => {
        setLogoEasterEggPulse(false);
        logoEasterEggPulseTimer.current = null;
      }, 420);
      window.dispatchEvent(new CustomEvent('chikapo:easter-egg-command', {
        detail: { command: 'themeToggle' }
      }));
      return;
    }
    logoEasterEggClicks.current = clicks;
    try { window.sessionStorage.setItem(LOGO_EASTER_EGG_SESSION_KEY, JSON.stringify(clicks)); } catch { /* ignore */ }
  };

  return (
    <div className="main-layout-shell relative flex min-h-screen w-full flex-col text-foreground md:flex-row">
      <div className="pointer-events-none fixed left-4 top-6 -z-10 hidden h-24 w-24 rounded-full bg-white/55 blur-2xl md:block dark:bg-primary/10" />
      <div className="pointer-events-none fixed bottom-10 right-8 -z-10 hidden h-40 w-40 rounded-full bg-primary/12 blur-3xl md:block dark:bg-primary/10" />
      
      {/* PC Side Navigation (md 이상 브레이크포인트에서 활성화) */}
      <aside className="main-layout-sidebar cute-surface scrollbar-none sticky top-0 z-20 hidden h-screen w-72 flex-col overflow-y-auto overscroll-contain rounded-r-[2rem] border-y-0 border-l-0 px-4 py-6 md:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <button
            type="button"
            onClick={handleDesktopLogoClick}
            className="flex min-w-0 flex-1 appearance-none items-center gap-3 border-0 bg-transparent p-0 text-left"
            aria-label="메인 페이지로 이동"
          >
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-white/80 p-1.5 shadow-[0_10px_24px_rgba(22,136,240,0.18)] dark:bg-white/10 ${logoEasterEggPulse ? 'easter-egg-logo-pulse' : ''}`}>
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
          </button>
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

        <nav className="shrink-0 space-y-1">
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
        <div className="mt-auto shrink-0 space-y-3 pt-4 border-t border-border">
          <button
            type="button"
            onClick={() => router.push('/arena')}
            className="cute-wiggle-hover flex w-full items-center gap-3 rounded-2xl border border-primary/20 bg-white/70 px-3 py-2.5 text-sm font-black text-foreground shadow-sm hover:-translate-y-0.5 hover:bg-secondary/70 dark:bg-white/10"
          >
            <Swords className="h-4.5 w-4.5 text-primary" />
            <span className="min-w-0">
              <span className="block truncate">아레나로 이동</span>
              <span className="block truncate text-[10px] font-bold text-muted-foreground">치카포 기반 듀얼 게임</span>
            </span>
          </button>
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
      <header className="main-layout-mobile-header cute-surface sticky top-0 z-40 mx-3 mt-3 flex items-center justify-between rounded-3xl px-4 py-3.5 md:hidden">
        <button
          type="button"
          onClick={() => setActiveTab('main')}
          className="flex min-w-0 appearance-none items-center gap-2.5 border-0 bg-transparent p-0 text-left"
          aria-label="메인 페이지로 이동"
        >
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
        </button>

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
      <main className="main-layout-content relative mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-4 pb-28 pt-6 md:px-8 md:py-8">
        {children}
        <p className="mx-auto mt-8 max-w-3xl text-center text-[10px] font-bold leading-relaxed text-muted-foreground/80">
          치카포는 비공식 서드파티 서비스이며 네이버/치지직과 제휴 또는 공식 서비스가 아님을 밝힙니다.
        </p>
      </main>

      <MobileLoopDock
        items={mobileNavItems}
        activeId={activeTab}
        ariaLabel="모바일 주요 메뉴"
        dataAttribute="mobile-dock"
        onSelect={(id) => setActiveTab(id)}
      />

    </div>
  );
};

