'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { API_BASE_URL, apiFetch, isAuthed, setAuthFlag, clearAuthFlag } from '@/lib/api';
import {
  identifyAnalyticsUser,
  initAnalytics,
  resetAnalyticsUser,
  trackFeatureEvent,
  trackPageDuration,
  trackPageHeartbeat,
  trackPageView,
  analyticsSettings
} from '@/lib/analytics';
import { registerServiceWorker, subscribeToPush, isPushSupported } from '@/lib/push';
import { Toaster, toast as sonnerToast } from 'sonner';
import { AlertModal } from './AlertModal';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import type { UserTitle } from '@/lib/types';

export type TabId = 'main' | 'shop' | 'inventory' | 'ranking' | 'friends' | 'my-info' | 'admin' | 'arcade';
type ShopSubTabId = 'gacha_shop' | 'market' | 'my_listings' | 'history';

const VALID_TABS: TabId[] = ['main', 'shop', 'inventory', 'ranking', 'friends', 'my-info', 'admin', 'arcade'];
const SHOP_SUB_TABS: ShopSubTabId[] = ['gacha_shop', 'market', 'my_listings', 'history'];

const parseNotificationLink = (link: string | null): { tab: TabId; shopSubTab?: ShopSubTabId } | null => {
  const raw = (link || '').trim();
  if (!raw) return null;

  let normalized = raw;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin === window.location.origin) {
      normalized = `${url.pathname}${url.search}`;
    }
  } catch {
    // 상대 경로나 탭 id는 그대로 처리합니다.
  }

  const [pathPart, queryString = ''] = normalized.replace(/^\/+/, '').split('?');
  let tabPart = pathPart;
  let subTabPart: string | undefined;

  if (pathPart.includes(':')) {
    [tabPart, subTabPart] = pathPart.split(':', 2);
  } else if (pathPart.includes('/')) {
    [tabPart, subTabPart] = pathPart.split('/', 2);
  }

  const tab = (tabPart || 'main') as TabId;
  if (!VALID_TABS.includes(tab)) return null;

  const query = new URLSearchParams(queryString);
  const requestedShopSubTab = subTabPart || query.get('tab') || query.get('subTab') || undefined;
  const shopSubTab = tab === 'shop' && SHOP_SUB_TABS.includes(requestedShopSubTab as ShopSubTabId)
    ? requestedShopSubTab as ShopSubTabId
    : undefined;

  return { tab, shopSubTab };
};

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
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    } else {
      document.documentElement.classList.remove('dark');
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
  const startXRef = useRef<number | null>(null);
  const currentXRef = useRef<number>(0);
  const [currentX, setCurrentX] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isDismissing, setIsDismissing] = useState<boolean>(false);
  const [dismissDirection, setDismissDirection] = useState<'left' | 'right' | null>(null);

  const dragThreshold = 80;

  const handleStart = (clientX: number) => {
    startXRef.current = clientX;
    setIsDragging(true);
  };

  const handleMove = (clientX: number) => {
    if (startXRef.current === null || isDismissing) return;
    const diff = clientX - startXRef.current;
    currentXRef.current = diff;
    setCurrentX(diff);
  };

  const handleEnd = () => {
    if (startXRef.current === null || isDismissing) return;
    setIsDragging(false);

    const finalX = currentXRef.current;
    if (Math.abs(finalX) > dragThreshold) {
      setIsDismissing(true);
      setDismissDirection(finalX > 0 ? 'right' : 'left');
      setTimeout(() => {
        sonnerToast.dismiss(id);
      }, 200);
    } else {
      currentXRef.current = 0;
      setCurrentX(0);
    }
    startXRef.current = null;
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
      icon: <CheckCircle className="h-5 w-5" />,
      label: '완료',
      accent: 'text-teal-600 dark:text-teal-200',
      iconWrap: 'border-teal-200 bg-teal-50 text-teal-600 dark:border-teal-400/20 dark:bg-teal-400/10 dark:text-teal-200',
      bar: 'from-teal-300 via-primary to-sky-300',
    },
    error: {
      icon: <XCircle className="h-5 w-5" />,
      label: '오류',
      accent: 'text-rose-600 dark:text-rose-200',
      iconWrap: 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200',
      bar: 'from-rose-300 via-rose-500 to-pink-300',
    },
    warning: {
      icon: <AlertTriangle className="h-5 w-5" />,
      label: '확인 필요',
      accent: 'text-sky-700 dark:text-sky-200',
      iconWrap: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200',
      bar: 'from-sky-300 via-primary to-teal-300',
    },
    info: {
      icon: <Info className="h-5 w-5" />,
      label: '알림',
      accent: 'text-primary',
      iconWrap: 'border-primary/20 bg-primary/10 text-primary',
      bar: 'from-primary via-sky-300 to-teal-300',
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
      className="pointer-events-auto relative flex w-[min(23rem,calc(100vw-1.5rem))] cursor-grab select-none overflow-hidden rounded-[1.55rem] border border-white/70 bg-white/88 px-3.5 py-3.5 text-foreground shadow-[0_18px_48px_rgba(7,89,133,0.18),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl active:cursor-grabbing dark:border-white/12 dark:bg-card/92 dark:shadow-[0_18px_48px_rgba(0,0,0,0.34)]"
      role="status"
      aria-live="polite"
    >
      <div className={`absolute inset-x-5 top-0 h-1 rounded-b-full bg-gradient-to-r ${config.bar}`} />
      <div className={`mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-sm ${config.iconWrap}`}>
        {config.icon}
      </div>
      <div className="min-w-0 flex-1 pr-1">
        <p className={`text-[10px] font-black uppercase tracking-[0.14em] ${config.accent}`}>{config.label}</p>
        <p className="mt-0.5 whitespace-pre-line break-keep text-sm font-bold leading-relaxed text-foreground/90 dark:text-foreground">
          {message}
        </p>
      </div>
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
        gap={10}
        offset={18}
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
  group_key?: string | null;
  is_read: boolean;
  created_at?: string;
}

interface NotificationContextType {
  notifications: AppNotificationItem[];
  unreadCount: number;
  fetchNotifications: () => Promise<void>;
  openNotification: (n: AppNotificationItem) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  hideReadNotification: (id: number) => Promise<void>;
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
  const router = useRouter();
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
    trackFeatureEvent('chikapo_notification_open', {
      notification_id: n.id,
      was_read: n.is_read,
      has_link: Boolean(n.link),
      group_key: n.group_key || null
    }, user);
    if (!n.is_read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      try { await apiFetch(`/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* 무시 */ }
    }
    // 알림의 link를 탭/하위 탭으로 변환해 해당 위치로 이동시킵니다.
    const rawLink = (n.link || '').trim();
    if (rawLink) {
      try {
        const url = new URL(rawLink, window.location.origin);
        if (url.origin === window.location.origin) {
          const href = `${url.pathname}${url.search}`;
          const routeName = url.pathname.replace(/^\/+/, '').split('/')[0] || 'main';
          if (url.pathname === '/' || VALID_TABS.includes(routeName as TabId)) {
            router.push(href);
            return;
          }
        }
      } catch {
        // 기존 탭 문자열 링크는 아래 fallback에서 처리합니다.
      }
    }
    const target = parseNotificationLink(n.link);
    if (target) {
      if (target.tab === 'shop' && target.shopSubTab) {
        router.push(`/shop?tab=${target.shopSubTab}`);
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('chikapo:shop-subtab', {
            detail: { subTab: target.shopSubTab }
          }));
        }, 0);
      } else {
        setActiveTab(target.tab);
      }
    }
  };

  const markAllNotificationsRead = async () => {
    setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setUnreadCount(0);
    try { await apiFetch('/notifications/read-all', { method: 'POST' }); } catch { /* 무시 */ }
  };

  const hideReadNotification = async (id: number) => {
    const target = notifications.find((item) => item.id === id);
    if (!target?.is_read) return;
    setNotifications((prev) => prev.filter((item) => item.id !== id));
    try {
      const res = await apiFetch(`/notifications/${id}`, { method: 'DELETE' });
      if (!res.ok) fetchNotifications();
    } catch {
      fetchNotifications();
    }
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    fetchNotifications();
    const fallbackMs = typeof EventSource === 'undefined' ? 120_000 : 600_000;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') fetchNotifications();
    }, fallbackMs);
    return () => clearInterval(timer);
  }, [user?.id]);

  useEffect(() => {
    if (!user || typeof EventSource === 'undefined') return;

    const streamUrl = `${API_BASE_URL}/notifications/stream`;
    const source = new EventSource(streamUrl, { withCredentials: true });

    const handleNotification = (event: MessageEvent<string>) => {
      try {
        const notification = JSON.parse(event.data) as AppNotificationItem;
        if (!notification?.id) return;
        let unreadDelta = notification.is_read ? 0 : 1;
        setNotifications((prev) => {
          const existing = prev.find((item) => item.id === notification.id);
          if (existing) {
            unreadDelta = !notification.is_read && existing.is_read ? 1 : 0;
            return [notification, ...prev.filter((item) => item.id !== notification.id)].slice(0, 50);
          }
          return [notification, ...prev].slice(0, 50);
        });
        if (unreadDelta > 0) setUnreadCount((count) => count + unreadDelta);
      } catch (e) {
        console.error('[NotificationProvider] 실시간 알림 파싱 실패:', e);
      }
    };

    source.addEventListener('notification', handleNotification as EventListener);
    return () => {
      source.removeEventListener('notification', handleNotification as EventListener);
      source.close();
    };
  }, [user?.id]);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      fetchNotifications,
      openNotification,
      markAllNotificationsRead,
      hideReadNotification
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
  statusMessage?: string | null;
    titles: UserTitle[];
    ownedTitles: UserTitle[];
    point: number;
    lastFreeDraw: string | null;
    freeDrawTickets: number;
    bonusFreeDrawTickets: number;
    freeDrawMaxStack: number;
    representativeCardChannelId: string | null;
    representativeCardStar: number | null;
    drawCost: number;
    freeDrawInterval: number;
    isFreeDrawEligible: boolean;
    nextFreeDrawAt: string | null;
    interactionRestrictedUntil: string | null;
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
    if (pathname.startsWith('/friends')) return 'friends';
    if (pathname.startsWith('/my-info')) return 'my-info';
    if (pathname.startsWith('/admin')) return 'admin';
    if (pathname.startsWith('/arcade')) return 'arcade';
    return 'main';
  })();
  const realtimeTopics = React.useMemo(() => {
    const topics = new Set(['maintenance']);
    if (pathname === '/' || pathname.startsWith('/ranking')) topics.add('ranking');
    if (pathname.startsWith('/shop')) {
      topics.add('shop');
      topics.add('market');
    }
    return Array.from(topics).join(',');
  }, [pathname]);

  const setActiveTab = (tab: TabId) => {
    const route = tab === 'main' ? '/' : `/${tab}`;
    trackFeatureEvent('chikapo_navigation_select', {
      from_tab: activeTab,
      to_tab: tab,
      surface: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop'
    }, userRef.current);
    router.push(route);
  };

  const [user, setUser] = useState<AppContextType['user']>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [analyticsLocationKey, setAnalyticsLocationKey] = useState('');
  // 이벤트 핸들러 클로저에서 최신 user를 참조하기 위한 ref
  const userRef = useRef<AppContextType['user']>(null);
  useEffect(() => { userRef.current = user; }, [user]);
  const pageVisitRef = useRef<{ path: string; startedAt: number } | null>(null);
  const analyticsPath = React.useMemo(() => {
    if (analyticsLocationKey) return analyticsLocationKey;
    return pathname;
  }, [pathname, analyticsLocationKey]);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const readLocation = () => setAnalyticsLocationKey(`${window.location.pathname}${window.location.search}`);
    readLocation();

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      window.dispatchEvent(new Event('chikapo:location-change'));
      return result;
    };
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('chikapo:location-change'));
      return result;
    };

    window.addEventListener('popstate', readLocation);
    window.addEventListener('chikapo:location-change', readLocation);
    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', readLocation);
      window.removeEventListener('chikapo:location-change', readLocation);
    };
  }, []);

  useEffect(() => {
    initAnalytics();
    if (user?.id) identifyAnalyticsUser({ id: user.id, role: user.role });
    else resetAnalyticsUser();
  }, [user?.id, user?.role]);

  useEffect(() => {
    initAnalytics();
    const now = Date.now();
    const previousVisit = pageVisitRef.current;
    if (previousVisit) {
      trackPageDuration(previousVisit, now, userRef.current);
    }
    const nextVisit = { path: analyticsPath, startedAt: now };
    pageVisitRef.current = nextVisit;
    trackPageView(nextVisit, userRef.current);
  }, [analyticsPath]);

  useEffect(() => {
    const flushCurrentVisit = () => {
      const currentVisit = pageVisitRef.current;
      if (!currentVisit) return;
      trackPageDuration(currentVisit, Date.now(), userRef.current);
      pageVisitRef.current = null;
    };

    window.addEventListener('pagehide', flushCurrentVisit);
    return () => {
      window.removeEventListener('pagehide', flushCurrentVisit);
      flushCurrentVisit();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentVisit = pageVisitRef.current;
      if (currentVisit) trackPageHeartbeat(currentVisit, userRef.current);
    }, analyticsSettings.heartbeatIntervalMs);
    return () => window.clearInterval(timer);
  }, []);

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
    if (typeof EventSource === 'undefined') return;

    const streamUrl = `${API_BASE_URL}/realtime/stream?topics=${encodeURIComponent(realtimeTopics)}`;
    const source = new EventSource(streamUrl, { withCredentials: true });

    const handleMaintenance = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as {
          active?: boolean;
          startAt?: string | null;
          endAt?: string | null;
        };
        setMaintenanceActive(!!data.active);
        setMaintenanceStartAt(data.startAt || null);
        setMaintenanceEndAt(data.endAt || null);
      } catch (err) {
        console.error('[AppContext] 점검 스트림 파싱 실패:', err);
      }
    };

    const relayEvent = (name: 'ranking' | 'market' | 'shop') => (event: MessageEvent<string>) => {
      let detail: unknown = null;
      try {
        detail = JSON.parse(event.data);
      } catch {
        detail = null;
      }
      window.dispatchEvent(new CustomEvent(`chikapo:${name}-updated`, { detail }));
    };

    const handleRanking = relayEvent('ranking');
    const handleMarket = relayEvent('market');
    const handleShop = relayEvent('shop');

    source.addEventListener('maintenance', handleMaintenance as EventListener);
    source.addEventListener('ranking', handleRanking as EventListener);
    source.addEventListener('market', handleMarket as EventListener);
    source.addEventListener('shop', handleShop as EventListener);

    return () => {
      source.removeEventListener('maintenance', handleMaintenance as EventListener);
      source.removeEventListener('ranking', handleRanking as EventListener);
      source.removeEventListener('market', handleMarket as EventListener);
      source.removeEventListener('shop', handleShop as EventListener);
      source.close();
    };
  }, [realtimeTopics]);

  useEffect(() => {
    checkMaintenanceStatus();
    const fallbackMs = typeof EventSource === 'undefined' ? 30_000 : 300_000;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') checkMaintenanceStatus();
    }, fallbackMs);
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
    askedPushRef.current = false;
  }, [user?.id]);

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

    window.addEventListener('chikapo-user-banned', handleBanned);
    window.addEventListener('chikapo-maintenance-triggered', handleMaintenance);

    return () => {
      window.removeEventListener('chikapo-user-banned', handleBanned);
      window.removeEventListener('chikapo-maintenance-triggered', handleMaintenance);
    };
  }, [router]);

  useEffect(() => {
    if (!user || askedPushRef.current || !isPushSupported() || Notification.permission === 'denied') return;

    if (Notification.permission === 'granted') {
      askedPushRef.current = true;
      subscribeToPush().catch(() => { /* 무시 */ });
      return;
    }

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
    trackFeatureEvent('chikapo_logout', {
      source_tab: activeTab
    }, userRef.current);
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    clearAuthFlag();
    setUser(null);
    setActiveTab('main');
    toast('로그아웃되었습니다.', 'info');
  };

  const refreshUserData = async (showLoading = false) => {
    if (showLoading || !user) {
      setAuthLoading(true);
    }
    try {
      const response = await apiFetch('/users/me');
      if (response.ok) {
        const data = await response.json();
        setAuthFlag();
        setUser({
          id: data.id,
          username: data.username,
          avatarUrl: data.avatarUrl,
          role: data.role,
          statusMessage: data.statusMessage ?? null,
          titles: data.titles || [],
          ownedTitles: data.ownedTitles || data.titles || [],
          point: data.point,
          lastFreeDraw: data.lastFreeDraw,
          freeDrawTickets: data.freeDrawTickets ?? 0,
          bonusFreeDrawTickets: data.bonusFreeDrawTickets ?? 0,
          freeDrawMaxStack: data.freeDrawMaxStack ?? 1,
          representativeCardChannelId: data.representativeCardChannelId ?? null,
          representativeCardStar: data.representativeCardStar ?? null,
          drawCost: data.drawCost ?? 10000,
          freeDrawInterval: data.freeDrawInterval ?? 24,
          isFreeDrawEligible: !!data.isFreeDrawEligible,
          nextFreeDrawAt: data.nextFreeDrawAt ?? null,
          interactionRestrictedUntil: data.interactionRestrictedUntil ?? null
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
    setUser((prev) => prev
      ? { ...prev, point: Math.max(0, prev.point + diff) }
      : prev
    );
  };

  const isMaintenanceRoute = pathname === '/maintenance';
  const isMaintenanceBypassRoute =
    isMaintenanceRoute ||
    pathname === '/login' ||
    pathname === '/auth/chzzk/callback';
  const isMaintenanceBlocked =
    maintenanceActive === true &&
    user?.role !== 'ADMIN' &&
    !isMaintenanceBypassRoute;
  const isInitializing =
    maintenanceActive === null ||
    authLoading ||
    isMaintenanceBlocked;

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
          <div className="fixed inset-0 z-50 flex select-none flex-col items-center justify-center overflow-hidden bg-background text-foreground">
            <div className="absolute -left-16 -top-16 h-64 w-64 rounded-full bg-white/70 blur-2xl pointer-events-none dark:bg-primary/10"></div>
            <div className="absolute right-[-4rem] top-16 h-80 w-80 rounded-full bg-primary/18 blur-[80px] pointer-events-none"></div>
            <div className="absolute bottom-[-5rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-accent/45 blur-[90px] pointer-events-none"></div>
            <div className="flex flex-col items-center space-y-6 relative z-10">
              <div className="relative flex h-24 w-24 items-center justify-center">
                <div className="absolute h-full w-full animate-ping rounded-[2rem] bg-primary/10 opacity-75 duration-[1800ms]"></div>
                <div className="absolute h-18 w-18 animate-spin rounded-[1.75rem] border-[3px] border-primary/12 border-t-primary"></div>
                <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-white/90 p-2 shadow-xl shadow-primary/20 dark:bg-card/90">
                  <img src="/favicon.ico" alt="치카포" className="h-8 w-8 object-contain" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h1 className="cute-loading-logo text-4xl font-black animate-pulse">
                  치카포
                </h1>
                <p className="rounded-full border border-primary/15 bg-card/70 px-4 py-1.5 text-[11px] font-bold tracking-wide text-muted-foreground shadow-sm backdrop-blur">
                  치지직 카드 포럼을 불러오는 중입니다...
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
