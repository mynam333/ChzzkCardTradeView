'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, isAuthed, clearAuthFlag } from '@/lib/api';
import { registerServiceWorker, subscribeToPush, isPushSupported } from '@/lib/push';

export type TabId = 'main' | 'shop' | 'inventory' | 'ranking' | 'my-info' | 'admin' | 'arcade';

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
    drawCost: number;
    freeDrawInterval: number;
    isFreeDrawEligible: boolean;
    nextFreeDrawAt: string | null;
  } | null;
  authLoading: boolean;
  setUser: React.Dispatch<React.SetStateAction<AppContextType['user']>>;
  logout: () => void;
  refreshUserData: (showLoading?: boolean) => Promise<void>;
  updatePoints: (diff: number) => Promise<void>;
  // 전역 토스트 알림 (alert 대체)
  toast: (message: string, type?: ToastType) => void;
  // 인앱 알림함
  notifications: AppNotificationItem[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  openNotification: (n: AppNotificationItem) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  maintenanceActive: boolean | null;
  maintenanceStartAt: string | null;
  maintenanceEndAt: string | null;
  checkMaintenanceStatus: () => Promise<void>;
}

type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }
export interface AppNotificationItem {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at?: string;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const SwipeableToast: React.FC<{
  toast: ToastItem;
  onDismiss: (id: number) => void;
}> = ({ toast, onDismiss }) => {
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const dismissedRef = useRef(false);

  const threshold = 120; // 스와이프로 치우는 임계 거리 (px)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dismissedRef.current) return;
    setIsDragging(true);
    startXRef.current = e.clientX - dragX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || dismissedRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    setDragX(deltaX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (Math.abs(dragX) > threshold) {
      dismissedRef.current = true;
      const direction = dragX > 0 ? 1 : -1;
      // 자연스럽게 옆으로 휙 밀려나며 화면 밖으로 날아가도록 유도
      setDragX(direction * 400);
      setTimeout(() => {
        onDismiss(toast.id);
      }, 150);
    } else {
      setDragX(0);
    }
  };

  const tone =
    toast.type === 'success' ? 'bg-emerald-600'
    : toast.type === 'error' ? 'bg-rose-600'
    : toast.type === 'warning' ? 'bg-amber-500'
    : 'bg-sky-600';

  const style: React.CSSProperties = {
    transform: `translateX(${dragX}px)`,
    opacity: Math.max(0, 1 - Math.abs(dragX) / threshold),
    transition: isDragging ? 'none' : 'transform 0.2s ease-out, opacity 0.2s ease-out',
    touchAction: 'none' // 터치 중 스크롤 방지
  };

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={style}
      className={`pointer-events-auto rounded-xl px-4 py-3 text-xs font-bold text-white shadow-lg ring-1 ring-black/10 animate-in fade-in slide-in-from-top-2 duration-200 whitespace-pre-line cursor-grab active:cursor-grabbing select-none ${tone}`}
    >
      {toast.message}
    </div>
  );
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();

  const [theme, setTheme] = useState<'light' | 'dark'>('dark'); // 기본 다크모드 선호

  // URL 경로를 기반으로 활성화된 탭 상태를 유도
  const activeTab: TabId = (() => {
    if (pathname.startsWith('/shop')) return 'shop';
    if (pathname.startsWith('/inventory')) return 'inventory';
    if (pathname.startsWith('/ranking')) return 'ranking';
    if (pathname.startsWith('/my-info')) return 'my-info';
    if (pathname.startsWith('/admin')) return 'admin';
    if (pathname.startsWith('/arcade')) return 'arcade';
    return 'main';
  })();


  const setActiveTab = (tab: TabId) => {
    const route = tab === 'main' ? '/' : `/${tab}`;
    router.push(route);
  };
  const [user, setUser] = useState<AppContextType['user']>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true); // 초기 인증 검증 완료 상태 대기

  const [maintenanceActive, setMaintenanceActive] = useState<boolean | null>(null);
  const [maintenanceStartAt, setMaintenanceStartAt] = useState<string | null>(null);
  const [maintenanceEndAt, setMaintenanceEndAt] = useState<string | null>(null);

  const checkMaintenanceStatus = async () => {
    try {
      const res = await apiFetch('/maintenance/status');
      if (res.ok) {
        const data = await res.json();
        setMaintenanceActive(!!data.active);
        setMaintenanceStartAt(data.startAt || null);
        setMaintenanceEndAt(data.endAt || null);
      } else {
        if (maintenanceActive === null) {
          setMaintenanceActive(false);
        }
      }
    } catch (err) {
      console.error('[AppContext] 점검 상태 조회 실패:', err);
      if (maintenanceActive === null) {
        setMaintenanceActive(false);
      }
    }
  };

  // 점검 상태 주기적 폴링 (30초) 및 초기 조회
  useEffect(() => {
    checkMaintenanceStatus();
    const timer = setInterval(checkMaintenanceStatus, 30_000);
    return () => clearInterval(timer);
  }, []);

  // 미어드민 유저 점검 강제 리디렉션 가드
  useEffect(() => {
    if (authLoading || maintenanceActive === null) return;

    const isMaintenanceRoute = pathname === '/maintenance';
    const isLoginRoute = pathname === '/login';
    const isCallbackRoute = pathname === '/auth/chzzk/callback';

    if (isLoginRoute || isCallbackRoute) {
      return;
    }

    if (maintenanceActive) {
      if (user?.role === 'ADMIN') {
        return;
      }
      if (!isMaintenanceRoute) {
        router.replace('/maintenance');
      }
    } else {
      if (isMaintenanceRoute) {
        router.replace('/');
      }
    }
  }, [maintenanceActive, user, authLoading, pathname, router]);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const toast = (message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200);
  };
  const askedPushRef = useRef(false); // 알림 권한 자동 요청 1회만

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
  }, []);

  // 로그인한 유저에게만 첫 상호작용 시 알림 권한을 요청합니다.
  useEffect(() => {
    if (!user || askedPushRef.current || !isPushSupported() || Notification.permission !== 'default') return;

    const handleFirstGesture = async () => {
      askedPushRef.current = true;
      try { await subscribeToPush(); } catch { /* 권한 거부/실패 무시 */ }
      window.removeEventListener('pointerdown', handleFirstGesture);
    };
    window.addEventListener('pointerdown', handleFirstGesture);

    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
    };
  }, [user?.id]);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  };

  const logout = () => {
    // 서버 측 httpOnly 세션 쿠키 제거 요청 (응답 대기 불필요)
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => { /* noop */ });
    clearAuthFlag();
    setUser(null);
    setActiveTab('main');
    toast('로그아웃되었습니다.', 'info');
  };

  const refreshUserData = async (showLoading = false) => {
    if (!isAuthed()) {
      setUser(null);
      setAuthLoading(false);
      return;
    }
    // 최초 로드 시점이거나 명시적으로 지시한 경우에만 로딩 스켈레톤 활성화 (깜빡임 방지)
    if (showLoading || !user) {
      setAuthLoading(true);
    }
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
          representativeCardChannelId: data.representativeCardChannelId ?? null,
          drawCost: data.drawCost ?? 10000,
          freeDrawInterval: data.freeDrawInterval ?? 24,
          isFreeDrawEligible: !!data.isFreeDrawEligible,
          nextFreeDrawAt: data.nextFreeDrawAt ?? null
        });
      } else if (response.status === 401) {
        // 만료되었거나 비정상적인 세션인 경우 로그아웃 처리
        clearAuthFlag();
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

  // ---- 인앱 알림함 ----
  const fetchNotifications = async () => {
    if (!isAuthed()) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const res = await apiFetch('/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.items || []);
        setUnreadCount(data.unread || 0);
      }
    } catch (e) {
      console.error('[AppContext] 알림 조회 실패:', e);
    }
  };

  const openNotification = async (n: AppNotificationItem) => {
    // 읽음 처리 (낙관적 갱신)
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try { await apiFetch(`/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* 무시 */ }
    }
    // 연관 위치로 이동
    if (n.link && ['main', 'shop', 'inventory', 'ranking', 'my-info', 'admin'].includes(n.link)) {
      setActiveTab(n.link as TabId);
    }
  };

  const markAllNotificationsRead = async () => {
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnreadCount(0);
    try { await apiFetch('/notifications/read-all', { method: 'POST' }); } catch { /* 무시 */ }
  };

  // 로그인 상태에서 알림 주기적 폴링 (30초)
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(timer);
  }, [user?.id]);

  // 초기화 진행 상태 정의 (점검 상태 미확정이거나 로그인 인증 확인 대기 중일 때)
  const isInitializing = maintenanceActive === null || (isAuthed() && authLoading);

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
      toast,
      notifications,
      unreadCount,
      fetchNotifications,
      openNotification,
      markAllNotificationsRead,
      maintenanceActive,
      maintenanceStartAt,
      maintenanceEndAt,
      checkMaintenanceStatus
    }}>
      {isInitializing ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground select-none">
          {/* 은은한 탑 오로라 글로우 */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-primary/10 blur-[80px] pointer-events-none"></div>

          <div className="flex flex-col items-center space-y-6 relative z-10">
            <div className="relative flex h-24 w-24 items-center justify-center">
              {/* 외부 핑 애니메이션 링 */}
              <div className="absolute h-full w-full animate-ping rounded-full bg-primary/5 opacity-75 duration-[1800ms]"></div>
              {/* 중간 스핀 로더 */}
              <div className="absolute h-18 w-18 animate-spin rounded-full border-[3px] border-primary/10 border-t-primary"></div>
              {/* 중앙 로고 표식 */}
              <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-card p-1.5 shadow-md shadow-primary/20 border border-primary/20">
                <img
                  src="/favicon.ico"
                  alt="CCTV"
                  className="h-8 w-8 object-contain"
                />
              </div>
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-black tracking-widest bg-gradient-to-r from-blue-400 via-indigo-400 to-primary bg-clip-text text-transparent animate-pulse">
                CCTV
              </h1>
              <p className="text-[11px] font-medium text-muted-foreground tracking-wide">
                치지직 카드 트레이드 뷰를 불러오는 중입니다...
              </p>
            </div>
          </div>
        </div>
      ) : (
        children
      )}

      {/* 전역 토스트 컨테이너 */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <SwipeableToast
            key={t.id}
            toast={t}
            onDismiss={(id) => setToasts((prev) => prev.filter((item) => item.id !== id))}
          />
        ))}
      </div>
    </AppContext.Provider>
  );
};


export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
