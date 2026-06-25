import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const rootDir = process.cwd();
const reportDir = path.join(rootDir, 'reports');
const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, '-');

const baseUrl = normalizeBaseUrl(process.env.ARENA_BASE_URL || 'http://127.0.0.1:2083/api');
const authCookie = process.env.ARENA_AUTH_COOKIE || '';
const adminCookie = process.env.ARENA_ADMIN_COOKIE || '';
const maxLatencyMs = readPositiveInt('ARENA_MAX_LATENCY_MS', 1500, 100, 30000);
const loadMaxP95Ms = readPositiveInt('ARENA_LOAD_MAX_P95_MS', 1500, 100, 30000);
const loadMaxP99Ms = readPositiveInt('ARENA_LOAD_MAX_P99_MS', 3000, 100, 60000);
const loadRequests = readPositiveInt('ARENA_LOAD_REQUESTS', 0, 0, 1000);
const loadConcurrency = readPositiveInt('ARENA_LOAD_CONCURRENCY', 4, 1, 16);
const requestTimeoutMs = readPositiveInt('ARENA_REQUEST_TIMEOUT_MS', 5000, 500, 30000);

const publicChecks = [
  endpoint('public:system-status', 'GET', '/arena/system-status', { critical: true }),
  endpoint('public:current-season', 'GET', '/arena/seasons/current', { critical: true }),
  endpoint('public:rules-catalog', 'GET', '/arena/rules/catalog', { critical: true }),
  endpoint('public:cards', 'GET', '/arena/cards?limit=10', { critical: true }),
  endpoint('public:rankings', 'GET', '/arena/rankings?limit=20', { critical: true }),
  endpoint('public:cup-status', 'GET', '/arena/cups/status', { critical: false }),
];

const userChecks = authCookie
  ? [
      endpoint('user:owned-cards', 'GET', '/arena/cards/owned?limit=12', { cookie: authCookie }),
      endpoint('user:decks', 'GET', '/arena/decks', { cookie: authCookie }),
      endpoint('user:recent-matches', 'GET', '/arena/matches/recent?limit=8', { cookie: authCookie }),
      endpoint('user:profile', 'GET', '/arena/profile/me', { cookie: authCookie }),
      endpoint('user:streamer-card', 'GET', '/arena/streamer-card/me', { cookie: authCookie, critical: false }),
      endpoint('user:arena-cosmetic-items', 'GET', '/arena/cosmetics/shop-items', { cookie: authCookie }),
      endpoint('user:arena-cosmetic-counts', 'GET', '/arena/cosmetics/inventory-counts', { cookie: authCookie }),
      endpoint('user:arena-cosmetic-loadout', 'GET', '/arena/cosmetics/loadout', { cookie: authCookie }),
    ]
  : [];

const adminChecks = adminCookie
  ? [
      endpoint('admin:system', 'GET', '/admin/arena/system', { cookie: adminCookie }),
      endpoint('admin:jobs', 'GET', '/admin/arena/jobs?limit=8', { cookie: adminCookie }),
      endpoint('admin:quick-match', 'GET', '/admin/arena/quick-match', { cookie: adminCookie }),
      endpoint('admin:cups', 'GET', '/admin/arena/cups', { cookie: adminCookie }),
      endpoint('admin:stats', 'GET', '/admin/arena/stats?limit=300', { cookie: adminCookie }),
    ]
  : [];

const checks = [...publicChecks, ...userChecks, ...adminChecks];
const results = [];

for (const check of checks) {
  results.push(await runCheck(check));
}

let loadSummary = null;
if (loadRequests > 0) {
  loadSummary = await runLightLoad(publicChecks, loadRequests, loadConcurrency);
}

const failures = results.filter((result) => result.critical && !result.ok);
const latencyFailures = results.filter((result) => result.ok && result.latency_ms > maxLatencyMs);
const loadFailures = loadSummary && (loadSummary.failed > 0 || loadSummary.p95_ms > loadMaxP95Ms || loadSummary.p99_ms > loadMaxP99Ms)
  ? [loadSummary]
  : [];

const report = {
  generated_at: now.toISOString(),
  base_url: baseUrl,
  max_latency_ms: maxLatencyMs,
  load_max_p95_ms: loadMaxP95Ms,
  load_max_p99_ms: loadMaxP99Ms,
  request_timeout_ms: requestTimeoutMs,
  auth_checks_enabled: Boolean(authCookie),
  admin_checks_enabled: Boolean(adminCookie),
  load: loadSummary,
  summary: {
    total: results.length,
    ok: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    critical_failed: failures.length,
    latency_failed: latencyFailures.length,
    load_failed: loadFailures.length,
  },
  results,
};

await mkdir(reportDir, { recursive: true });
const jsonPath = path.join(reportDir, `arena-readiness-${stamp}.json`);
const csvPath = path.join(reportDir, `arena-readiness-${stamp}.csv`);
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(csvPath, toCsv(results, loadSummary), 'utf8');

printSummary(report, jsonPath, csvPath);

if (failures.length > 0 || latencyFailures.length > 0 || loadFailures.length > 0) {
  process.exitCode = 1;
}

function endpoint(name, method, route, options = {}) {
  return {
    name,
    method,
    route,
    critical: options.critical ?? true,
    cookie: options.cookie || '',
  };
}

async function runCheck(check) {
  const url = `${baseUrl}${check.route}`;
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: check.method,
      headers: requestHeaders(check.cookie),
      signal: controller.signal,
    });
    const body = await response.text();
    const latencyMs = Math.round(performance.now() - startedAt);
    const contentType = response.headers.get('content-type') || '';
    const cacheControl = response.headers.get('cache-control') || '';
    const rateLimitLimit = response.headers.get('x-ratelimit-limit') || '';
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining') || '';
    const retryAfter = response.headers.get('retry-after') || '';

    return {
      name: check.name,
      method: check.method,
      route: check.route,
      critical: check.critical,
      status: response.status,
      ok: response.ok,
      latency_ms: latencyMs,
      bytes: Buffer.byteLength(body),
      content_type: contentType,
      cache_control: cacheControl,
      rate_limit_limit: rateLimitLimit,
      rate_limit_remaining: rateLimitRemaining,
      retry_after: retryAfter,
      error: '',
    };
  } catch (error) {
    return {
      name: check.name,
      method: check.method,
      route: check.route,
      critical: check.critical,
      status: 0,
      ok: false,
      latency_ms: Math.round(performance.now() - startedAt),
      bytes: 0,
      content_type: '',
      cache_control: '',
      rate_limit_limit: '',
      rate_limit_remaining: '',
      retry_after: '',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runLightLoad(endpoints, requestCount, concurrency) {
  const queue = Array.from({ length: requestCount }, (_, index) => endpoints[index % endpoints.length]);
  const loadResults = [];
  let cursor = 0;
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (cursor < queue.length) {
        const index = cursor;
        cursor += 1;
        const result = await runCheck({ ...queue[index], critical: false });
        loadResults.push(result);
      }
    }),
  );

  const latencies = loadResults.map((result) => result.latency_ms).sort((a, b) => a - b);
  const failed = loadResults.filter((result) => !result.ok).length;
  return {
    enabled: true,
    requests: requestCount,
    concurrency,
    duration_ms: Math.round(performance.now() - startedAt),
    ok: loadResults.length - failed,
    failed,
    p50_ms: percentile(latencies, 0.5),
    p95_ms: percentile(latencies, 0.95),
    p99_ms: percentile(latencies, 0.99),
  };
}

function requestHeaders(cookie) {
  const headers = {
    accept: 'application/json',
    'user-agent': 'chikapo-arena-readiness/1.0',
  };
  if (cookie) {
    headers.cookie = cookie;
  }
  return headers;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function readPositiveInt(name, defaultValue, min, max) {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, value));
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1);
  return sortedValues[index];
}

function toCsv(rows, load) {
  const header = [
    'kind',
    'name',
    'method',
    'route',
    'critical',
    'status',
    'ok',
    'latency_ms',
    'bytes',
    'content_type',
    'cache_control',
    'rate_limit_limit',
    'rate_limit_remaining',
    'retry_after',
    'error',
  ];
  const body = rows.map((row) =>
    [
      'smoke',
      row.name,
      row.method,
      row.route,
      row.critical,
      row.status,
      row.ok,
      row.latency_ms,
      row.bytes,
      row.content_type,
      row.cache_control,
      row.rate_limit_limit,
      row.rate_limit_remaining,
      row.retry_after,
      row.error,
    ]
      .map(csvCell)
      .join(','),
  );

  if (load) {
    const loadOk = load.failed === 0 && load.p95_ms <= loadMaxP95Ms && load.p99_ms <= loadMaxP99Ms;
    body.push(
      [
        'load',
        'summary',
        '',
        '',
        false,
        '',
        loadOk,
        load.p95_ms,
        '',
        '',
        '',
        '',
        '',
        '',
        `requests=${load.requests}; concurrency=${load.concurrency}; failed=${load.failed}; p50=${load.p50_ms}; p99=${load.p99_ms}`,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  return `${header.join(',')}\n${body.join('\n')}\n`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function printSummary(report, jsonPath, csvPath) {
  console.log(`Arena readiness report: ${report.summary.ok}/${report.summary.total} checks passed`);
  console.log(`Base URL: ${report.base_url}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`CSV: ${csvPath}`);

  for (const result of report.results) {
    const marker = result.ok ? 'OK' : 'FAIL';
    const critical = result.critical ? 'critical' : 'optional';
    const status = result.status || 'ERR';
    console.log(`${marker} ${result.name} ${status} ${result.latency_ms}ms ${critical}`);
  }

  if (report.load) {
    const loadOk = report.load.failed === 0 && report.load.p95_ms <= report.load_max_p95_ms && report.load.p99_ms <= report.load_max_p99_ms;
    console.log(
      `${loadOk ? 'OK' : 'FAIL'} LOAD requests=${report.load.requests} concurrency=${report.load.concurrency} p95=${report.load.p95_ms}ms p99=${report.load.p99_ms}ms failed=${report.load.failed}`,
    );
  }
}
