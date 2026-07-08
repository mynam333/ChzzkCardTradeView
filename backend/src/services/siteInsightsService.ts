import crypto from 'crypto';
import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';
import { getDbMode, getMysqlDb, getSqlDialect, getSqliteDb } from './db';
import { SESSION_COOKIE_NAMES } from './sessionCookie';

export type InsightsRange = '24h' | '7d' | '30d' | 'all';
export type InsightsGranularity = 'hour' | 'day' | 'month';

type AnalyticsEventType = 'page_view' | 'page_duration' | 'page_heartbeat' | 'feature';

type AnalyticsPayload = {
  event_type?: string;
  eventName?: string;
  path?: string;
  route_group?: string;
  session_id?: string;
  device_type?: string;
  browser_name?: string;
  os_name?: string;
  viewport_width?: number | null;
  viewport_height?: number | null;
  timezone?: string | null;
  language?: string | null;
  is_authenticated?: boolean;
  user_role?: string | null;
  duration_seconds?: number | null;
  feature_name?: string | null;
  properties?: Record<string, unknown>;
  started_at?: string;
  ended_at?: string;
  elapsed_seconds?: number;
  referrer?: string;
};

export type SiteInsightsResponse = {
  enabled: boolean;
  range: InsightsRange;
  granularity: InsightsGranularity;
  generated_at: string;
  cached_until: string | null;
  retention_days: number;
  summary: {
    page_views: number;
    sessions: number;
    visitors: number;
    active_sessions_5m: number;
    avg_duration_seconds: number;
    feature_events: number;
    heartbeats: number;
  };
  timeline: Array<{ bucket: string; views: number; sessions: number; visitors: number; duration_samples: number; avg_duration_seconds: number }>;
  hourly: Array<{ bucket: string; views: number; sessions: number; visitors: number }>;
  active_hourly: Array<{ bucket: string; active_sessions: number; heartbeats: number }>;
  pages: Array<{ path: string; route_group: string; views: number; sessions: number; avg_duration_seconds: number; duration_samples: number }>;
  devices: Array<{ device_type: string; browser_name: string; os_name: string; views: number; sessions: number }>;
  route_groups: Array<{ route_group: string; views: number; sessions: number }>;
  features: Array<{ feature_name: string; count: number }>;
  navigation: Array<{ from_tab: string; to_tab: string; surface: string; count: number }>;
  notifications: Array<{ group_key: string; opens: number }>;
};

const SAFE_EVENT_TYPES = new Set<AnalyticsEventType>(['page_view', 'page_duration', 'page_heartbeat', 'feature']);
const SAFE_QUERY_KEYS = new Set(['tab', 'subTab', 'view', 'page', 'sort', 'status', 'type', 'mode']);
const ACTIVE_WINDOW_MS = 5 * 60_000;
const CACHE_TTL_MS = Math.max(10_000, Number(process.env.SITE_INSIGHTS_CACHE_TTL_MS || 30_000));
const EVENT_RETENTION_DAYS = Math.max(7, Number(process.env.SITE_INSIGHTS_EVENT_RETENTION_DAYS || 120));
const CLEANUP_INTERVAL_MS = Math.max(60_000, Number(process.env.SITE_INSIGHTS_CLEANUP_INTERVAL_MS || 6 * 60 * 60_000));
const MAX_FEATURE_PROPS_LENGTH = 1500;
const FLUSH_INTERVAL_MS = Math.max(500, Number(process.env.SITE_INSIGHTS_FLUSH_INTERVAL_MS || 2_000));
const MAX_QUEUE_SIZE = Math.max(100, Number(process.env.SITE_INSIGHTS_MAX_QUEUE_SIZE || 5_000));

let schemaReady: Promise<void> | null = null;
let lastCleanupAt = 0;
let flushTimer: NodeJS.Timeout | null = null;
let isFlushing = false;
const cache = new Map<string, { expiresAt: number; data: SiteInsightsResponse }>();

const nowSql = (date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');
const isoFromDb = (value: unknown) => {
  const raw = String(value || '');
  if (!raw) return new Date().toISOString();
  if (raw.includes('T')) return raw.endsWith('Z') ? raw : `${raw}Z`;
  return `${raw.replace(' ', 'T')}Z`;
};

const numberValue = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const stringValue = (value: unknown, fallback = 'unknown') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const clampText = (value: unknown, max = 191, fallback = '') => {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, max);
};

const getRouteGroup = (path: string) => {
  const pathname = path.split('?')[0] || '/';
  if (pathname === '/') return 'main';
  return pathname.replace(/^\/+/, '').split('/')[0] || 'main';
};

const sanitizePath = (value: unknown) => {
  const raw = String(value || '/').trim() || '/';
  let pathname = '/';
  let query = '';
  try {
    const parsed = raw.startsWith('http')
      ? new URL(raw)
      : new URL(raw, 'https://chikapo.local');
    pathname = parsed.pathname || '/';
    query = parsed.searchParams.toString();
  } catch {
    const [pathPart, queryPart = ''] = raw.split('?', 2);
    pathname = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
    query = queryPart;
  }

  const safeParams = new URLSearchParams();
  if (query) {
    const params = new URLSearchParams(query);
    params.forEach((paramValue, key) => {
      if (SAFE_QUERY_KEYS.has(key)) safeParams.set(key, paramValue.slice(0, 40));
    });
  }
  const safeQuery = safeParams.toString();
  return (safeQuery ? `${pathname}?${safeQuery}` : pathname).slice(0, 384);
};

const getReferrerHost = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).host.slice(0, 191);
  } catch {
    return null;
  }
};

const normalizeEventType = (value: unknown): AnalyticsEventType | null => {
  const type = String(value || '').trim() as AnalyticsEventType;
  return SAFE_EVENT_TYPES.has(type) ? type : null;
};

export const normalizeInsightsRange = (value: unknown): InsightsRange => {
  if (value === '24h' || value === '7d' || value === '30d' || value === 'all') return value;
  return '7d';
};

export const normalizeInsightsGranularity = (value: unknown, range: InsightsRange): InsightsGranularity => {
  if (value === 'hour' || value === 'day' || value === 'month') return value;
  if (range === '24h' || range === '7d') return 'hour';
  if (range === '30d') return 'day';
  return 'month';
};

const rangeStartSql = (range: InsightsRange) => {
  const now = Date.now();
  if (range === '24h') return nowSql(new Date(now - 24 * 60 * 60_000));
  if (range === '7d') return nowSql(new Date(now - 7 * 24 * 60 * 60_000));
  if (range === '30d') return nowSql(new Date(now - 30 * 24 * 60 * 60_000));
  return null;
};

const buildDisabledInsights = (range: InsightsRange, granularity: InsightsGranularity): SiteInsightsResponse => ({
  enabled: false,
  range,
  granularity,
  generated_at: new Date().toISOString(),
  cached_until: null,
  retention_days: EVENT_RETENTION_DAYS,
  summary: { page_views: 0, sessions: 0, visitors: 0, active_sessions_5m: 0, avg_duration_seconds: 0, feature_events: 0, heartbeats: 0 },
  timeline: [],
  hourly: [],
  active_hourly: [],
  pages: [],
  devices: [],
  route_groups: [],
  features: [],
  navigation: [],
  notifications: []
});

const getCookieToken = (req: Request) => {
  const cookies = (req as any).cookies || {};
  return SESSION_COOKIE_NAMES.map((name) => cookies[name]).find(Boolean) as string | undefined;
};

const getAuthenticatedUserId = (req: Request): string | null => {
  const token = getCookieToken(req);
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id?: string };
    return typeof decoded.id === 'string' ? decoded.id : null;
  } catch {
    return null;
  }
};

const hashIp = (req: Request) => {
  const ip = req.ip || req.socket.remoteAddress || '';
  if (!ip) return null;
  return crypto.createHash('sha256').update(`${process.env.JWT_SECRET || 'chikapo'}:${ip}`).digest('hex').slice(0, 32);
};

const parseFeatureProps = (payload: AnalyticsPayload) => {
  if (!payload.properties || typeof payload.properties !== 'object') return null;
  const allowed: Record<string, unknown> = {};
  for (const key of ['from_tab', 'to_tab', 'surface', 'group_key']) {
    const value = payload.properties[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      allowed[key] = String(value).slice(0, 120);
    }
  }
  const json = JSON.stringify(allowed);
  return json.length > 2 ? json.slice(0, MAX_FEATURE_PROPS_LENGTH) : null;
};

const getFeatureProp = (json: unknown, key: string) => {
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : {};
    return stringValue(parsed?.[key], 'unknown').slice(0, 120);
  } catch {
    return 'unknown';
  }
};

const ensureMysqlSchema = async () => {
  const db = getMysqlDb();
  const dialect = getSqlDialect();
  if (dialect === 'postgres') {
    await db.run(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        event_type VARCHAR(32) NOT NULL,
        session_id VARCHAR(96) NOT NULL,
        user_id VARCHAR(191) NULL,
        ip_hash VARCHAR(64) NULL,
        path VARCHAR(384) NULL,
        route_group VARCHAR(80) NULL,
        device_type VARCHAR(32) NULL,
        browser_name VARCHAR(64) NULL,
        os_name VARCHAR(64) NULL,
        viewport_width INT NULL,
        viewport_height INT NULL,
        timezone VARCHAR(80) NULL,
        language VARCHAR(32) NULL,
        is_authenticated SMALLINT NOT NULL DEFAULT 0,
        user_role VARCHAR(32) NULL,
        duration_seconds INT NULL,
        feature_name VARCHAR(96) NULL,
        feature_props_json TEXT NULL,
        referrer_host VARCHAR(191) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS analytics_sessions (
        session_id VARCHAR(96) PRIMARY KEY,
        user_id VARCHAR(191) NULL,
        ip_hash VARCHAR(64) NULL,
        first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_path VARCHAR(384) NULL,
        route_group VARCHAR(80) NULL,
        device_type VARCHAR(32) NULL,
        browser_name VARCHAR(64) NULL,
        os_name VARCHAR(64) NULL,
        timezone VARCHAR(80) NULL,
        language VARCHAR(32) NULL,
        is_authenticated SMALLINT NOT NULL DEFAULT 0,
        user_role VARCHAR(32) NULL
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS analytics_hourly_rollups (
        bucket_at TIMESTAMP NOT NULL,
        dimension_type VARCHAR(32) NOT NULL,
        dimension_key VARCHAR(384) NOT NULL,
        page_views BIGINT NOT NULL DEFAULT 0,
        duration_total_seconds BIGINT NOT NULL DEFAULT 0,
        duration_samples BIGINT NOT NULL DEFAULT 0,
        heartbeats BIGINT NOT NULL DEFAULT 0,
        feature_events BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (bucket_at, dimension_type, dimension_key)
      )
    `);
    for (const sql of [
      'CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events (created_at)',
      'CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created ON analytics_events (event_type, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_analytics_events_path_created ON analytics_events (path, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_analytics_sessions_last_seen ON analytics_sessions (last_seen_at)',
      'CREATE INDEX IF NOT EXISTS idx_analytics_rollups_dimension_bucket ON analytics_hourly_rollups (dimension_type, bucket_at)'
    ]) await db.run(sql);
    return;
  }

  await db.run(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(32) NOT NULL,
      session_id VARCHAR(96) NOT NULL,
      user_id VARCHAR(191) NULL,
      ip_hash VARCHAR(64) NULL,
      path VARCHAR(384) NULL,
      route_group VARCHAR(80) NULL,
      device_type VARCHAR(32) NULL,
      browser_name VARCHAR(64) NULL,
      os_name VARCHAR(64) NULL,
      viewport_width INT NULL,
      viewport_height INT NULL,
      timezone VARCHAR(80) NULL,
      language VARCHAR(32) NULL,
      is_authenticated TINYINT NOT NULL DEFAULT 0,
      user_role VARCHAR(32) NULL,
      duration_seconds INT NULL,
      feature_name VARCHAR(96) NULL,
      feature_props_json TEXT NULL,
      referrer_host VARCHAR(191) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_analytics_events_created (created_at),
      INDEX idx_analytics_events_type_created (event_type, created_at),
      INDEX idx_analytics_events_path_created (path, created_at),
      INDEX idx_analytics_events_session_created (session_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS analytics_sessions (
      session_id VARCHAR(96) PRIMARY KEY,
      user_id VARCHAR(191) NULL,
      ip_hash VARCHAR(64) NULL,
      first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_path VARCHAR(384) NULL,
      route_group VARCHAR(80) NULL,
      device_type VARCHAR(32) NULL,
      browser_name VARCHAR(64) NULL,
      os_name VARCHAR(64) NULL,
      timezone VARCHAR(80) NULL,
      language VARCHAR(32) NULL,
      is_authenticated TINYINT NOT NULL DEFAULT 0,
      user_role VARCHAR(32) NULL,
      INDEX idx_analytics_sessions_last_seen (last_seen_at),
      INDEX idx_analytics_sessions_user_seen (user_id, last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS analytics_hourly_rollups (
      bucket_at DATETIME NOT NULL,
      dimension_type VARCHAR(32) NOT NULL,
      dimension_key VARCHAR(384) NOT NULL,
      page_views BIGINT NOT NULL DEFAULT 0,
      duration_total_seconds BIGINT NOT NULL DEFAULT 0,
      duration_samples BIGINT NOT NULL DEFAULT 0,
      heartbeats BIGINT NOT NULL DEFAULT 0,
      feature_events BIGINT NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (bucket_at, dimension_type, dimension_key),
      INDEX idx_analytics_rollups_dimension_bucket (dimension_type, bucket_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
};

const ensureSqliteSchema = () => {
  const db = getSqliteDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_id TEXT,
      ip_hash TEXT,
      path TEXT,
      route_group TEXT,
      device_type TEXT,
      browser_name TEXT,
      os_name TEXT,
      viewport_width INTEGER,
      viewport_height INTEGER,
      timezone TEXT,
      language TEXT,
      is_authenticated INTEGER NOT NULL DEFAULT 0,
      user_role TEXT,
      duration_seconds INTEGER,
      feature_name TEXT,
      feature_props_json TEXT,
      referrer_host TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created ON analytics_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_path_created ON analytics_events(path, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_session_created ON analytics_events(session_id, created_at);

    CREATE TABLE IF NOT EXISTS analytics_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT,
      ip_hash TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_path TEXT,
      route_group TEXT,
      device_type TEXT,
      browser_name TEXT,
      os_name TEXT,
      timezone TEXT,
      language TEXT,
      is_authenticated INTEGER NOT NULL DEFAULT 0,
      user_role TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_last_seen ON analytics_sessions(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user_seen ON analytics_sessions(user_id, last_seen_at);

    CREATE TABLE IF NOT EXISTS analytics_hourly_rollups (
      bucket_at TEXT NOT NULL,
      dimension_type TEXT NOT NULL,
      dimension_key TEXT NOT NULL,
      page_views INTEGER NOT NULL DEFAULT 0,
      duration_total_seconds INTEGER NOT NULL DEFAULT 0,
      duration_samples INTEGER NOT NULL DEFAULT 0,
      heartbeats INTEGER NOT NULL DEFAULT 0,
      feature_events INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (bucket_at, dimension_type, dimension_key)
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_rollups_dimension_bucket ON analytics_hourly_rollups(dimension_type, bucket_at);
  `);
};

const ensureSchema = async () => {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const mode = getDbMode();
    if (mode === 'MYSQL') await ensureMysqlSchema();
    else if (mode === 'LOCAL_SQL') ensureSqliteSchema();
  })();
  return schemaReady;
};

const runCleanupIfNeeded = async () => {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  const cutoff = nowSql(new Date(now - EVENT_RETENTION_DAYS * 24 * 60 * 60_000));
  try {
    if (getDbMode() === 'MYSQL') {
      const db = getMysqlDb();
      await db.run('DELETE FROM analytics_events WHERE created_at < ?', cutoff);
      await db.run('DELETE FROM analytics_sessions WHERE last_seen_at < ?', nowSql(new Date(now - 180 * 24 * 60 * 60_000)));
    } else if (getDbMode() === 'LOCAL_SQL') {
      const db = getSqliteDb();
      db.prepare('DELETE FROM analytics_events WHERE created_at < ?').run(cutoff);
      db.prepare('DELETE FROM analytics_sessions WHERE last_seen_at < ?').run(nowSql(new Date(now - 180 * 24 * 60 * 60_000)));
    }
  } catch (err: any) {
    console.warn('[SiteInsights] 오래된 인사이트 이벤트 정리 실패:', err?.message || err);
  }
};

const buildEvent = (payload: AnalyticsPayload, req: Request) => {
  const eventType = normalizeEventType(payload.event_type);
  if (!eventType) return null;
  const path = sanitizePath(payload.path);
  const featureName = eventType === 'feature'
    ? clampText(payload.feature_name || payload.eventName, 96, 'unknown')
    : null;
  const userId = getAuthenticatedUserId(req);
  const sessionId = clampText(payload.session_id, 96, '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96);
  if (!sessionId || sessionId === 'server') return null;
  const duration = Math.max(0, Math.min(24 * 60 * 60, Math.round(Number(payload.duration_seconds || 0))));
  const role = userId ? clampText(payload.user_role, 32, 'USER') : 'ANONYMOUS';
  return {
    eventType,
    sessionId,
    userId,
    ipHash: hashIp(req),
    path,
    routeGroup: clampText(payload.route_group, 80, getRouteGroup(path)),
    deviceType: clampText(payload.device_type, 32, 'unknown'),
    browserName: clampText(payload.browser_name, 64, 'unknown'),
    osName: clampText(payload.os_name, 64, 'unknown'),
    viewportWidth: Number.isFinite(Number(payload.viewport_width)) ? Math.max(0, Math.round(Number(payload.viewport_width))) : null,
    viewportHeight: Number.isFinite(Number(payload.viewport_height)) ? Math.max(0, Math.round(Number(payload.viewport_height))) : null,
    timezone: clampText(payload.timezone, 80, ''),
    language: clampText(payload.language, 32, ''),
    isAuthenticated: userId ? 1 : 0,
    userRole: role,
    durationSeconds: eventType === 'page_duration' ? duration : null,
    featureName,
    featurePropsJson: eventType === 'feature' ? parseFeatureProps(payload) : null,
    referrerHost: getReferrerHost(payload.referrer),
    createdAt: nowSql()
  };
};

const bucketHour = (createdAt: string) => `${createdAt.slice(0, 13)}:00:00`;

const rollupDimensions = (event: ReturnType<typeof buildEvent>) => {
  if (!event) return [];
  const rows = [
    { type: 'total', key: 'total' },
    { type: 'route', key: event.routeGroup || 'unknown' },
    { type: 'device', key: `${event.deviceType || 'unknown'}|${event.browserName || 'unknown'}|${event.osName || 'unknown'}` }
  ];
  if (event.path) rows.push({ type: 'path', key: event.path });
  if (event.eventType === 'feature' && event.featureName) rows.push({ type: 'feature', key: event.featureName });
  return rows;
};

type SiteInsightEvent = NonNullable<ReturnType<typeof buildEvent>>;
const pendingEvents: SiteInsightEvent[] = [];

const flushPendingEvents = async () => {
  if (isFlushing) return;
  isFlushing = true;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    await ensureSchema();
    while (pendingEvents.length > 0) {
      const event = pendingEvents.shift();
      if (!event) continue;
      if (getDbMode() === 'MYSQL') await recordMysqlEvent(event);
      else if (getDbMode() === 'LOCAL_SQL') recordSqliteEvent(event);
    }
    runCleanupIfNeeded().catch(() => undefined);
  } catch (err: any) {
    console.warn('[SiteInsights] 인사이트 이벤트 flush 실패:', err?.message || err);
  } finally {
    isFlushing = false;
    if (pendingEvents.length > 0) {
      flushTimer = setTimeout(() => {
        flushPendingEvents().catch(() => undefined);
      }, FLUSH_INTERVAL_MS);
    }
  }
};

const enqueueEvent = (event: SiteInsightEvent) => {
  if (pendingEvents.length >= MAX_QUEUE_SIZE) {
    const heartbeatIndex = pendingEvents.findIndex((item) => item.eventType === 'page_heartbeat');
    if (heartbeatIndex >= 0) pendingEvents.splice(heartbeatIndex, 1);
    else pendingEvents.shift();
  }
  pendingEvents.push(event);
  if (!flushTimer && !isFlushing) {
    flushTimer = setTimeout(() => {
      flushPendingEvents().catch(() => undefined);
    }, FLUSH_INTERVAL_MS);
  }
};

const recordMysqlEvent = async (event: SiteInsightEvent) => {
  const db = getMysqlDb();
  const shouldStoreRaw = event.eventType !== 'page_heartbeat';
  if (shouldStoreRaw) {
    await db.run(`
      INSERT INTO analytics_events (
        event_type, session_id, user_id, ip_hash, path, route_group, device_type, browser_name, os_name,
        viewport_width, viewport_height, timezone, language, is_authenticated, user_role,
        duration_seconds, feature_name, feature_props_json, referrer_host, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, event.eventType, event.sessionId, event.userId, event.ipHash, event.path, event.routeGroup, event.deviceType, event.browserName, event.osName,
      event.viewportWidth, event.viewportHeight, event.timezone, event.language, event.isAuthenticated, event.userRole,
      event.durationSeconds, event.featureName, event.featurePropsJson, event.referrerHost, event.createdAt);
  }
  await db.run(`
    INSERT INTO analytics_sessions (
      session_id, user_id, ip_hash, first_seen_at, last_seen_at, last_path, route_group, device_type, browser_name, os_name,
      timezone, language, is_authenticated, user_role
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      user_id = COALESCE(VALUES(user_id), user_id),
      ip_hash = COALESCE(VALUES(ip_hash), ip_hash),
      last_seen_at = VALUES(last_seen_at),
      last_path = VALUES(last_path),
      route_group = VALUES(route_group),
      device_type = VALUES(device_type),
      browser_name = VALUES(browser_name),
      os_name = VALUES(os_name),
      timezone = VALUES(timezone),
      language = VALUES(language),
      is_authenticated = VALUES(is_authenticated),
      user_role = VALUES(user_role)
  `, event.sessionId, event.userId, event.ipHash, event.createdAt, event.createdAt, event.path, event.routeGroup, event.deviceType, event.browserName, event.osName,
    event.timezone, event.language, event.isAuthenticated, event.userRole);

  const pageViews = event.eventType === 'page_view' ? 1 : 0;
  const heartbeats = event.eventType === 'page_heartbeat' ? 1 : 0;
  const featureEvents = event.eventType === 'feature' ? 1 : 0;
  const durationTotal = event.eventType === 'page_duration' ? event.durationSeconds || 0 : 0;
  const durationSamples = event.eventType === 'page_duration' ? 1 : 0;
  const bucket = bucketHour(event.createdAt);
  for (const dim of rollupDimensions(event)) {
    await db.run(`
      INSERT INTO analytics_hourly_rollups (
        bucket_at, dimension_type, dimension_key, page_views, duration_total_seconds, duration_samples, heartbeats, feature_events, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        page_views = page_views + VALUES(page_views),
        duration_total_seconds = duration_total_seconds + VALUES(duration_total_seconds),
        duration_samples = duration_samples + VALUES(duration_samples),
        heartbeats = heartbeats + VALUES(heartbeats),
        feature_events = feature_events + VALUES(feature_events),
        updated_at = VALUES(updated_at)
    `, bucket, dim.type, dim.key.slice(0, 384), pageViews, durationTotal, durationSamples, heartbeats, featureEvents, event.createdAt);
  }
};

const recordSqliteEvent = (event: SiteInsightEvent) => {
  const db = getSqliteDb();
  const shouldStoreRaw = event.eventType !== 'page_heartbeat';
  const tx = db.transaction(() => {
    if (shouldStoreRaw) {
      db.prepare(`
        INSERT INTO analytics_events (
          event_type, session_id, user_id, ip_hash, path, route_group, device_type, browser_name, os_name,
          viewport_width, viewport_height, timezone, language, is_authenticated, user_role,
          duration_seconds, feature_name, feature_props_json, referrer_host, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(event.eventType, event.sessionId, event.userId, event.ipHash, event.path, event.routeGroup, event.deviceType, event.browserName, event.osName,
        event.viewportWidth, event.viewportHeight, event.timezone, event.language, event.isAuthenticated, event.userRole,
        event.durationSeconds, event.featureName, event.featurePropsJson, event.referrerHost, event.createdAt);
    }
    db.prepare(`
      INSERT INTO analytics_sessions (
        session_id, user_id, ip_hash, first_seen_at, last_seen_at, last_path, route_group, device_type, browser_name, os_name,
        timezone, language, is_authenticated, user_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = COALESCE(excluded.user_id, analytics_sessions.user_id),
        ip_hash = COALESCE(excluded.ip_hash, analytics_sessions.ip_hash),
        last_seen_at = excluded.last_seen_at,
        last_path = excluded.last_path,
        route_group = excluded.route_group,
        device_type = excluded.device_type,
        browser_name = excluded.browser_name,
        os_name = excluded.os_name,
        timezone = excluded.timezone,
        language = excluded.language,
        is_authenticated = excluded.is_authenticated,
        user_role = excluded.user_role
    `).run(event.sessionId, event.userId, event.ipHash, event.createdAt, event.createdAt, event.path, event.routeGroup, event.deviceType, event.browserName, event.osName,
      event.timezone, event.language, event.isAuthenticated, event.userRole);
    const pageViews = event.eventType === 'page_view' ? 1 : 0;
    const heartbeats = event.eventType === 'page_heartbeat' ? 1 : 0;
    const featureEvents = event.eventType === 'feature' ? 1 : 0;
    const durationTotal = event.eventType === 'page_duration' ? event.durationSeconds || 0 : 0;
    const durationSamples = event.eventType === 'page_duration' ? 1 : 0;
    const bucket = bucketHour(event.createdAt);
    for (const dim of rollupDimensions(event)) {
      db.prepare(`
        INSERT INTO analytics_hourly_rollups (
          bucket_at, dimension_type, dimension_key, page_views, duration_total_seconds, duration_samples, heartbeats, feature_events, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bucket_at, dimension_type, dimension_key) DO UPDATE SET
          page_views = page_views + excluded.page_views,
          duration_total_seconds = duration_total_seconds + excluded.duration_total_seconds,
          duration_samples = duration_samples + excluded.duration_samples,
          heartbeats = heartbeats + excluded.heartbeats,
          feature_events = feature_events + excluded.feature_events,
          updated_at = excluded.updated_at
      `).run(bucket, dim.type, dim.key.slice(0, 384), pageViews, durationTotal, durationSamples, heartbeats, featureEvents, event.createdAt);
    }
  });
  tx();
};

export const recordSiteInsightEvent = async (payload: AnalyticsPayload, req: Request) => {
  if (process.env.SITE_INSIGHTS_ENABLED === 'false') return false;
  if (getDbMode() === 'SUPABASE') return false;
  if (getDbMode() === 'MYSQL' && getSqlDialect() === 'postgres') return false;
  const event = buildEvent(payload, req);
  if (!event) return false;
  enqueueEvent(event);
  return true;
};

const executeAll = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
  if (getDbMode() === 'MYSQL') return getMysqlDb().all<T>(sql, params);
  if (getDbMode() === 'LOCAL_SQL') return getSqliteDb().prepare(sql).all(...params) as T[];
  return [];
};

const executeGet = async <T = any>(sql: string, params: any[] = []): Promise<T | undefined> => {
  const rows = await executeAll<T>(sql, params);
  return rows[0];
};

const timeBucketSql = (source: string, granularity: InsightsGranularity) => {
  if (getDbMode() === 'LOCAL_SQL') {
    if (granularity === 'month') return `strftime('%Y-%m-01 00:00:00', ${source})`;
    if (granularity === 'day') return `strftime('%Y-%m-%d 00:00:00', ${source})`;
    return `strftime('%Y-%m-%d %H:00:00', ${source})`;
  }
  if (getSqlDialect() === 'postgres') {
    return `date_trunc('${granularity}', ${source})`;
  }
  if (granularity === 'month') return `DATE_FORMAT(${source}, '%Y-%m-01 00:00:00')`;
  if (granularity === 'day') return `DATE_FORMAT(${source}, '%Y-%m-%d 00:00:00')`;
  return `DATE_FORMAT(${source}, '%Y-%m-%d %H:00:00')`;
};

const appendRange = (column: string, range: InsightsRange, params: any[]) => {
  const start = rangeStartSql(range);
  if (!start) return '';
  params.push(start);
  return ` AND ${column} >= ?`;
};

export const getSiteInsights = async (range: InsightsRange, granularity: InsightsGranularity): Promise<SiteInsightsResponse> => {
  if (
    process.env.SITE_INSIGHTS_ENABLED === 'false' ||
    getDbMode() === 'SUPABASE' ||
    (getDbMode() === 'MYSQL' && getSqlDialect() === 'postgres')
  ) {
    return buildDisabledInsights(range, granularity);
  }
  if (pendingEvents.length > 0) await flushPendingEvents();
  await ensureSchema();
  const cacheKey = `${range}:${granularity}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const eventParams: any[] = [];
  const eventRangeSql = appendRange('created_at', range, eventParams);
  const sessionParams: any[] = [];
  const sessionRangeSql = appendRange('last_seen_at', range, sessionParams);
  const rollupParams: any[] = ['total'];
  const rollupRangeSql = appendRange('bucket_at', range, rollupParams);
  const activeSince = nowSql(new Date(Date.now() - ACTIVE_WINDOW_MS));
  const timelineBucket = timeBucketSql('bucket_at', granularity);
  const eventBucket = timeBucketSql('created_at', granularity);
  const startAt = rangeStartSql(range);
  const rollupDimensionRangeSql = startAt ? ' AND bucket_at >= ?' : '';
  const rollupDimensionParams = () => (startAt ? [startAt] : []);

  const [
    rollupSummary,
    sessionSummary,
    activeSummary,
    timelineRows,
    timelineSessionRows,
    pageRows,
    pageSessionRows,
    deviceRows,
    routeRows,
    featureRows,
    navigationRows,
    notificationRows,
    activeRows
  ] = await Promise.all([
    executeGet<any>(`
      SELECT
        SUM(page_views) AS page_views,
        SUM(feature_events) AS feature_events,
        SUM(duration_total_seconds) AS duration_total,
        SUM(duration_samples) AS duration_samples,
        SUM(heartbeats) AS heartbeats
      FROM analytics_hourly_rollups
      WHERE dimension_type = 'total' ${rollupDimensionRangeSql}
    `, rollupDimensionParams()),
    executeGet<any>(`
      SELECT
        COUNT(*) AS sessions,
        COUNT(DISTINCT COALESCE(user_id, session_id)) AS visitors
      FROM analytics_sessions
      WHERE 1=1 ${sessionRangeSql}
    `, sessionParams),
    executeGet<any>('SELECT COUNT(*) AS active_sessions_5m FROM analytics_sessions WHERE last_seen_at >= ?', [activeSince]),
    executeAll<any>(`
      SELECT ${timelineBucket} AS bucket,
             SUM(page_views) AS views,
             SUM(duration_total_seconds) AS duration_total,
             SUM(duration_samples) AS duration_samples,
             SUM(heartbeats) AS heartbeats,
             SUM(feature_events) AS feature_events
        FROM analytics_hourly_rollups
       WHERE dimension_type = ? ${rollupRangeSql}
       GROUP BY bucket
       ORDER BY bucket ASC
    `, rollupParams),
    executeAll<any>(`
      SELECT ${eventBucket} AS bucket,
             COUNT(DISTINCT session_id) AS sessions,
             COUNT(DISTINCT COALESCE(user_id, session_id)) AS visitors
        FROM analytics_events
       WHERE 1=1 ${eventRangeSql}
       GROUP BY bucket
    `, eventParams),
    executeAll<any>(`
      SELECT dimension_key AS path,
             SUM(page_views) AS views,
             SUM(duration_total_seconds) AS duration_total,
             SUM(duration_samples) AS duration_samples
        FROM analytics_hourly_rollups
       WHERE dimension_type = 'path' ${rollupDimensionRangeSql}
       GROUP BY dimension_key
       ORDER BY views DESC
       LIMIT 30
    `, rollupDimensionParams()),
    executeAll<any>(`
      SELECT path, route_group,
             COUNT(DISTINCT session_id) AS sessions
        FROM analytics_events
       WHERE event_type = 'page_view' ${eventRangeSql}
       GROUP BY path, route_group
    `, eventParams),
    executeAll<any>(`
      SELECT dimension_key,
             SUM(page_views) AS views
       FROM analytics_hourly_rollups
       WHERE dimension_type = 'device' ${rollupDimensionRangeSql}
       GROUP BY dimension_key
       ORDER BY views DESC
       LIMIT 40
    `, rollupDimensionParams()),
    executeAll<any>(`
      SELECT dimension_key AS route_group,
             SUM(page_views) AS views
        FROM analytics_hourly_rollups
       WHERE dimension_type = 'route' ${rollupDimensionRangeSql}
       GROUP BY dimension_key
       ORDER BY views DESC
       LIMIT 30
    `, rollupDimensionParams()),
    executeAll<any>(`
      SELECT dimension_key AS feature_name,
             SUM(feature_events) AS count
        FROM analytics_hourly_rollups
       WHERE dimension_type = 'feature' ${rollupDimensionRangeSql}
       GROUP BY dimension_key
       ORDER BY count DESC
       LIMIT 30
    `, rollupDimensionParams()),
    executeAll<any>(`
      SELECT feature_props_json, COUNT(*) AS count
        FROM analytics_events
       WHERE event_type = 'feature'
         AND feature_name = 'chikapo_navigation_select' ${eventRangeSql}
       GROUP BY feature_props_json
       ORDER BY count DESC
       LIMIT 20
    `, eventParams),
    executeAll<any>(`
      SELECT feature_props_json, COUNT(*) AS opens
        FROM analytics_events
       WHERE event_type = 'feature'
         AND feature_name = 'chikapo_notification_open' ${eventRangeSql}
       GROUP BY feature_props_json
       ORDER BY opens DESC
       LIMIT 20
    `, eventParams),
    executeAll<any>(`
      SELECT ${timeBucketSql('last_seen_at', 'hour')} AS bucket,
             COUNT(*) AS active_sessions
        FROM analytics_sessions
       WHERE last_seen_at >= ?
       GROUP BY bucket
       ORDER BY bucket ASC
    `, [rangeStartSql(range) || nowSql(new Date(Date.now() - 24 * 60 * 60_000))])
  ]);

  const sessionByBucket = new Map(timelineSessionRows.map((row) => [
    stringValue(row.bucket),
    { sessions: numberValue(row.sessions), visitors: numberValue(row.visitors) }
  ]));
  const pageSessions = new Map(pageSessionRows.map((row) => [
    stringValue(row.path, '/'),
    { route_group: stringValue(row.route_group, getRouteGroup(String(row.path || '/'))), sessions: numberValue(row.sessions) }
  ]));
  const timeline = timelineRows.map((row) => {
    const bucket = stringValue(row.bucket);
    const sessions = sessionByBucket.get(bucket) || { sessions: 0, visitors: 0 };
    const durationSamples = numberValue(row.duration_samples);
    return {
      bucket: isoFromDb(bucket),
      views: numberValue(row.views),
      sessions: sessions.sessions,
      visitors: sessions.visitors,
      duration_samples: durationSamples,
      avg_duration_seconds: durationSamples > 0 ? Math.round(numberValue(row.duration_total) / durationSamples) : 0
    };
  });

  const pages = pageRows.map((row) => {
    const path = stringValue(row.path, '/');
    const sessions = pageSessions.get(path);
    const durationSamples = numberValue(row.duration_samples);
    return {
      path,
      route_group: sessions?.route_group || getRouteGroup(path),
      views: numberValue(row.views),
      sessions: sessions?.sessions || 0,
      avg_duration_seconds: durationSamples > 0 ? Math.round(numberValue(row.duration_total) / durationSamples) : 0,
      duration_samples: durationSamples
    };
  });

  const devices = deviceRows.map((row) => {
    const [deviceType = 'unknown', browserName = 'unknown', osName = 'unknown'] = stringValue(row.dimension_key).split('|');
    return {
      device_type: deviceType,
      browser_name: browserName,
      os_name: osName,
      views: numberValue(row.views),
      sessions: 0
    };
  });

  const durationSamples = numberValue(rollupSummary?.duration_samples);
  const generatedAt = new Date().toISOString();
  const data: SiteInsightsResponse = {
    enabled: true,
    range,
    granularity,
    generated_at: generatedAt,
    cached_until: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    retention_days: EVENT_RETENTION_DAYS,
    summary: {
      page_views: numberValue(rollupSummary?.page_views),
      sessions: numberValue(sessionSummary?.sessions),
      visitors: numberValue(sessionSummary?.visitors),
      active_sessions_5m: numberValue(activeSummary?.active_sessions_5m),
      avg_duration_seconds: durationSamples > 0 ? Math.round(numberValue(rollupSummary?.duration_total) / durationSamples) : 0,
      feature_events: numberValue(rollupSummary?.feature_events),
      heartbeats: numberValue(rollupSummary?.heartbeats)
    },
    timeline,
    hourly: timeline.map((row) => ({ bucket: row.bucket, views: row.views, sessions: row.sessions, visitors: row.visitors })),
    active_hourly: activeRows.map((row) => ({ bucket: isoFromDb(row.bucket), active_sessions: numberValue(row.active_sessions), heartbeats: 0 })),
    pages,
    devices,
    route_groups: routeRows.map((row) => ({ route_group: stringValue(row.route_group, 'main'), views: numberValue(row.views), sessions: 0 })),
    features: featureRows.map((row) => ({ feature_name: stringValue(row.feature_name), count: numberValue(row.count) })),
    navigation: navigationRows.map((row) => ({
      from_tab: getFeatureProp(row.feature_props_json, 'from_tab'),
      to_tab: getFeatureProp(row.feature_props_json, 'to_tab'),
      surface: getFeatureProp(row.feature_props_json, 'surface'),
      count: numberValue(row.count)
    })),
    notifications: notificationRows.map((row) => ({
      group_key: getFeatureProp(row.feature_props_json, 'group_key'),
      opens: numberValue(row.opens)
    }))
  };

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data });
  return data;
};
