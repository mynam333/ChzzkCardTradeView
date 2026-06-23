import posthog from 'posthog-js';

type AnalyticsUser = {
  id: string;
  role?: string | null;
} | null;

type PageVisit = {
  path: string;
  startedAt: number;
};

const SESSION_ID_KEY = 'chikapo_analytics_session_id';
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || '';
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
const POSTHOG_DASHBOARD_URL = process.env.NEXT_PUBLIC_POSTHOG_DASHBOARD_URL || 'https://us.posthog.com';
const ANALYTICS_ENV_ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED !== 'false';
const HEARTBEAT_INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.NEXT_PUBLIC_ANALYTICS_HEARTBEAT_MS || 60_000)
);

let initialized = false;
let identifiedUserId: string | null = null;

const isBrowser = () => typeof window !== 'undefined';

const isLocalHost = () => {
  if (!isBrowser()) return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
};

export const analyticsSettings = {
  enabled: Boolean(POSTHOG_KEY && ANALYTICS_ENV_ENABLED),
  hasPostHogKey: Boolean(POSTHOG_KEY),
  postHogHost: POSTHOG_HOST,
  dashboardUrl: POSTHOG_DASHBOARD_URL,
  cloudflareEnabled: Boolean(process.env.NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN),
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS
};

const getSessionId = () => {
  if (!isBrowser()) return 'server';
  try {
    const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_ID_KEY, next);
    return next;
  } catch {
    return 'session-unavailable';
  }
};

const getDeviceType = () => {
  if (!isBrowser()) return 'unknown';
  const width = window.innerWidth || 0;
  const ua = navigator.userAgent || '';
  if (/iPad|Tablet|SM-T|Galaxy Tab|Android(?!.*Mobile)/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua) || width < 768) return 'mobile';
  return 'desktop';
};

const getBrowserName = () => {
  if (!isBrowser()) return 'unknown';
  const ua = navigator.userAgent || '';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/CriOS|Chrome\//i.test(ua)) return 'Chrome';
  if (/FxiOS|Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Other';
};

const getOsName = () => {
  if (!isBrowser()) return 'unknown';
  const ua = navigator.userAgent || '';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Other';
};

const getRouteGroup = (path: string) => {
  const pathname = path.split('?')[0] || '/';
  if (pathname === '/') return 'main';
  const first = pathname.replace(/^\/+/, '').split('/')[0];
  return first || 'main';
};

const SAFE_QUERY_KEYS = new Set(['tab', 'subTab', 'view', 'page', 'sort', 'status', 'type', 'mode']);

const sanitizePathForAnalytics = (path: string) => {
  const [pathname, query = ''] = path.split('?', 2);
  if (!query) return pathname || '/';
  const params = new URLSearchParams(query);
  const safe = new URLSearchParams();
  params.forEach((value, key) => {
    if (SAFE_QUERY_KEYS.has(key)) safe.set(key, value.slice(0, 40));
  });
  const safeQuery = safe.toString();
  return safeQuery ? `${pathname || '/'}?${safeQuery}` : (pathname || '/');
};

const getPublicPageProperties = (path: string, user?: AnalyticsUser) => ({
  path: sanitizePathForAnalytics(path),
  route_group: getRouteGroup(path),
  session_id: getSessionId(),
  device_type: getDeviceType(),
  browser_name: getBrowserName(),
  os_name: getOsName(),
  viewport_width: isBrowser() ? window.innerWidth : null,
  viewport_height: isBrowser() ? window.innerHeight : null,
  timezone: isBrowser() ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
  language: isBrowser() ? navigator.language : null,
  is_authenticated: Boolean(user?.id),
  user_role: user?.role || 'ANONYMOUS'
});

export const initAnalytics = () => {
  if (!isBrowser() || initialized || !analyticsSettings.enabled || isLocalHost()) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    advanced_disable_feature_flags: true,
    advanced_disable_feature_flags_on_first_load: true,
    respect_dnt: true,
    persistence: 'localStorage+cookie'
  } as any);
  initialized = true;
};

export const identifyAnalyticsUser = (user: AnalyticsUser) => {
  if (!initialized || !user?.id) return;
  const distinctId = `user:${user.id}`;
  if (identifiedUserId === distinctId) return;
  posthog.identify(distinctId, {
    role: user.role || 'USER'
  });
  identifiedUserId = distinctId;
};

export const resetAnalyticsUser = () => {
  if (!initialized || !identifiedUserId) return;
  posthog.reset();
  identifiedUserId = null;
};

export const trackPageView = (visit: PageVisit, user?: AnalyticsUser) => {
  if (!initialized) return;
  posthog.capture('chikapo_page_view', {
    ...getPublicPageProperties(visit.path, user),
    started_at: new Date(visit.startedAt).toISOString()
  });
};

export const trackPageDuration = (visit: PageVisit, endedAt: number, user?: AnalyticsUser) => {
  if (!initialized) return;
  const durationMs = Math.max(0, endedAt - visit.startedAt);
  posthog.capture('chikapo_page_duration', {
    ...getPublicPageProperties(visit.path, user),
    duration_ms: durationMs,
    duration_seconds: Math.round(durationMs / 1000),
    ended_at: new Date(endedAt).toISOString()
  });
};

export const trackPageHeartbeat = (visit: PageVisit, user?: AnalyticsUser) => {
  if (!initialized || !isBrowser() || document.visibilityState !== 'visible') return;
  const elapsedMs = Math.max(0, Date.now() - visit.startedAt);
  posthog.capture('chikapo_page_heartbeat', {
    ...getPublicPageProperties(visit.path, user),
    elapsed_seconds: Math.round(elapsedMs / 1000)
  });
};

export const trackFeatureEvent = (
  eventName: string,
  properties: Record<string, string | number | boolean | null | undefined> = {},
  user?: AnalyticsUser
) => {
  if (!initialized) return;
  posthog.capture(eventName, {
    session_id: getSessionId(),
    device_type: getDeviceType(),
    browser_name: getBrowserName(),
    os_name: getOsName(),
    is_authenticated: Boolean(user?.id),
    user_role: user?.role || 'ANONYMOUS',
    ...properties
  });
};
