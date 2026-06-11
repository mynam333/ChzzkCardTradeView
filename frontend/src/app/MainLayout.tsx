'use client';

import React from 'react';
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
  Gamepad2
} from 'lucide-react';
import Image from 'next/image';
import { apiFetch } from '@/lib/api';
import { NotificationBell } from './NotificationBell';
import { UserTitleList } from './UserTitleBadge';

type NavItem = { id: TabId; label: string; icon: typeof Home };

const loopIndex = (index: number, length: number) => ((index % length) + length) % length;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeTab, setActiveTab, theme, toggleTheme, user, authLoading, toast } = useApp();
  const dockTouchStartX = React.useRef<number | null>(null);
  const dockTouchStartY = React.useRef<number | null>(null);
  const dockClickSuppressed = React.useRef(false);
  const dockSnapTimer = React.useRef<number | null>(null);
  const [dockDragDelta, setDockDragDelta] = React.useState(0);
  const [dockPressedId, setDockPressedId] = React.useState<TabId | null>(null);
  const [dockIsDragging, setDockIsDragging] = React.useState(false);
  const [dockIsSettling, setDockIsSettling] = React.useState(false);
  const [dockVisualTab, setDockVisualTab] = React.useState<{ tab: TabId; from: TabId } | null>(null);

  React.useEffect(() => () => {
    if (dockSnapTimer.current !== null) window.clearTimeout(dockSnapTimer.current);
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
    { id: 'ranking', label: '실시간 랭킹', icon: TrendingUp },
    { id: 'friends', label: '친구', icon: MessageCircle },
    { id: 'my-info', label: '내 정보', icon: User },
    ...(user?.role === 'ADMIN'
      ? [{ id: 'admin' as TabId, label: '관리자', icon: Shield }]
      : []),
  ];

  const mobileNavOrder: TabId[] = ['inventory', 'shop', 'main', 'ranking', 'friends', 'arcade', 'my-info', 'admin'];
  const mobileNavItems = mobileNavOrder
    .map((id) => navItems.find((item) => item.id === id))
    .filter((item): item is NavItem => Boolean(item));
  const visualTab = dockVisualTab?.from === activeTab ? dockVisualTab.tab : activeTab;
  const activeNavIndex = Math.max(0, mobileNavItems.findIndex((item) => item.id === visualTab));
  const dockSlotWidth = 72;
  const dockRenderedSideSlots = Math.max(8, mobileNavItems.length * 2);
  const dockDragProgress = dockDragDelta / dockSlotWidth;
  const mobileDockItems = Array.from({ length: dockRenderedSideSlots * 2 + 1 }, (_, index) => index - dockRenderedSideSlots).map((offset) => ({
    offset,
    item: mobileNavItems[loopIndex(activeNavIndex + offset, mobileNavItems.length)]
  }));

  const triggerLightHaptic = () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate?.(10);
    }
  };

  const settleMobileDockToOffset = (offset: number) => {
    const targetOffset = offset;
    const nextItem = mobileNavItems[loopIndex(activeNavIndex + targetOffset, mobileNavItems.length)];
    if (!nextItem || nextItem.id === activeTab) return;

    if (dockSnapTimer.current !== null) window.clearTimeout(dockSnapTimer.current);
    dockClickSuppressed.current = true;
    setDockIsDragging(false);
    setDockIsSettling(true);
    setDockDragDelta(-targetOffset * dockSlotWidth);
    triggerLightHaptic();
    window.setTimeout(() => {
      dockClickSuppressed.current = false;
    }, 240);

    dockSnapTimer.current = window.setTimeout(() => {
      setDockVisualTab({ tab: nextItem.id, from: activeTab });
      setActiveTab(nextItem.id);
      setDockDragDelta(0);
      setDockIsSettling(false);
      dockSnapTimer.current = null;
    }, 220);
  };

  const handleDockPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (dockSnapTimer.current !== null) {
      window.clearTimeout(dockSnapTimer.current);
      dockSnapTimer.current = null;
    }
    setDockVisualTab(null);
    dockTouchStartX.current = event.clientX;
    dockTouchStartY.current = event.clientY;
    setDockIsSettling(false);
    setDockIsDragging(true);
    setDockDragDelta(0);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleDockPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (dockTouchStartX.current === null || dockTouchStartY.current === null) return;
    const dx = event.clientX - dockTouchStartX.current;
    const dy = event.clientY - dockTouchStartY.current;
    if (Math.abs(dy) > Math.abs(dx) * 1.35) return;
    setDockDragDelta(dx);
  };

  const finishDockPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (dockTouchStartX.current === null || dockTouchStartY.current === null) return;
    const dx = event.clientX - dockTouchStartX.current;
    const dy = event.clientY - dockTouchStartY.current;
    dockTouchStartX.current = null;
    dockTouchStartY.current = null;
    setDockIsDragging(false);
    setDockPressedId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (Math.abs(dx) >= 24 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      const targetOffset = Math.round(-dx / dockSlotWidth);
      dockClickSuppressed.current = true;
      window.setTimeout(() => {
        dockClickSuppressed.current = false;
      }, 240);
      if (targetOffset !== 0) {
        settleMobileDockToOffset(targetOffset);
        return;
      }
    }

    setDockIsSettling(true);
    setDockDragDelta(0);
    dockSnapTimer.current = window.setTimeout(() => {
      setDockIsSettling(false);
      dockSnapTimer.current = null;
    }, 180);
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
        <div className="mt-auto shrink-0 pt-4 border-t border-border">
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
      <main className="relative mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-4 pb-28 pt-6 md:px-8 md:py-8">
        {children}
        <p className="mx-auto mt-8 max-w-3xl text-center text-[10px] font-bold leading-relaxed text-muted-foreground/80">
          치카포는 비공식 서드파티 서비스이며 네이버/치지직과 제휴 또는 공식 서비스가 아님을 밝힙니다.
        </p>
      </main>

      {/* 모바일 루프형 하단 도크 */}
      <nav
        className="fixed bottom-2 left-0 right-0 z-50 px-3 md:hidden"
        aria-label="모바일 주요 메뉴"
        onPointerDown={handleDockPointerDown}
        onPointerMove={handleDockPointerMove}
        onPointerUp={finishDockPointer}
        onPointerCancel={finishDockPointer}
        style={{ touchAction: 'pan-y' }}
      >
        <div
          className="relative mx-auto w-full overflow-visible"
          style={{
            height: 'calc(7.15rem + env(safe-area-inset-bottom))'
          }}
        >
          <div
            className="cute-surface pointer-events-none absolute inset-x-0 bottom-0 z-0 overflow-hidden border border-white/70 shadow-[0_18px_46px_rgba(20,101,170,0.20)] backdrop-blur-xl dark:border-white/10 dark:shadow-[0_18px_46px_rgba(0,0,0,0.34)]"
            style={{
              height: 'calc(5.15rem + env(safe-area-inset-bottom))',
              borderRadius: '58% 58% 2.35rem 2.35rem / 46% 46% 2.15rem 2.15rem',
              WebkitMaskImage: 'radial-gradient(140% 2.15rem at 50% calc(100% + 1.35rem), transparent 0 54%, #000 56%)',
              maskImage: 'radial-gradient(140% 2.15rem at 50% calc(100% + 1.35rem), transparent 0 54%, #000 56%)'
            }}
          >
            <div className="pointer-events-none absolute inset-x-5 top-1 h-11 rounded-[50%] border-t border-primary/20" />
            <div className="pointer-events-none absolute inset-x-8 bottom-[calc(0.35rem+env(safe-area-inset-bottom))] h-5 rounded-[50%] border-b border-primary/15" />
          </div>
          {mobileDockItems.map(({ item, offset }) => {
            const Icon = item.icon;
            const curvePosition = offset + dockDragProgress;
            const distance = Math.abs(curvePosition);
            const centerWeight = clamp(1 - distance / 0.95, 0, 1);
            const visibleWeight = clamp(1 - Math.max(0, distance - 2.15) / 0.55, 0, 1);
            const x = curvePosition * dockSlotWidth;
            const y = 5 + Math.pow(Math.min(distance, 2.55), 2) * 5.4;
            const iconSize = 40 + centerWeight * 18;
            const iconColorMix = Math.round(centerWeight * 100);
            const iconBgMix = Math.round(18 + centerWeight * 82);
            const isCentered = centerWeight > 0.72;
            const pressScale = dockPressedId === item.id ? 0.94 : 1;

            return (
              <button
                key={`${item.id}-${offset}`}
                onPointerDown={() => setDockPressedId(item.id)}
                onPointerUp={() => setDockPressedId(null)}
                onPointerCancel={() => setDockPressedId(null)}
                onClick={() => {
                  if (dockClickSuppressed.current) return;
                  if (offset === 0) {
                    triggerLightHaptic();
                    setActiveTab(item.id);
                    return;
                  }
                  settleMobileDockToOffset(offset);
                }}
                className={`group absolute left-1/2 top-0.5 flex w-16 flex-col items-center gap-1 rounded-[1.45rem] px-1 pb-1 pt-1.5 ${
                  dockIsDragging ? '' : dockIsSettling ? 'transition-[transform,opacity] duration-200 ease-out' : 'transition-[transform,opacity] duration-150 ease-out'
                }`}
                style={{
                  transform: `translateX(-50%) translateX(${x}px) translateY(${y}px) scale(${pressScale})`,
                  opacity: visibleWeight,
                  pointerEvents: visibleWeight < 0.15 ? 'none' : 'auto',
                  zIndex: Math.round(20 - distance * 4)
                }}
                aria-current={isCentered ? 'page' : undefined}
              >
                <span
                  className="relative flex items-center justify-center rounded-full transition-[width,height,background,color,box-shadow,ring-color] duration-200"
                  style={{
                    width: `${iconSize}px`,
                    height: `${iconSize}px`,
                    color: centerWeight > 0.02
                      ? `color-mix(in srgb, var(--primary-foreground) ${iconColorMix}%, var(--muted-foreground))`
                      : 'var(--muted-foreground)',
                    background: centerWeight > 0.02
                      ? `color-mix(in srgb, var(--primary) ${iconBgMix}%, var(--secondary))`
                      : 'color-mix(in srgb, var(--secondary) 76%, var(--card))',
                    boxShadow: centerWeight > 0.02
                      ? `0 ${Math.round(8 + centerWeight * 9)}px ${Math.round(18 + centerWeight * 22)}px color-mix(in srgb, var(--primary) ${Math.round(12 + centerWeight * 24)}%, transparent)`
                      : '0 4px 10px rgba(15, 80, 130, 0.08)',
                    outline: centerWeight > 0.45 ? '4px solid color-mix(in srgb, var(--primary) 12%, transparent)' : '0 solid transparent'
                  }}
                >
                  <Icon
                    className="transition-[width,height] duration-200"
                    style={{
                      width: `${20 + centerWeight * 5}px`,
                      height: `${20 + centerWeight * 5}px`
                    }}
                  />
                </span>
                <span
                  className="w-full truncate text-center font-black transition-[color,opacity,font-size] duration-200"
                  style={{
                    color: centerWeight > 0.02
                      ? `color-mix(in srgb, var(--foreground) ${Math.round(62 + centerWeight * 38)}%, var(--muted-foreground))`
                      : 'var(--muted-foreground)',
                    fontSize: `${10 + centerWeight * 2}px`,
                    opacity: 0.72 + centerWeight * 0.28
                  }}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

    </div>
  );
};
