'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch, isAuthed, clearAuthFlag } from '@/lib/api';
import { registerServiceWorker, subscribeToPush, isPushSupported } from '@/lib/push';
import { Toaster, toast as sonnerToast } from 'sonner';
import { AlertModal } from './AlertModal';
import { CheckCircle, AlertTriangle, XCircle, Info } from 'lucide-react';

export type TabId = 'main' | 'shop' | 'inventory' | 'ranking' | 'my-info' | 'admin' | 'arcade';

// -----------------------------------------------------------------------------
// 1. Theme Context & Provider (테마 관리 전용)
// -----------------------------------------------------------------------------
interface ThemeContextType {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// -----------------------------------------------------------------------------
// 2. Toast Context & Provider (sonner 기반 - 리렌더링 완벽 방어 및 좌우 스와이프 지원)
// -----------------------------------------------------------------------------
type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}
const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

interface CustomToastProps {
  id: string | number;
  message: string;
  type: ToastType;
  theme: 'light' | 'dark';
}

const CustomToast: React.FC<CustomToastProps> = ({ id, message, type, theme }) => {
  const [startX, setStartX] = useState<number | null>(null);
  const [currentX, setCurrentX] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isDismissing, setIsDismissing] = useState<boolean>(false);
  const [dismissDirection, setDismissDirection] = useState<'left' | 'right' | null>(null);

  const dragThreshold = 80;

  const handleStart = (clientX: number) => {
    setStartX(clientX);
    setIsDragging(true);
  };

  const handleMove = (clientX: number) => {
    if (startX === null || isDismissing) return;
    const diff = clientX - startX;
    setCurrentX(diff);
  };

  const handleEnd = () => {
    if (startX === null || isDismissing) return;
    setIsDragging(false);

    if (Math.abs(currentX) > dragThreshold) {
      setIsDismissing(true);
      setDismissDirection(currentX > 0 ? 'right' : 'left');
      setTimeout(() => {
        sonnerToast.dismiss(id);
      }, 200);
    } else {
      setCurrentX(0);
    }
    setStartX(null);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    handleStart(e.clientX);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      handleMove(moveEvent.clientX);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      handleEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const typeConfig = {
    success: {
      icon: <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />,
      border: 'border-emerald-500/20 dark:border-emerald-500/30',
      bg: 'bg-emerald-50/95 dark:bg-emerald-950/90',
      text: 'text-emerald-900 dark:text-emerald-100',
    },
    error: {
      icon: <XCircle className="h-5 w-5 text-rose-500 shrink-0" />,
      border: 'border-rose-500/20 dark:border-rose-500/30',
      bg: 'bg-rose-50/95 dark:bg-rose-950/90',
      text: 'text-rose-900 dark:text-rose-100',
    },
    warning: {
      icon: <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />,
      border: 'border-amber-500/20 dark:border-amber-500/30',
      bg: 'bg-amber-50/95 dark:bg-amber-950/90',
      text: 'text-amber-900 dark:text-amber-100',
    },
    info: {
      icon: <Info className="h-5 w-5 text-blue-500 shrink-0" />,
      border: 'border-blue-500/20 dark:border-blue-500/30',
      bg: 'bg-blue-50/95 dark:bg-blue-950/90',
      text: 'text-blue-900 dark:text-blue-100',
    },
  };

  const config = typeConfig[type];

  const translateX = isDismissing 
    ? (dismissDirection === 'right' ? '150%' : '-150%') 
    : `${currentX}px`;

  const opacity = isDismissing 
    ? 0 
    : Math.max(0.1, 1 - Math.abs(currentX) / 300);

  const style: React.CSSProperties = {
    transform: `translateX(${translateX})`,
    opacity,
    transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
    touchAction: 'none',
    userSelect: 'none',
  };

  return (
    <div
      style={style}
      onMouseDown={handleMouseDown}
      onTouchStart={(e) => handleStart(e.touches[0].clientX)}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      onTouchEnd={handleEnd}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md w-[340px] max-w-sm cursor-grab active:cursor-grabbing pointer-events-auto select-none ${config.bg} ${config.border} ${config.text}`}
    >
      {config.icon}
      <p className="text-sm font-medium leading-relaxed break-keep select-none">{message}</p>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { theme } = useTheme();
  const themeRef = useRef(theme);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  const toast = useRef((message: string, type: ToastType = 'info') => {
    sonnerToast.custom((t) => (
      <CustomToast id={t} message={message} type={type} theme={themeRef.current} />
    ), {
      unstyled: true,
      duration: 5000,
    });
  }).current;

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <Toaster 
        position="top-center" 
        theme={theme}
      />
    </ToastContext.Provider>
  );
};

// -----------------------------------------------------------------------------
// 3. Notification Context & Provider (알림함 전용 - Polling 부하 격리)
// -----------------------------------------------------------------------------
export interface AppNotificationItem {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at?: string;
}

interface NotificationContextType {
  notifications: AppNotificationItem[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  openNotification: (n: AppNotificationItem) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}
const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
};

interface NotificationProviderProps {
  user: any;
  setActiveTab: (tab: TabId) => void;
  children: React.ReactNode;
}

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ user, setActiveTab, children }) => {
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

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
      console.error('[NotificationProvider] 알림 조회 실패:', e);
    }
  };

  const openNotification = async (n: AppNotificationItem) => {
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try { await apiFetch(`/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* 무시 */ }
    }
    if (n.link && ['main', 'shop', 'inventory', 'ranking', 'my-info', 'admin'].includes(n.link)) {
      setActiveTab(n.link as TabId);
    }
  };

  const markAllNotificationsRead = async () => {
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnreadCount(0);
    try { await apiFetch('/notifications/read-all', { method: 'POST' }); } catch { /* 무시 */ }
  };

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

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      fetchNotifications,
      openNotification,
      markAllNotificationsRead
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

// -----------------------------------------------------------------------------
// 4. AppContext (Auth / Maintenance & Global Helper Interface)
// -----------------------------------------------------------------------------
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
  toast: (message: string, type?: ToastType) => void;
  maintenanceActive: boolean | null;
  maintenanceStartAt: string | null;
  maintenanceEndAt: string | null;
  checkMaintenanceStatus: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const AppProviderInner: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();

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
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  // 이벤트 핸들러 클로저에서 최신 user를 참조하기 위한 ref
  const userRef = useRef<AppContextType['user']>(null);
  useEffect(() => { userRef.current = user; }, [user]);

  const [maintenanceActive, setMaintenanceActive] = useState<boolean | null>(null);
  const [maintenanceStartAt, setMaintenanceStartAt] = useState<string | null>(null);
  const [maintenanceEndAt, setMaintenanceEndAt] = useState<string | null>(null);

  // 전역 에러 모달 상태 추가
  const [alertModal, setAlertModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    onClose: () => void;
  }>({
    open: false,
    title: '',
    message: '',
    type: 'info',
    onClose: () => {}
  });

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

  useEffect(() => {
    checkMaintenanceStatus();
    const timer = setInterval(checkMaintenanceStatus, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (authLoading || maintenanceActive === null) return;

    const isMaintenanceRoute = pathname === '/maintenance';
    const isLoginRoute = pathname === '/login';
    const isCallbackRoute = pathname === '/auth/chzzk/callback';

    if (isLoginRoute || isCallbackRoute) return;

    if (maintenanceActive) {
      if (user?.role === 'ADMIN') return;
      if (!isMaintenanceRoute) {
        router.replace('/maintenance');
      }
    } else {
      if (isMaintenanceRoute) {
        router.replace('/');
      }
    }
  }, [maintenanceActive, user, authLoading, pathname, router]);

  const askedPushRef = useRef(false);

  useEffect(() => {
    refreshUserData();
    registerServiceWorker();

    const handleBanned = (e: Event) => {
      const customEvent = e as CustomEvent;
      setUser(null);
      // alert() 대신 세련된 전역 AlertModal을 팝업하고 사용자가 확인 시 라우터를 통해 SPA 내에서 이동
      setAlertModal({
        open: true,
        title: '계정 이용 제한',
        message: customEvent.detail?.message || '이용 정지 조치된 계정입니다.',
        type: 'error',
        onClose: () => {
          setAlertModal(prev => ({ ...prev, open: false }));
          router.replace('/');
        }
      });
    };

    const handleMaintenance = () => {
      // 관리자는 점검 중에도 페이지 접속 및 관리가 가능해야 하므로 리다이렉트 차단
      if (userRef.current?.role === 'ADMIN') return;
      router.replace('/maintenance');
    };

    window.addEventListener('cctv-user-banned', handleBanned);
    window.addEventListener('cctv-maintenance-triggered', handleMaintenance);

    return () => {
      window.removeEventListener('cctv-user-banned', handleBanned);
      window.removeEventListener('cctv-maintenance-triggered', handleMaintenance);
    };
  }, [router]);

  useEffect(() => {
    if (!user || askedPushRef.current || !isPushSupported() || Notification.permission !== 'default') return;

    const handleFirstGesture = async () => {
      askedPushRef.current = true;
      try { await subscribeToPush(); } catch { /* 무시 */ }
      window.removeEventListener('pointerdown', handleFirstGesture);
    };
    window.addEventListener('pointerdown', handleFirstGesture);

    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture);
    };
  }, [user?.id]);

  const logout = () => {
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
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
    setUser({
      ...user,
      point: Math.max(0, user.point + diff)
    });
  };

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
      maintenanceActive,
      maintenanceStartAt,
      maintenanceEndAt,
      checkMaintenanceStatus
    }}>
      <NotificationProvider user={user} setActiveTab={setActiveTab}>
        {isInitializing ? (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground select-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-primary/10 blur-[80px] pointer-events-none"></div>
            <div className="flex flex-col items-center space-y-6 relative z-10">
              <div className="relative flex h-24 w-24 items-center justify-center">
                <div className="absolute h-full w-full animate-ping rounded-full bg-primary/5 opacity-75 duration-[1800ms]"></div>
                <div className="absolute h-18 w-18 animate-spin rounded-full border-[3px] border-primary/10 border-t-primary"></div>
                <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-card p-1.5 shadow-md shadow-primary/20 border border-primary/20">
                  <img src="/favicon.ico" alt="CCTV" className="h-8 w-8 object-contain" />
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
        {/* 전역 공용 AlertModal 마운트 */}
        <AlertModal
          open={alertModal.open}
          title={alertModal.title}
          message={alertModal.message}
          type={alertModal.type}
          onClose={alertModal.onClose}
        />
      </NotificationProvider>
    </AppContext.Provider>
  );
};

// -----------------------------------------------------------------------------
// 5. 통합 AppProvider (Context들의 계층 구조 제공)
// -----------------------------------------------------------------------------
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AppProviderInner>
          {children}
        </AppProviderInner>
      </ToastProvider>
    </ThemeProvider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
