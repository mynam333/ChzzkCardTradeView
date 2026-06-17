type HogQLResponse = {
  results?: unknown[][];
  columns?: string[];
  error?: string;
  detail?: string;
};

export type InsightsRange = '24h' | '7d' | '30d';

export type PosthogInsightsResponse = {
  enabled: boolean;
  range: InsightsRange;
  generated_at: string;
  cached_until: string | null;
  summary: {
    page_views: number;
    sessions: number;
    visitors: number;
    active_sessions_5m: number;
    avg_duration_seconds: number;
  };
  hourly: Array<{
    bucket: string;
    views: number;
    sessions: number;
    visitors: number;
  }>;
  active_hourly: Array<{
    bucket: string;
    active_sessions: number;
    heartbeats: number;
  }>;
  pages: Array<{
    path: string;
    route_group: string;
    views: number;
    sessions: number;
    avg_duration_seconds: number;
    duration_samples: number;
  }>;
  devices: Array<{
    device_type: string;
    browser_name: string;
    os_name: string;
    views: number;
    sessions: number;
  }>;
  route_groups: Array<{
    route_group: string;
    views: number;
    sessions: number;
  }>;
  navigation: Array<{
    from_tab: string;
    to_tab: string;
    surface: string;
    count: number;
  }>;
  notifications: Array<{
    group_key: string;
    opens: number;
  }>;
};

const RANGE_DAYS: Record<InsightsRange, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30
};

const cache = new Map<string, { expiresAt: number; staleUntil: number; data: PosthogInsightsResponse }>();
const inFlight = new Map<string, Promise<PosthogInsightsResponse>>();

const getCacheTtlMs = () => Math.max(10_000, Number(process.env.POSTHOG_INSIGHTS_CACHE_TTL_MS || 60_000));
const getStaleTtlMs = () => Math.max(getCacheTtlMs(), Number(process.env.POSTHOG_INSIGHTS_STALE_TTL_MS || 10 * 60_000));
const getQueryTimeoutMs = () => Math.max(5_000, Number(process.env.POSTHOG_QUERY_TIMEOUT_MS || 20_000));
const getMaxConcurrentQueries = () => Math.max(1, Math.min(10, Number(process.env.POSTHOG_INSIGHTS_MAX_CONCURRENT_QUERIES || 4)));
const getApiHost = () => (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/+$/, '');

export const normalizeInsightsRange = (value: unknown): InsightsRange => {
  if (value === '24h' || value === '7d' || value === '30d') return value;
  return '7d';
};

const numberValue = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const stringValue = (value: unknown, fallback = 'unknown') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const rowsToObjects = (response: HogQLResponse): Record<string, unknown>[] => {
  const columns = response.columns || [];
  const results = response.results || [];
  return results.map((row) => {
    const object: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      object[column] = row[index];
    });
    return object;
  });
};

const posthogQuery = async (query: string, name: string): Promise<Record<string, unknown>[]> => {
  const token = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!token || !projectId) {
    throw new Error('POSTHOG_NOT_CONFIGURED');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getQueryTimeoutMs());
  try {
    const res = await fetch(`${getApiHost()}/api/projects/${encodeURIComponent(projectId)}/query/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        name,
        query: {
          kind: 'HogQLQuery',
          query
        }
      }),
      signal: controller.signal
    });

    const data = await res.json().catch(() => ({})) as HogQLResponse;
    if (!res.ok) {
      throw new Error(data.detail || data.error || `PostHog query failed with ${res.status}`);
    }
    return rowsToObjects(data);
  } finally {
    clearTimeout(timer);
  }
};

const buildSinceSql = (range: InsightsRange) => `timestamp >= now() - INTERVAL ${RANGE_DAYS[range]} DAY`;

const runLimited = async <T>(tasks: Array<() => Promise<T>>, maxConcurrent: number): Promise<T[]> => {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  };

  const workers = Array.from({ length: Math.min(maxConcurrent, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
};

const buildDisabledInsights = (range: InsightsRange): PosthogInsightsResponse => {
  const generatedAt = new Date().toISOString();
  return {
    enabled: false,
    range,
    generated_at: generatedAt,
    cached_until: null,
    summary: { page_views: 0, sessions: 0, visitors: 0, active_sessions_5m: 0, avg_duration_seconds: 0 },
    hourly: [],
    active_hourly: [],
    pages: [],
    devices: [],
    route_groups: [],
    navigation: [],
    notifications: []
  };
};

const refreshPosthogInsights = (range: InsightsRange, cacheKey: string): Promise<PosthogInsightsResponse> => {
  const current = inFlight.get(cacheKey);
  if (current) return current;

  const request = (async () => {
    const sinceSql = buildSinceSql(range);
    const [
      summaryRows,
      activeRows,
      hourlyRows,
      activeHourlyRows,
      pageRows,
      durationRows,
      deviceRows,
      routeRows,
      navigationRows,
      notificationRows
    ] = await runLimited([
      () => posthogQuery(`
        SELECT
          count() AS page_views,
          uniq(properties.session_id) AS sessions,
          uniq(distinct_id) AS visitors
        FROM events
        WHERE event = 'chikapo_page_view'
          AND ${sinceSql}
      `, `chikapo insight summary ${range}`),
      () => posthogQuery(`
        SELECT uniq(properties.session_id) AS active_sessions_5m
        FROM events
        WHERE event = 'chikapo_page_heartbeat'
          AND timestamp >= now() - INTERVAL 5 MINUTE
      `, 'chikapo insight active sessions 5m'),
      () => posthogQuery(`
        SELECT
          toStartOfHour(timestamp) AS bucket,
          count() AS views,
          uniq(properties.session_id) AS sessions,
          uniq(distinct_id) AS visitors
        FROM events
        WHERE event = 'chikapo_page_view'
          AND ${sinceSql}
        GROUP BY bucket
        ORDER BY bucket ASC
      `, `chikapo insight hourly ${range}`),
      () => posthogQuery(`
        SELECT
          toStartOfHour(timestamp) AS bucket,
          uniq(properties.session_id) AS active_sessions,
          count() AS heartbeats
        FROM events
        WHERE event = 'chikapo_page_heartbeat'
          AND ${sinceSql}
        GROUP BY bucket
        ORDER BY bucket ASC
      `, `chikapo insight active hourly ${range}`),
      () => posthogQuery(`
        SELECT
          properties.path AS path,
          properties.route_group AS route_group,
          count() AS views,
          uniq(properties.session_id) AS sessions
        FROM events
        WHERE event = 'chikapo_page_view'
          AND ${sinceSql}
        GROUP BY path, route_group
        ORDER BY views DESC
        LIMIT 30
      `, `chikapo insight pages ${range}`),
      () => posthogQuery(`
        SELECT
          properties.path AS path,
          avg(toFloat64OrNull(properties.duration_seconds)) AS avg_duration_seconds,
          count() AS duration_samples
        FROM events
        WHERE event = 'chikapo_page_duration'
          AND ${sinceSql}
        GROUP BY path
        ORDER BY avg_duration_seconds DESC
        LIMIT 100
      `, `chikapo insight durations ${range}`),
      () => posthogQuery(`
        SELECT
          properties.device_type AS device_type,
          properties.browser_name AS browser_name,
          properties.os_name AS os_name,
          count() AS views,
          uniq(properties.session_id) AS sessions
        FROM events
        WHERE event = 'chikapo_page_view'
          AND ${sinceSql}
        GROUP BY device_type, browser_name, os_name
        ORDER BY views DESC
        LIMIT 40
      `, `chikapo insight devices ${range}`),
      () => posthogQuery(`
        SELECT
          properties.route_group AS route_group,
          count() AS views,
          uniq(properties.session_id) AS sessions
        FROM events
        WHERE event = 'chikapo_page_view'
          AND ${sinceSql}
        GROUP BY route_group
        ORDER BY views DESC
        LIMIT 20
      `, `chikapo insight route groups ${range}`),
      () => posthogQuery(`
        SELECT
          properties.from_tab AS from_tab,
          properties.to_tab AS to_tab,
          properties.surface AS surface,
          count() AS count
        FROM events
        WHERE event = 'chikapo_navigation_select'
          AND ${sinceSql}
        GROUP BY from_tab, to_tab, surface
        ORDER BY count DESC
        LIMIT 20
      `, `chikapo insight navigation ${range}`),
      () => posthogQuery(`
        SELECT
          properties.group_key AS group_key,
          count() AS opens
        FROM events
        WHERE event = 'chikapo_notification_open'
          AND ${sinceSql}
        GROUP BY group_key
        ORDER BY opens DESC
        LIMIT 20
      `, `chikapo insight notifications ${range}`)
    ], getMaxConcurrentQueries());

    const summary = summaryRows[0] || {};
    const active = activeRows[0] || {};
    const durationByPath = new Map(durationRows.map((row) => [
      stringValue(row.path, '/'),
      {
        avg_duration_seconds: Math.round(numberValue(row.avg_duration_seconds)),
        duration_samples: numberValue(row.duration_samples)
      }
    ]));
    const totalDurationSeconds = durationRows.reduce((sum, row) => (
      sum + numberValue(row.avg_duration_seconds) * numberValue(row.duration_samples)
    ), 0);
    const totalDurationSamples = durationRows.reduce((sum, row) => sum + numberValue(row.duration_samples), 0);
    const refreshedAt = Date.now();
    const expiresAt = refreshedAt + getCacheTtlMs();
    const staleUntil = refreshedAt + getStaleTtlMs();
    const data: PosthogInsightsResponse = {
      enabled: true,
      range,
      generated_at: new Date().toISOString(),
      cached_until: new Date(expiresAt).toISOString(),
      summary: {
        page_views: numberValue(summary.page_views),
        sessions: numberValue(summary.sessions),
        visitors: numberValue(summary.visitors),
        active_sessions_5m: numberValue(active.active_sessions_5m),
        avg_duration_seconds: totalDurationSamples > 0 ? Math.round(totalDurationSeconds / totalDurationSamples) : 0
      },
      hourly: hourlyRows.map((row) => ({
        bucket: stringValue(row.bucket),
        views: numberValue(row.views),
        sessions: numberValue(row.sessions),
        visitors: numberValue(row.visitors)
      })),
      active_hourly: activeHourlyRows.map((row) => ({
        bucket: stringValue(row.bucket),
        active_sessions: numberValue(row.active_sessions),
        heartbeats: numberValue(row.heartbeats)
      })),
      pages: pageRows.map((row) => {
        const path = stringValue(row.path, '/');
        const duration = durationByPath.get(path) || { avg_duration_seconds: 0, duration_samples: 0 };
        return {
          path,
          route_group: stringValue(row.route_group, 'main'),
          views: numberValue(row.views),
          sessions: numberValue(row.sessions),
          avg_duration_seconds: duration.avg_duration_seconds,
          duration_samples: duration.duration_samples
        };
      }),
      devices: deviceRows.map((row) => ({
        device_type: stringValue(row.device_type),
        browser_name: stringValue(row.browser_name),
        os_name: stringValue(row.os_name),
        views: numberValue(row.views),
        sessions: numberValue(row.sessions)
      })),
      route_groups: routeRows.map((row) => ({
        route_group: stringValue(row.route_group, 'main'),
        views: numberValue(row.views),
        sessions: numberValue(row.sessions)
      })),
      navigation: navigationRows.map((row) => ({
        from_tab: stringValue(row.from_tab),
        to_tab: stringValue(row.to_tab),
        surface: stringValue(row.surface),
        count: numberValue(row.count)
      })),
      notifications: notificationRows.map((row) => ({
        group_key: stringValue(row.group_key, 'none'),
        opens: numberValue(row.opens)
      }))
    };

    cache.set(cacheKey, { data, expiresAt, staleUntil });
    return data;
  })().finally(() => {
    inFlight.delete(cacheKey);
  });

  inFlight.set(cacheKey, request);
  return request;
};

export const getPosthogInsights = async (range: InsightsRange): Promise<PosthogInsightsResponse> => {
  const token = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const now = Date.now();
  const cacheKey = range;

  if (!token || !projectId) return buildDisabledInsights(range);

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.data;

  if (cached && cached.staleUntil > now) {
    if (!inFlight.has(cacheKey)) {
      refreshPosthogInsights(range, cacheKey).catch((err: any) => {
        console.warn('[PostHogInsights] stale 캐시 갱신 실패:', err?.message || err);
      });
    }
    return cached.data;
  }

  return refreshPosthogInsights(range, cacheKey);
};
