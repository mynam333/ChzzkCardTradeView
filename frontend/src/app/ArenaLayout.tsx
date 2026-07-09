'use client';

import React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, BadgeCheck, BookOpen, Layers, Coins, Home, Moon, ShieldCheck, Store, Sun, Swords, Trophy } from 'lucide-react';
import { useApp } from './AppContext';
import { NotificationBell } from './NotificationBell';
import { UserTitleList } from './UserTitleBadge';
import type { ArenaSiteTab } from './arena/types';
import { apiFetch } from '@/lib/api';
import { MobileLoopDock, type MobileLoopDockItem } from './MobileLoopDock';

type ArenaNavItem = {
  id: ArenaSiteTab;
  label: string;
  icon: typeof Swords;
};

type ArenaMobileDockId = ArenaSiteTab | 'chikapo';

export const ArenaLayout: React.FC<{
  activeTab: ArenaSiteTab;
  onTabChange: (tab: ArenaSiteTab) => void;
  children: React.ReactNode;
  immersive?: boolean;
}> = ({ activeTab, onTabChange, children, immersive = false }) => {
  const router = useRouter();
  const { user, authLoading, theme, toggleTheme, toast } = useApp();
  const [hasStreamerCardAccess, setHasStreamerCardAccess] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    setHasStreamerCardAccess(false);
    if (!user || authLoading) return () => { alive = false; };
    void apiFetch('/arena/streamer-card/me')
      .then((response) => {
        if (!alive) return;
        setHasStreamerCardAccess(response.ok);
      })
      .catch(() => {
        if (alive) setHasStreamerCardAccess(false);
      });
    return () => { alive = false; };
  }, [authLoading, user?.id]);

  const navItems: ArenaNavItem[] = [
    { id: 'play', label: '플레이', icon: Swords },
    { id: 'inventory', label: '보관함', icon: Layers },
    { id: 'ranking', label: 'MMR 랭킹', icon: Trophy },
    { id: 'wiki', label: '위키', icon: BookOpen },
    { id: 'style', label: '스타일 상점', icon: Store },
    ...(hasStreamerCardAccess ? [{ id: 'my-card' as const, label: '내 카드', icon: BadgeCheck }] : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'admin' as const, label: '관리자', icon: ShieldCheck }] : [])
  ];
  const mobileDockItems: MobileLoopDockItem<ArenaMobileDockId>[] = [
    { id: 'inventory', label: '보관함', icon: Layers },
    { id: 'wiki', label: '위키', icon: BookOpen },
    { id: 'style', label: '스타일', icon: Store },
    { id: 'play', label: '플레이', icon: Swords },
    { id: 'ranking', label: '랭킹', icon: Trophy },
    ...(hasStreamerCardAccess ? [{ id: 'my-card' as const, label: '내 카드', icon: BadgeCheck }] : []),
    ...(user?.role === 'ADMIN' ? [{ id: 'admin' as const, label: '관리자', icon: ShieldCheck }] : []),
    { id: 'chikapo', label: '치카포', icon: Home }
  ];

  const goChikapo = () => router.push('/');
  const handleLogin = async () => {
    try {
      const redirectUri = `${window.location.origin}/auth/chzzk/callback`;
      const response = await apiFetch(`/auth/chzzk/url?redirect_uri=${encodeURIComponent(redirectUri)}`);
      if (!response.ok) throw new Error('로그인 URL 획득 실패');
      const data = await response.json();
      if (data.auth_url) {
        window.location.href = data.auth_url;
      }
    } catch (error) {
      console.error(error);
      toast('치지직 로그인 주소 요청 중 에러가 발생했습니다.', 'error');
    }
  };

  return (
    <div className={`main-layout-shell arena-site-shell relative flex min-h-screen w-full flex-col text-foreground md:flex-row ${immersive ? 'arena-site-shell-immersive' : ''}`}>
      {immersive ? null : (
      <aside className="main-layout-sidebar arena-site-sidebar cute-surface scrollbar-none sticky top-0 z-20 hidden h-screen w-72 flex-col overflow-y-auto overscroll-contain rounded-r-[2rem] border-y-0 border-l-0 px-4 py-6 md:flex">
        <div className="mb-6 flex items-center gap-3 px-2">
          <button type="button" onClick={() => onTabChange('play')} className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 text-left">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-white/80 p-1.5 shadow-[0_10px_24px_rgba(244,63,94,0.18)] dark:bg-white/10">
              <Image src="/arena-icon.png" alt="치카포 아레나" width={38} height={38} className="object-contain" />
            </div>
            <div className="min-w-0">
              <h1 className="cute-display-font cute-outline-soft truncate text-2xl font-black tracking-tight text-foreground">아레나</h1>
              <p className="text-[11px] font-bold text-primary">치카포 기반 듀얼 게임</p>
            </div>
          </button>
          {user ? <NotificationBell align="left" /> : null}
        </div>

        {authLoading ? (
          <div className="mb-6 h-24 animate-pulse rounded-3xl border border-border bg-secondary/40" />
        ) : user ? (
          <div className="cute-card-pop mb-5 rounded-3xl border border-primary/15 bg-gradient-to-br from-white/85 via-rose-50/80 to-red-50/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:from-white/10 dark:via-secondary/70 dark:to-primary/10">
            <div className="flex items-center gap-3">
              <img src={user.avatarUrl} alt="Avatar" className="h-11 w-11 rounded-2xl border-2 border-white bg-card object-cover shadow-sm dark:border-white/10" />
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{user.username}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  <span className="cute-pill inline-block rounded-full px-2 py-0.5 text-[10px] font-black">{user.role}</span>
                  <UserTitleList titles={user.titles} compact />
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
              <span className="flex items-center gap-1 text-xs font-bold text-muted-foreground"><Coins className="h-3.5 w-3.5 text-primary" /> 포인트</span>
              <span className="text-sm font-black">{user.point.toLocaleString()} P</span>
            </div>
          </div>
        ) : (
          <div className="mb-6 rounded-3xl border border-dashed border-primary/30 bg-secondary/55 p-4 text-center">
            <p className="mb-3 text-xs font-bold leading-relaxed text-muted-foreground">로그인하면 아레나 덱과<br />스타일을 관리할 수 있습니다.</p>
            <button
              type="button"
              onClick={handleLogin}
              className="arena-primary-cta cute-wiggle-hover w-full rounded-2xl bg-primary py-2.5 text-xs font-black text-primary-foreground shadow-md shadow-primary/20 hover:-translate-y-0.5 hover:bg-primary/95"
            >
              치지직 연동 로그인
            </button>
          </div>
        )}

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
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

        <div className="mt-auto space-y-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={goChikapo}
            className="cute-wiggle-hover flex w-full items-center gap-3 rounded-2xl border border-border bg-white/64 px-3 py-2.5 text-sm font-black text-foreground shadow-sm hover:-translate-y-0.5 dark:bg-white/10"
          >
            <ArrowLeftRight className="h-4.5 w-4.5 text-primary" />
            <span className="min-w-0">
              <span className="block truncate">치카포로 이동</span>
              <span className="block truncate text-[10px] font-bold text-muted-foreground">치지직 카드 포럼</span>
            </span>
          </button>
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-bold text-muted-foreground">화면 테마</span>
            <button onClick={toggleTheme} className="rounded-2xl border border-border bg-secondary/70 p-2 text-muted-foreground hover:-translate-y-0.5 hover:text-foreground">
              {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>
      )}

      {immersive ? null : (
      <header className="main-layout-mobile-header cute-surface sticky top-0 z-40 mx-3 mt-3 flex items-center justify-between rounded-3xl px-4 py-3.5 md:hidden">
        <button type="button" onClick={() => onTabChange('play')} className="flex min-w-0 items-center gap-2.5 border-0 bg-transparent p-0 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 p-1 shadow-sm dark:bg-white/10">
            <Image src="/arena-icon.png" alt="아레나" width={32} height={32} className="object-contain" />
          </span>
          <span className="min-w-0">
            <span className="cute-loading-logo block truncate text-[1.5rem] font-black tracking-tight">아레나</span>
            <span className="block truncate text-[0.68rem] font-bold text-muted-foreground">치카포 기반 듀얼 게임</span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={goChikapo} className="rounded-full border border-border bg-secondary/70 px-3 py-1.5 text-[11px] font-black text-foreground">
            치카포
          </button>
          <button onClick={toggleTheme} className="rounded-full border border-border bg-secondary/70 p-1.5 text-muted-foreground hover:text-foreground">
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      </header>
      )}

      <main className={`main-layout-content relative mx-auto w-full flex-1 overflow-y-auto ${immersive ? 'max-w-none px-0 py-0 pb-0' : 'max-w-7xl px-4 pt-6 pb-28 md:px-8 md:py-8'}`}>
        {children}
      </main>

      {immersive ? null : (
        <MobileLoopDock
          items={mobileDockItems}
          activeId={activeTab}
          ariaLabel="아레나 모바일 메뉴"
          surfaceShadowClassName="shadow-[0_18px_46px_rgba(159,18,57,0.18)] dark:shadow-[0_18px_46px_rgba(0,0,0,0.34)]"
          onSelect={(id) => {
            if (id === 'chikapo') {
              goChikapo();
              return;
            }
            onTabChange(id);
          }}
        />
      )}
    </div>
  );
};

