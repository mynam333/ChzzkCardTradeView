import { Request, Response } from 'express';
import webpush from 'web-push';
import cron from 'node-cron';
import https from 'node:https';
import { createHash, ECDH } from 'node:crypto';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from '../services/db';
import { AuthenticatedRequest } from '../middlewares/admin';
import { CORS_ALLOWED_ORIGINS, IS_PRODUCTION } from '../config';
import { couponRepository } from '../repositories';
import { normalizeCouponCode } from '../utils/couponCode';
import { buildCouponPushUrl } from '../utils/pushTarget';
import {
  filterPushSubscriptionsByOrigin,
  getConfiguredPushOrigins,
  getRequestPushOrigin,
  isPushOriginAllowed
} from '../utils/pushOrigin';
import {
  createPinnedLookup,
  OutboundNetworkSafetyError,
  type OutboundHostValidationCache,
  validateSafeOutboundUrl
} from '../utils/outboundNetworkSafety';

const PUSH_SEND_BATCH_SIZE = Math.max(1, Number(process.env.PUSH_SEND_BATCH_SIZE || 25));
const PUSH_SEND_BATCH_DELAY_MS = Math.max(0, Number(process.env.PUSH_SEND_BATCH_DELAY_MS || 200));
const PUSH_SUBSCRIPTION_FETCH_BATCH_SIZE = Math.max(1, Number(process.env.PUSH_SUBSCRIPTION_FETCH_BATCH_SIZE || 500));
const PUSH_SCHEDULED_MAX_PER_TICK = Math.max(1, Number(process.env.PUSH_SCHEDULED_MAX_PER_TICK || 5));
const PUSH_SEND_DEFAULT_TIMEOUT_MS = 10_000;
const PUSH_SEND_MIN_TIMEOUT_MS = 1_000;
const PUSH_SEND_MAX_TIMEOUT_MS = 60_000;
const PUSH_DELIVERY_DEFAULT_MAX_CONCURRENT = 4;
const PUSH_DELIVERY_HARD_MAX_CONCURRENT = 16;
const PUSH_DELIVERY_DEFAULT_MAX_QUEUED = 64;
const PUSH_DELIVERY_HARD_MAX_QUEUED = 256;
const PUSH_DELIVERY_DEFAULT_MAX_PENDING_PER_USER = 2;
const PUSH_DELIVERY_HARD_MAX_PENDING_PER_USER = 4;
export const PUSH_ENDPOINT_MAX_LENGTH = 768;
const PUSH_ENDPOINT_MAX_PATH_AND_QUERY_LENGTH = 700;
export const PUSH_MAX_SUBSCRIPTIONS_PER_USER = 8;
const PUSH_AUTH_KEY_MAX_LENGTH = 64;
const PUSH_P256DH_KEY_MAX_LENGTH = 160;

const EXACT_WEB_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com'
]);
const WEB_PUSH_HOST_SUFFIXES = [
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com'
];

const normalizeBoundedPositiveInteger = (value: unknown, fallback: number, hardMax: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, hardMax);
};

export const normalizePushDeliverySchedulerConfig = (input: {
  maxConcurrent?: unknown;
  maxQueued?: unknown;
  maxPendingPerUser?: unknown;
}) => ({
  maxConcurrent: normalizeBoundedPositiveInteger(
    input.maxConcurrent,
    PUSH_DELIVERY_DEFAULT_MAX_CONCURRENT,
    PUSH_DELIVERY_HARD_MAX_CONCURRENT
  ),
  maxQueued: normalizeBoundedPositiveInteger(
    input.maxQueued,
    PUSH_DELIVERY_DEFAULT_MAX_QUEUED,
    PUSH_DELIVERY_HARD_MAX_QUEUED
  ),
  maxPendingPerUser: normalizeBoundedPositiveInteger(
    input.maxPendingPerUser,
    PUSH_DELIVERY_DEFAULT_MAX_PENDING_PER_USER,
    PUSH_DELIVERY_HARD_MAX_PENDING_PER_USER
  )
});

export type PushDeliveryScheduleResult = 'completed' | 'dropped';

type PushDeliveryJob = {
  userId: string;
  dedupeKey: string;
  task: () => Promise<void>;
  promise: Promise<PushDeliveryScheduleResult>;
  resolve: (result: PushDeliveryScheduleResult) => void;
  reject: (error: unknown) => void;
};

/**
 * Bounds all targeted push work before it performs a DB query or opens HTTPS
 * sockets. A user can have only one active delivery and a small pending set;
 * identical work shares one promise. Overflow is intentionally dropped so an
 * optional push can never backpressure or fail the primary application event.
 */
export const createPushDeliveryScheduler = (rawConfig: {
  maxConcurrent?: unknown;
  maxQueued?: unknown;
  maxPendingPerUser?: unknown;
}) => {
  const config = normalizePushDeliverySchedulerConfig(rawConfig);
  const queue: PushDeliveryJob[] = [];
  const activeUsers = new Set<string>();
  const pendingByUser = new Map<string, number>();
  const jobsByDedupeKey = new Map<string, Promise<PushDeliveryScheduleResult>>();
  let active = 0;
  let dropped = 0;

  const decrementPending = (userId: string) => {
    const next = (pendingByUser.get(userId) || 1) - 1;
    if (next > 0) pendingByUser.set(userId, next);
    else pendingByUser.delete(userId);
  };

  const drain = () => {
    while (active < config.maxConcurrent && queue.length > 0) {
      const index = queue.findIndex((candidate) => !activeUsers.has(candidate.userId));
      if (index < 0) return;
      const [job] = queue.splice(index, 1);
      active += 1;
      activeUsers.add(job.userId);

      void (async () => {
        let failed = false;
        let failure: unknown;
        try {
          await job.task();
        } catch (error) {
          failed = true;
          failure = error;
        } finally {
          active -= 1;
          activeUsers.delete(job.userId);
          decrementPending(job.userId);
          if (jobsByDedupeKey.get(job.dedupeKey) === job.promise) {
            jobsByDedupeKey.delete(job.dedupeKey);
          }
          drain();
        }
        if (failed) job.reject(failure);
        else job.resolve('completed');
      })();
    }
  };

  return {
    schedule(input: {
      userId: string;
      dedupeKey: string;
      task: () => Promise<void>;
    }): Promise<PushDeliveryScheduleResult> {
      const dedupeKey = `${input.userId}\u0000${input.dedupeKey}`;
      const existing = jobsByDedupeKey.get(dedupeKey);
      if (existing) return existing;

      const userPending = pendingByUser.get(input.userId) || 0;
      const canStartImmediately = active < config.maxConcurrent && !activeUsers.has(input.userId);
      if (
        userPending >= config.maxPendingPerUser ||
        (!canStartImmediately && queue.length >= config.maxQueued)
      ) {
        dropped += 1;
        return Promise.resolve('dropped');
      }

      let resolve!: (result: PushDeliveryScheduleResult) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<PushDeliveryScheduleResult>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      const job: PushDeliveryJob = {
        ...input,
        dedupeKey,
        promise,
        resolve,
        reject
      };
      pendingByUser.set(input.userId, userPending + 1);
      jobsByDedupeKey.set(dedupeKey, promise);
      queue.push(job);
      drain();
      return promise;
    },
    getStats() {
      return {
        active,
        queued: queue.length,
        pendingUsers: pendingByUser.size,
        pendingTotal: [...pendingByUser.values()].reduce((sum, value) => sum + value, 0),
        dropped
      };
    }
  };
};

export const normalizePushSendTimeoutMs = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) return PUSH_SEND_DEFAULT_TIMEOUT_MS;
  return Math.min(PUSH_SEND_MAX_TIMEOUT_MS, Math.max(PUSH_SEND_MIN_TIMEOUT_MS, parsed));
};

const PUSH_SEND_TIMEOUT_MS = normalizePushSendTimeoutMs(process.env.PUSH_SEND_TIMEOUT_MS);
const PUSH_DELIVERY_SCHEDULER_CONFIG = normalizePushDeliverySchedulerConfig({
  maxConcurrent: process.env.PUSH_USER_DELIVERY_MAX_CONCURRENT,
  maxQueued: process.env.PUSH_USER_DELIVERY_MAX_QUEUED,
  maxPendingPerUser: process.env.PUSH_USER_DELIVERY_MAX_PENDING_PER_USER
});
export const PUSH_USER_DELIVERY_MAX_CONCURRENT = PUSH_DELIVERY_SCHEDULER_CONFIG.maxConcurrent;
export const PUSH_USER_DELIVERY_MAX_QUEUED = PUSH_DELIVERY_SCHEDULER_CONFIG.maxQueued;
export const PUSH_USER_DELIVERY_MAX_PENDING_PER_USER = PUSH_DELIVERY_SCHEDULER_CONFIG.maxPendingPerUser;
const targetedPushDeliveryScheduler = createPushDeliveryScheduler(PUSH_DELIVERY_SCHEDULER_CONFIG);
let lastPushDeliveryDropWarningAt = 0;

export const buildWebPushRequestOptions = (timeoutMs = PUSH_SEND_TIMEOUT_MS) => ({
  TTL: 60 * 60,
  urgency: 'normal' as const,
  timeout: normalizePushSendTimeoutMs(timeoutMs)
});

export const isExpiredPushSubscriptionError = (error: any) => (
  error?.statusCode === 410 || error?.statusCode === 404
);

export const isKnownWebPushHostname = (rawHostname: string): boolean => {
  const hostname = rawHostname.trim().toLowerCase().replace(/\.$/, '');
  return EXACT_WEB_PUSH_HOSTS.has(hostname) || WEB_PUSH_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  );
};

export const validatePushEndpoint = async (
  endpoint: string,
  cache?: OutboundHostValidationCache
) => {
  const validated = await validateSafeOutboundUrl(endpoint, {
    allowedProtocols: ['https:'],
    allowHostname: isKnownWebPushHostname,
    maxLength: PUSH_ENDPOINT_MAX_LENGTH,
    rejectIpLiterals: true,
    dnsTimeoutMs: Math.min(2_000, PUSH_SEND_TIMEOUT_MS),
    cache
  });
  if (validated.url.port && validated.url.port !== '443') {
    throw new OutboundNetworkSafetyError('UNSAFE_PORT', 'Custom push endpoint ports are not allowed');
  }
  if (validated.url.hash) {
    throw new OutboundNetworkSafetyError('URL_FRAGMENT', 'Push endpoint fragments are not allowed');
  }
  if (`${validated.url.pathname}${validated.url.search}`.length > PUSH_ENDPOINT_MAX_PATH_AND_QUERY_LENGTH) {
    throw new OutboundNetworkSafetyError('URL_PATH_LENGTH', 'Push endpoint path is too long');
  }
  return validated;
};

const decodeCanonicalBase64Url = (rawValue: unknown, maxLength: number): Buffer | null => {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!value || value.length > maxLength || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  const unpadded = value.replace(/=+$/, '');
  try {
    const decoded = Buffer.from(unpadded, 'base64url');
    if (decoded.toString('base64url') !== unpadded) return null;
    return decoded;
  } catch {
    return null;
  }
};

export const normalizePushSubscriptionKeys = (
  rawAuthKey: unknown,
  rawP256dhKey: unknown
): { authKey: string; p256dhKey: string } | null => {
  const auth = decodeCanonicalBase64Url(rawAuthKey, PUSH_AUTH_KEY_MAX_LENGTH);
  const p256dh = decodeCanonicalBase64Url(rawP256dhKey, PUSH_P256DH_KEY_MAX_LENGTH);
  if (!auth || auth.byteLength !== 16) return null;
  if (!p256dh || p256dh.byteLength !== 65 || p256dh[0] !== 0x04) return null;
  try {
    ECDH.convertKey(p256dh, 'prime256v1', undefined, undefined, 'uncompressed');
  } catch {
    return null;
  }
  return {
    authKey: auth.toString('base64url'),
    p256dhKey: p256dh.toString('base64url')
  };
};

export const sendValidatedPushNotification = async (
  pushSubscription: webpush.PushSubscription,
  payload: string,
  cache?: OutboundHostValidationCache
) => {
  const validated = await validatePushEndpoint(pushSubscription.endpoint, cache);
  const agent = new https.Agent({
    keepAlive: false,
    lookup: createPinnedLookup(validated.url.hostname, validated.addresses)
  });
  try {
    return await webpush.sendNotification(
      { ...pushSubscription, endpoint: validated.url.toString() },
      payload,
      { ...buildWebPushRequestOptions(), agent }
    );
  } finally {
    agent.destroy();
  }
};
let warnedMissingPushOriginColumn = false;
let warnedMissingPushEndpointUniqueIndex = false;
const pushSubscribeLocks = new Map<string, Promise<void>>();

class PushSubscriptionLimitError extends Error {
  constructor() {
    super('PUSH_SUBSCRIPTION_LIMIT');
    this.name = 'PushSubscriptionLimitError';
  }
}

const assertPushSubscriptionCapacity = (count: number, endpointAlreadyOwned: boolean) => {
  if (!endpointAlreadyOwned && count >= PUSH_MAX_SUBSCRIPTIONS_PER_USER) {
    throw new PushSubscriptionLimitError();
  }
};

// VAPID 키는 dotenv.config() 이후에 읽어야 하므로 지연 초기화(Lazy Initialization) 사용
const getVapidKeys = () => ({
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || '',
});

/**
 * VAPID 초기화 함수 - app.ts에서 dotenv.config() 직후 호출해야 합니다.
 */
export const initVapid = () => {
  const { publicKey, privateKey } = getVapidKeys();
  if (publicKey && privateKey) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@yuaru.com',
      publicKey,
      privateKey
    );
    console.log('[Push] 웹 푸시 VAPID 설정이 성공적으로 로드되었습니다.');
  } else {
    console.warn('[Push] VAPID 키가 누락되었습니다. 푸시 알림 기능이 작동하지 않을 수 있습니다.');
  }
};

/**
 * 1. 푸시 알림 VAPID Public Key 조회 API
 */
export const getVapidPublicKey = (req: Request, res: Response) => {
  return res.status(200).json({ publicKey: getVapidKeys().publicKey });
};

const withPushSubscribeLock = async <T>(endpoint: string, task: () => Promise<T>): Promise<T> => {
  const previous = pushSubscribeLocks.get(endpoint) || Promise.resolve();
  let guard: Promise<void>;
  const next = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      if (pushSubscribeLocks.get(endpoint) === guard) {
        pushSubscribeLocks.delete(endpoint);
      }
    });
  guard = next.then(() => undefined, () => undefined);
  pushSubscribeLocks.set(endpoint, guard);
  return next;
};

const isMissingPushOriginColumnError = (error: any) => /origin|schema cache/i.test(error?.message || '');
const isMissingEndpointUniqueIndexError = (error: any) =>
  /no unique|on conflict|constraint|42P10/i.test(`${error?.code || ''} ${error?.message || ''}`);

const warnMissingPushOriginColumnOnce = () => {
  if (warnedMissingPushOriginColumn) return;
  console.warn('[Push] push_subscriptions.origin 컬럼이 없어 origin 없이 구독을 저장합니다. 마이그레이션을 적용하세요.');
  warnedMissingPushOriginColumn = true;
};

const warnMissingEndpointUniqueIndexOnce = () => {
  if (warnedMissingPushEndpointUniqueIndex) return;
  console.warn('[Push] push_subscriptions.endpoint unique index가 없어 delete/insert 폴백을 사용합니다. 마이그레이션을 적용하세요.');
  warnedMissingPushEndpointUniqueIndex = true;
};

const getEndpointHost = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-endpoint';
  }
};

const saveSupabasePushSubscription = async (
  client: ReturnType<typeof getSupabaseClient>,
  row: { user_id: string; endpoint: string; auth_key: string; p256dh_key: string; origin?: string | null }
) => {
  let { error } = await client
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'endpoint' });

  if (!error) return;

  if (isMissingPushOriginColumnError(error)) {
    warnMissingPushOriginColumnOnce();
    const fallbackRow = {
      user_id: row.user_id,
      endpoint: row.endpoint,
      auth_key: row.auth_key,
      p256dh_key: row.p256dh_key
    };
    const fallback = await client
      .from('push_subscriptions')
      .upsert(fallbackRow, { onConflict: 'endpoint' });
    error = fallback.error;
    if (!error) return;
  }

  if (isMissingEndpointUniqueIndexError(error)) {
    warnMissingEndpointUniqueIndexOnce();
    await client.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
    const insert = await client.from('push_subscriptions').insert(row);
    error = insert.error;
    if (error && isMissingPushOriginColumnError(error)) {
      warnMissingPushOriginColumnOnce();
      const fallback = await client
        .from('push_subscriptions')
        .insert({
          user_id: row.user_id,
          endpoint: row.endpoint,
          auth_key: row.auth_key,
          p256dh_key: row.p256dh_key
        });
      error = fallback.error;
    }
  }

  if (error) throw error;
};

/**
 * 2. 브라우저 푸시 알림 구독 정보 등록 API
 */
export const subscribePush = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { subscription, origin } = req.body; // { endpoint, keys: { auth, p256dh } }

  if (!userId || !subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 구독 정보 및 인증이 필요합니다.' });
  }

  const endpoint = String(subscription.endpoint || '').trim();
  const keys = normalizePushSubscriptionKeys(subscription.keys?.auth, subscription.keys?.p256dh);
  const subscriptionOrigin = getRequestPushOrigin(origin, req.get('origin'), req.get('referer'));
  const allowedOrigins = getConfiguredPushOrigins(process.env, CORS_ALLOWED_ORIGINS);

  if (!endpoint || !keys) {
    return res.status(400).json({
      error: 'BadRequest',
      message: '올바른 Web Push endpoint/auth/p256dh 구독 정보가 필요합니다.'
    });
  }
  const { authKey, p256dhKey } = keys;
  if (!isPushOriginAllowed(subscriptionOrigin, allowedOrigins)) {
    return res.status(403).json({ error: 'ForbiddenOrigin', message: '허용되지 않은 사이트의 푸시 구독입니다.' });
  }

  try {
    await validatePushEndpoint(endpoint);
  } catch {
    return res.status(400).json({
      error: 'InvalidPushEndpoint',
      message: '허용된 브라우저 푸시 서비스의 안전한 HTTPS endpoint가 필요합니다.'
    });
  }

  try {
    await withPushSubscribeLock(`user:${userId}`, async () => {
      const dbMode = getDbMode();

      if (dbMode === 'SUPABASE') {
        const client = getSupabaseClient();
        const countResult = await client
          .from('push_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        if (countResult.error) throw countResult.error;
        let endpointAlreadyOwned = false;
        if ((countResult.count || 0) >= PUSH_MAX_SUBSCRIPTIONS_PER_USER) {
          const existing = await client
            .from('push_subscriptions')
            .select('id')
            .eq('user_id', userId)
            .eq('endpoint', endpoint)
            .limit(1);
          if (existing.error) throw existing.error;
          endpointAlreadyOwned = Boolean(existing.data?.length);
        }
        assertPushSubscriptionCapacity(countResult.count || 0, endpointAlreadyOwned);
        await saveSupabasePushSubscription(client, {
          user_id: userId,
          endpoint,
          auth_key: authKey,
          p256dh_key: p256dhKey,
          origin: subscriptionOrigin
        });
      } else if (dbMode === 'MYSQL') {
        await getMysqlDb().transaction(async (tx) => {
          // Locking the user row serializes distinct-endpoint registrations for
          // the same account across API instances (including PostgreSQL mode).
          await tx.get('SELECT id FROM users WHERE id = ? FOR UPDATE', userId);
          const countRow = await tx.get<{ cnt: number | string }>(
            'SELECT COUNT(*) AS cnt FROM push_subscriptions WHERE user_id = ?',
            userId
          );
          const existing = await tx.get<{ id: number }>(
            'SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ? LIMIT 1',
            userId,
            endpoint
          );
          assertPushSubscriptionCapacity(Number(countRow?.cnt || 0), Boolean(existing));
          await tx.run(`
            INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh_key, origin, created_at)
            VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
              user_id = VALUES(user_id),
              auth_key = VALUES(auth_key),
              p256dh_key = VALUES(p256dh_key),
              origin = VALUES(origin)
          `, userId, endpoint, authKey, p256dhKey, subscriptionOrigin);
        });
      } else {
        const db = getSqliteDb();
        db.transaction(() => {
          const countRow = db.prepare(
            'SELECT COUNT(*) AS cnt FROM push_subscriptions WHERE user_id = ?'
          ).get(userId) as { cnt: number };
          const existing = db.prepare(
            'SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint = ? LIMIT 1'
          ).get(userId, endpoint);
          assertPushSubscriptionCapacity(Number(countRow?.cnt || 0), Boolean(existing));
          db.prepare(`
            INSERT INTO push_subscriptions (user_id, endpoint, auth_key, p256dh_key, origin, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(endpoint) DO UPDATE SET
              user_id = excluded.user_id,
              auth_key = excluded.auth_key,
              p256dh_key = excluded.p256dh_key,
              origin = excluded.origin
          `).run(userId, endpoint, authKey, p256dhKey, subscriptionOrigin);
        })();
      }
    });

    return res.status(201).json({ message: '푸시 알림 구독 등록이 완료되었습니다.' });
  } catch (err: any) {
    if (err instanceof PushSubscriptionLimitError) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({
        error: 'TooManyPushSubscriptions',
        message: `계정당 푸시 구독은 최대 ${PUSH_MAX_SUBSCRIPTIONS_PER_USER}개까지 등록할 수 있습니다.`
      });
    }
    console.error('[Push] 구독 등록 실패:', {
      user_id: userId,
      endpoint_host: getEndpointHost(endpoint),
      origin: subscriptionOrigin,
      code: err?.code,
      message: err?.message || err
    });
    return res.status(500).json({ error: 'InternalServerError', message: '구독 등록 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const uniqueByEndpoint = (subscriptions: any[]) =>
  Array.from(new Map(subscriptions.map((sub) => [sub.endpoint, sub])).values());

const deleteExpiredSubscriptions = async (dbMode: string, ids: any[]) => {
  const uniqueIds = Array.from(new Set(ids.filter((id) => id !== undefined && id !== null)));
  if (uniqueIds.length === 0) return;

  if (dbMode === 'SUPABASE') {
    const client = getSupabaseClient();
    for (let i = 0; i < uniqueIds.length; i += 500) {
      await client.from('push_subscriptions').delete().in('id', uniqueIds.slice(i, i + 500));
    }
    return;
  }

  if (dbMode === 'MYSQL') {
    for (let i = 0; i < uniqueIds.length; i += 500) {
      const group = uniqueIds.slice(i, i + 500);
      const placeholders = group.map(() => '?').join(',');
      await getMysqlDb().run(`DELETE FROM push_subscriptions WHERE id IN (${placeholders})`, group);
    }
    return;
  }

  const db = getSqliteDb();
  for (let i = 0; i < uniqueIds.length; i += 500) {
    const group = uniqueIds.slice(i, i + 500);
    const placeholders = group.map(() => '?').join(',');
    db.prepare(`DELETE FROM push_subscriptions WHERE id IN (${placeholders})`).run(...group);
  }
};

const loadPushSubscriptionBatch = async (dbMode: string, afterId: number | null) => {
  if (dbMode === 'SUPABASE') {
    const query = getSupabaseClient()
      .from('push_subscriptions')
      .select('*')
      .order('id', { ascending: true })
      .limit(PUSH_SUBSCRIPTION_FETCH_BATCH_SIZE);
    const { data, error } = afterId == null ? await query : await query.gt('id', afterId);
    if (error || !data) return [];
    return data;
  }

  if (dbMode === 'MYSQL') {
    return getMysqlDb().all(
      'SELECT * FROM push_subscriptions WHERE id > ? ORDER BY id ASC LIMIT ?',
      afterId ?? 0,
      PUSH_SUBSCRIPTION_FETCH_BATCH_SIZE
    );
  }

  return getSqliteDb().prepare(
    'SELECT * FROM push_subscriptions WHERE id > ? ORDER BY id ASC LIMIT ?'
  ).all(afterId ?? 0, PUSH_SUBSCRIPTION_FETCH_BATCH_SIZE) as any[];
};

const sendPushBatch = async (subscriptions: any[], payload: string, dbMode: string) => {
  const targets = uniqueByEndpoint(
    filterPushSubscriptionsByOrigin(
      subscriptions,
      getConfiguredPushOrigins(process.env, CORS_ALLOWED_ORIGINS)
    )
  );
  const expiredIds: any[] = [];
  const endpointHostValidationCache: OutboundHostValidationCache = new Map();
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i += PUSH_SEND_BATCH_SIZE) {
    const group = targets.slice(i, i + PUSH_SEND_BATCH_SIZE);
    const results = await Promise.allSettled(group.map((sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          auth: sub.auth_key,
          p256dh: sub.p256dh_key
        }
      };
      return sendValidatedPushNotification(pushSubscription, payload, endpointHostValidationCache);
    }));

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sent++;
        return;
      }
      failed++;
      const err: any = result.reason;
      if (isExpiredPushSubscriptionError(err)) {
        expiredIds.push(group[index].id);
      }
    });

    if (i + PUSH_SEND_BATCH_SIZE < targets.length && PUSH_SEND_BATCH_DELAY_MS > 0) {
      await sleep(PUSH_SEND_BATCH_DELAY_MS);
    }
  }

  await deleteExpiredSubscriptions(dbMode, expiredIds).catch((err) => {
    console.warn('[Push] 만료 구독 일괄 정리 실패:', err?.message || err);
  });

  return { targets: targets.length, sent, failed, expired: expiredIds.length };
};

/**
 * 3. 예약 푸시 알림 등록 API (ADMIN 전용)
 */
export const scheduleNotification = async (req: Request, res: Response) => {
  const { title, body, scheduled_at, coupon_code } = req.body;
  const couponCode = normalizeCouponCode(coupon_code);

  if (!title || !body) {
    return res.status(400).json({ error: 'BadRequest', message: '푸시 알림의 제목(title)과 본문(body)은 필수입니다.' });
  }
  if (coupon_code && !couponCode) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 쿠폰 코드를 입력해주세요.' });
  }

  try {
    if (couponCode && !(await couponRepository.findByCode(couponCode))) {
      return res.status(404).json({ error: 'NotFound', message: '푸시에 연결할 쿠폰을 찾을 수 없습니다.' });
    }

    const dbMode = getDbMode();
    let scheduledTime = null;
    if (scheduled_at) {
      scheduledTime = new Date(scheduled_at).toISOString();
    }

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      const { error } = await client
        .from('push_notifications')
        .insert([{
          title,
          body,
          coupon_code: couponCode || null,
          status: 'pending',
          scheduled_at: scheduledTime
        }]);

      if (error) throw error;
    } else if (dbMode === 'MYSQL') {
      await getMysqlDb().run(`
        INSERT INTO push_notifications (title, body, coupon_code, status, scheduled_at)
        VALUES (?, ?, ?, 'pending', ?)
      `, title, body, couponCode || null, scheduledTime);
    } else {
      const db = getSqliteDb();
      db.prepare(`
        INSERT INTO push_notifications (title, body, coupon_code, status, scheduled_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run(title, body, couponCode || null, scheduledTime);
    }

    return res.status(201).json({
      message: scheduledTime
        ? `${scheduledTime} 에 발송되도록 예약 설정되었습니다.`
        : '푸시 알림이 즉시 발송 대기 상태로 등록되었습니다.'
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '푸시 예약 생성 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 4. PWA 푸시 알림 실제 전송 유틸리티 함수
 */
const sendPushToAll = async (title: string, body: string, url = '/') => {
  try {
    const dbMode = getDbMode();
    const payload = JSON.stringify({ title, body, url });
    const seenEndpoints = new Set<string>();
    const stats = { targets: 0, sent: 0, failed: 0, expired: 0 };
    let afterId: number | null = null;

    while (true) {
      const subscriptions = await loadPushSubscriptionBatch(dbMode, afterId);
      if (subscriptions.length === 0) break;
      const uniqueSubscriptions = subscriptions.filter((sub) => {
        if (!sub?.endpoint || seenEndpoints.has(sub.endpoint)) return false;
        seenEndpoints.add(sub.endpoint);
        return true;
      });
      const batchStats = await sendPushBatch(uniqueSubscriptions, payload, dbMode);
      stats.targets += batchStats.targets;
      stats.sent += batchStats.sent;
      stats.failed += batchStats.failed;
      stats.expired += batchStats.expired;

      const nextAfterId = Number(subscriptions[subscriptions.length - 1]?.id);
      if (!Number.isFinite(nextAfterId) || subscriptions.length < PUSH_SUBSCRIPTION_FETCH_BATCH_SIZE) break;
      afterId = nextAfterId;
    }

    console.log(
      `[Push] 푸시 알림 전송 완료 ` +
      `(대상 ${stats.targets}대 / 성공 ${stats.sent} / 실패 ${stats.failed} / 만료정리 ${stats.expired}, ` +
      `발송배치 ${PUSH_SEND_BATCH_SIZE}, 조회배치 ${PUSH_SUBSCRIPTION_FETCH_BATCH_SIZE}, 지연 ${PUSH_SEND_BATCH_DELAY_MS}ms)`
    );
  } catch (err) {
    console.error('[Push] 푸시 알림 일괄 전송 도중 에러:', err);
  }
};

const deliverPushToUser = async (userId: string, title: string, body: string, url?: string, tag?: string) => {
  try {
    const dbMode = getDbMode();
    let subscriptions: any[] = [];

    if (dbMode === 'SUPABASE') {
      const { data, error } = await getSupabaseClient()
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: false })
        .limit(PUSH_MAX_SUBSCRIPTIONS_PER_USER);
      if (!error && data) subscriptions = data;
    } else if (dbMode === 'MYSQL') {
      subscriptions = await getMysqlDb().all(
        'SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?',
        userId,
        PUSH_MAX_SUBSCRIPTIONS_PER_USER
      );
    } else {
      subscriptions = getSqliteDb().prepare(
        'SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?'
      ).all(userId, PUSH_MAX_SUBSCRIPTIONS_PER_USER);
    }

    if (subscriptions.length === 0) return;
    const payload = JSON.stringify({ title, body, url: url || '/', tag });
    await sendPushBatch(subscriptions, payload, dbMode);
  } catch (err) {
    console.error('[Push] 개별 푸시 전송 중 에러:', err);
  }
};

/**
 * 특정 유저에게만 푸시 알림을 전송합니다 (교환/채팅 알림 등).
 * DB 조회를 포함한 전체 전달 작업이 중앙 bounded scheduler를 통과하므로,
 * 호출부가 fire-and-forget이어도 느린 push endpoint가 무제한 누적되지 않습니다.
 */
export const sendPushToUser = (
  userId: string,
  title: string,
  body: string,
  url?: string,
  tag?: string
): Promise<PushDeliveryScheduleResult> => {
  const dedupeKey = createHash('sha256')
    .update(JSON.stringify([title, body, url || '/', tag || null]))
    .digest('base64url');
  const scheduled = targetedPushDeliveryScheduler.schedule({
    userId,
    dedupeKey,
    task: () => deliverPushToUser(userId, title, body, url, tag)
  });
  void scheduled.then((result) => {
    if (result !== 'dropped') return;
    const now = Date.now();
    if (now - lastPushDeliveryDropWarningAt >= 60_000) {
      lastPushDeliveryDropWarningAt = now;
      const stats = targetedPushDeliveryScheduler.getStats();
      console.warn(
        `[Push] 개별 푸시 전달 큐가 포화되어 선택적 알림을 드롭했습니다. ` +
        `(실행 ${stats.active}/${PUSH_USER_DELIVERY_MAX_CONCURRENT}, ` +
        `대기 ${stats.queued}/${PUSH_USER_DELIVERY_MAX_QUEUED})`
      );
    }
  });
  return scheduled;
};

/**
 * 모든 관리자에게 푸시 알림을 전송합니다. 신고 접수처럼 즉시 확인이 필요한 운영 이벤트에 사용합니다.
 */
export const sendPushToAdmins = async (title: string, body: string, url = '/admin') => {
  try {
    const dbMode = getDbMode();
    let adminIds: string[] = [];

    if (dbMode === 'SUPABASE') {
      const { data, error } = await getSupabaseClient()
        .from('users')
        .select('id')
        .eq('role', 'ADMIN');
      if (!error && data) adminIds = data.map((row: any) => row.id);
    } else if (dbMode === 'MYSQL') {
      const rows = await getMysqlDb().all("SELECT id FROM users WHERE role = 'ADMIN'") as { id: string }[];
      adminIds = rows.map((row) => row.id);
    } else {
      const rows = getSqliteDb().prepare("SELECT id FROM users WHERE role = 'ADMIN'").all() as { id: string }[];
      adminIds = rows.map((row) => row.id);
    }

    await Promise.all(adminIds.map((adminId) => sendPushToUser(adminId, title, body, url)));
  } catch (err) {
    console.error('[Push] 관리자 푸시 전송 중 에러:', err);
  }
};

/**
 * 현재 로그인 유저에게 테스트 푸시를 1건 전송합니다.
 * 푸시 구독이 정상 등록되어 알림이 실제로 도착하는지 본인이 확인하는 용도입니다.
 */
export const sendTestPush = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    const dbMode = getDbMode();
    let subscriptions: any[] = [];
    if (dbMode === 'SUPABASE') {
      const { data } = await getSupabaseClient()
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: false })
        .limit(PUSH_MAX_SUBSCRIPTIONS_PER_USER);
      subscriptions = data || [];
    } else if (dbMode === 'MYSQL') {
      subscriptions = await getMysqlDb().all(
        'SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?',
        userId,
        PUSH_MAX_SUBSCRIPTIONS_PER_USER
      );
    } else {
      subscriptions = getSqliteDb().prepare(
        'SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT ?'
      ).all(userId, PUSH_MAX_SUBSCRIPTIONS_PER_USER);
    }
    const count = filterPushSubscriptionsByOrigin(
      subscriptions,
      getConfiguredPushOrigins(process.env, CORS_ALLOWED_ORIGINS)
    ).length;

    if (count === 0) {
      return res.status(400).json({
        error: 'NoSubscription',
        message: '등록된 푸시 구독이 없습니다. 먼저 "알림 받기 및 앱 설치"를 눌러 구독해 주세요.'
      });
    }

    const delivery = await sendPushToUser(
      userId,
      '🔔 푸시 테스트 알림',
      '푸시 알림이 정상적으로 등록되어 있어요! 이 알림이 보이면 성공입니다.',
      '/my-info'
    );
    if (delivery === 'dropped') {
      res.setHeader('Retry-After', '1');
      return res.status(503).json({
        error: 'PushDeliveryBusy',
        message: '푸시 전달이 혼잡합니다. 잠시 후 다시 시도해 주세요.'
      });
    }
    return res.status(200).json({
      ok: true,
      message: `테스트 푸시를 전송했습니다. (구독 ${count}건) 잠시 후 알림을 확인해 주세요.`
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '테스트 푸시 전송 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

let isPushSchedulerRunning = false;

/**
 * node-cron 푸시 스케줄러 등록
 * 1분마다 주기적으로 감시하여 전송할 시간이 경과한 'pending' 푸시를 자동 일괄 발송합니다.
 */
export const startPushNotificationScheduler = () => {
  // 1분 주기 감시
  cron.schedule('* * * * *', async () => {
    if (isPushSchedulerRunning) {
      console.warn('[Scheduler] 이전 푸시 발송 작업이 아직 진행 중이라 이번 틱을 건너뜁니다.');
      return;
    }
    isPushSchedulerRunning = true;
    try {
      const dbMode = getDbMode();
      const nowIso = new Date().toISOString();
      let pendingNotifs: any[] = [];

      if (dbMode === 'SUPABASE') {
        const client = getSupabaseClient();
        const { data: dueRows, error: dueError } = await client
          .from('push_notifications')
          .select('id')
          .eq('status', 'pending')
          .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
          .order('scheduled_at', { ascending: true, nullsFirst: true })
          .order('id', { ascending: true })
          .limit(PUSH_SCHEDULED_MAX_PER_TICK);

        if (dueError) {
          console.warn('[Scheduler] 예약 푸시 조회 실패:', dueError.message);
        }

        const ids = (dueRows || []).map((row: any) => row.id);
        if (ids.length > 0) {
          const { data, error } = await client
          .from('push_notifications')
          .update({ status: 'sending' })
          .in('id', ids)
          .eq('status', 'pending')
          .select('*');

          if (!error && data) {
            pendingNotifs = data;
          }
        }
      } else if (dbMode === 'MYSQL') {
        pendingNotifs = await getMysqlDb().transaction(async (tx) => {
          const rows = await tx.all(`
            SELECT * FROM push_notifications
            WHERE status = 'pending'
              AND (scheduled_at IS NULL OR scheduled_at <= ?)
            ORDER BY scheduled_at IS NULL DESC, scheduled_at ASC, id ASC
            LIMIT ?
            FOR UPDATE
          `, nowIso, PUSH_SCHEDULED_MAX_PER_TICK) as any[];
          if (rows.length === 0) return rows;
          const placeholders = rows.map(() => '?').join(',');
          await tx.run(`UPDATE push_notifications SET status = 'sending' WHERE id IN (${placeholders}) AND status = 'pending'`, rows.map((r) => r.id));
          return rows;
        });
      } else {
        const db = getSqliteDb();
        pendingNotifs = db.transaction(() => {
          const rows = db.prepare(`
            SELECT * FROM push_notifications
            WHERE status = 'pending'
              AND (scheduled_at IS NULL OR datetime(scheduled_at) <= datetime(?))
            ORDER BY scheduled_at IS NULL DESC, scheduled_at ASC, id ASC
            LIMIT ?
          `).all(nowIso, PUSH_SCHEDULED_MAX_PER_TICK) as any[];
          if (rows.length === 0) return rows;

          const placeholders = rows.map(() => '?').join(',');
          db.prepare(`UPDATE push_notifications SET status = 'sending' WHERE id IN (${placeholders}) AND status = 'pending'`)
            .run(...rows.map((r) => r.id));
          return rows;
        })();
      }

      if (pendingNotifs.length === 0) return;

      console.log(`[Scheduler] ${pendingNotifs.length}건의 발송 대기 중인 푸시 알림을 감지했습니다.`);

      for (const notif of pendingNotifs) {
        // 즉시 전송 실행
        await sendPushToAll(notif.title, notif.body, buildCouponPushUrl(notif.coupon_code));

        // 상태를 'sent'로 업데이트하고 실제 발송 시각(sent_at)을 기록
        const sentAtIso = new Date().toISOString();
        if (dbMode === 'SUPABASE') {
          await getSupabaseClient()
            .from('push_notifications')
            .update({ status: 'sent', sent_at: sentAtIso })
            .eq('id', notif.id);
        } else if (dbMode === 'MYSQL') {
          await getMysqlDb().run("UPDATE push_notifications SET status = 'sent', sent_at = ? WHERE id = ?", sentAtIso, notif.id);
        } else {
          getSqliteDb().prepare('UPDATE push_notifications SET status = \'sent\', sent_at = ? WHERE id = ?').run(sentAtIso, notif.id);
        }
      }
    } catch (err) {
      console.error('[Scheduler] 예약 푸시 알림 스케줄러 구동 중 오류:', err);
    } finally {
      isPushSchedulerRunning = false;
    }
  });

  console.log('[Scheduler] PWA 예약 푸시 스케줄러 감시 워커가 가동되었습니다. (1분 간격)');
};

/**
 * 5. 예약된 푸시 알림 목록 조회 API (ADMIN 전용)
 */
export const getScheduledNotifications = async (req: Request, res: Response) => {
  try {
    const dbMode = getDbMode();
    let list: any[] = [];
    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from('push_notifications')
        .select('*')
        .eq('status', 'pending')
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      list = data || [];
    } else if (dbMode === 'MYSQL') {
      list = await getMysqlDb().all(`
        SELECT * FROM push_notifications
        WHERE status = 'pending'
        ORDER BY scheduled_at ASC
      `);
    } else {
      const db = getSqliteDb();
      list = db.prepare(`
        SELECT * FROM push_notifications 
        WHERE status = 'pending' 
        ORDER BY scheduled_at ASC
      `).all();
    }
    return res.status(200).json(list);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '예약 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 6. 전송 완료된 푸시 알림 목록 조회 API (ADMIN 전용)
 */
export const getSentNotifications = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const rawLimit = parseInt(String(req.query.limit || '10'), 10) || 10;
    const limit = Math.min(100, Math.max(1, rawLimit));
    const offset = (page - 1) * limit;

    const dbMode = getDbMode();
    let list: any[] = [];
    let total = 0;

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      
      // 전체 개수 조회
      const { count, error: countErr } = await client
        .from('push_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sent');
        
      if (countErr) throw countErr;
      total = count || 0;

      // 페이징 데이터 조회 (실제 발송 시각 기준 정렬, 과거 데이터는 created_at로 폴백)
      const { data, error } = await client
        .from('push_notifications')
        .select('*')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;
      list = data || [];
    } else if (dbMode === 'MYSQL') {
      const countRes = await getMysqlDb().get(`
        SELECT COUNT(*) as cnt FROM push_notifications
        WHERE status = 'sent'
      `) as any;
      total = countRes ? countRes.cnt : 0;
      list = await getMysqlDb().all(`
        SELECT * FROM push_notifications
        WHERE status = 'sent'
        ORDER BY COALESCE(sent_at, created_at) DESC
        LIMIT ? OFFSET ?
      `, limit, offset);
    } else {
      const db = getSqliteDb();
      
      // 전체 개수 조회
      const countRes = db.prepare(`
        SELECT COUNT(*) as cnt FROM push_notifications 
        WHERE status = 'sent'
      `).get() as any;
      total = countRes ? countRes.cnt : 0;

      // 페이징 데이터 조회 (실제 발송 시각 기준 정렬, 과거 데이터는 created_at로 폴백)
      list = db.prepare(`
        SELECT * FROM push_notifications
        WHERE status = 'sent'
        ORDER BY COALESCE(sent_at, created_at) DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);
    }

    return res.status(200).json({
      notifications: list,
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '전송 이력 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 7. 예약 푸시 알림 수정 API (ADMIN 전용)
 */
export const updateScheduledNotification = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, body, scheduled_at, coupon_code } = req.body;
  const couponCode = normalizeCouponCode(coupon_code);

  if (!title || !body) {
    return res.status(400).json({ error: 'BadRequest', message: '제목(title)과 본문(body)은 필수입니다.' });
  }
  if (coupon_code && !couponCode) {
    return res.status(400).json({ error: 'BadRequest', message: '올바른 쿠폰 코드를 입력해주세요.' });
  }

  try {
    if (couponCode && !(await couponRepository.findByCode(couponCode))) {
      return res.status(404).json({ error: 'NotFound', message: '푸시에 연결할 쿠폰을 찾을 수 없습니다.' });
    }

    const dbMode = getDbMode();
    let scheduledTime = null;
    if (scheduled_at) {
      scheduledTime = new Date(scheduled_at).toISOString();
    }

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      // 기존 상태 체크
      const { data: existing, error: findErr } = await client
        .from('push_notifications')
        .select('status')
        .eq('id', id)
        .single();
      
      if (findErr || !existing) {
        return res.status(404).json({ error: 'NotFound', message: '수정할 푸시 알림을 찾을 수 없습니다.' });
      }

      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송된 푸시 알림은 수정할 수 없습니다.' });
      }

      const { error } = await client
        .from('push_notifications')
        .update({ title, body, coupon_code: couponCode || null, scheduled_at: scheduledTime })
        .eq('id', id);

      if (error) throw error;
    } else if (dbMode === 'MYSQL') {
      const existing = await getMysqlDb().get('SELECT status FROM push_notifications WHERE id = ?', id) as any;
      if (!existing) {
        return res.status(404).json({ error: 'NotFound', message: '수정할 푸시 알림을 찾을 수 없습니다.' });
      }
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송된 푸시 알림은 수정할 수 없습니다.' });
      }
      await getMysqlDb().run(`
        UPDATE push_notifications
        SET title = ?, body = ?, coupon_code = ?, scheduled_at = ?
        WHERE id = ?
      `, title, body, couponCode || null, scheduledTime, id);
    } else {
      const db = getSqliteDb();
      const existing = db.prepare('SELECT status FROM push_notifications WHERE id = ?').get(id) as any;
      if (!existing) {
        return res.status(404).json({ error: 'NotFound', message: '수정할 푸시 알림을 찾을 수 없습니다.' });
      }
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송된 푸시 알림은 수정할 수 없습니다.' });
      }

      db.prepare(`
        UPDATE push_notifications 
        SET title = ?, body = ?, coupon_code = ?, scheduled_at = ?
        WHERE id = ?
      `).run(title, body, couponCode || null, scheduledTime, id);
    }

    return res.status(200).json({ message: '예약된 푸시 알림이 성공적으로 수정되었습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '푸시 수정 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 8. 예약 푸시 알림 취소(삭제) API (ADMIN 전용)
 */
export const deleteScheduledNotification = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const dbMode = getDbMode();

    if (dbMode === 'SUPABASE') {
      const client = getSupabaseClient();
      const { data: existing, error: findErr } = await client
        .from('push_notifications')
        .select('status')
        .eq('id', id)
        .single();
      
      if (findErr || !existing) {
        return res.status(404).json({ error: 'NotFound', message: '취소할 푸시 알림을 찾을 수 없습니다.' });
      }

      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송 완료된 푸시 알림은 취소할 수 없습니다.' });
      }

      const { error } = await client
        .from('push_notifications')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } else if (dbMode === 'MYSQL') {
      const existing = await getMysqlDb().get('SELECT status FROM push_notifications WHERE id = ?', id) as any;
      if (!existing) {
        return res.status(404).json({ error: 'NotFound', message: '취소할 푸시 알림을 찾을 수 없습니다.' });
      }
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송 완료된 푸시 알림은 취소할 수 없습니다.' });
      }
      await getMysqlDb().run('DELETE FROM push_notifications WHERE id = ?', id);
    } else {
      const db = getSqliteDb();
      const existing = db.prepare('SELECT status FROM push_notifications WHERE id = ?').get(id) as any;
      if (!existing) {
        return res.status(404).json({ error: 'NotFound', message: '취소할 푸시 알림을 찾을 수 없습니다.' });
      }
      if (existing.status !== 'pending') {
        return res.status(400).json({ error: 'BadRequest', message: '이미 전송 완료된 푸시 알림은 취소할 수 없습니다.' });
      }

      db.prepare('DELETE FROM push_notifications WHERE id = ?').run(id);
    }

    return res.status(200).json({ message: '예약된 푸시 알림이 성공적으로 취소(삭제)되었습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '푸시 취소 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
