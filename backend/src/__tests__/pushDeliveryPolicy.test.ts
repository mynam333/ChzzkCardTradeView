import { promises as dns } from 'node:dns';
import type { LookupFunction } from 'node:net';
import webpush from 'web-push';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildWebPushRequestOptions,
  createPushDeliveryScheduler,
  isExpiredPushSubscriptionError,
  isKnownWebPushHostname,
  normalizePushDeliverySchedulerConfig,
  normalizePushSendTimeoutMs,
  normalizePushSubscriptionKeys,
  PUSH_ENDPOINT_MAX_LENGTH,
  PUSH_MAX_SUBSCRIPTIONS_PER_USER,
  sendValidatedPushNotification,
  validatePushEndpoint
} from '../controllers/pushController';

beforeEach(() => {
  vi.spyOn(dns, 'lookup').mockResolvedValue([
    { address: '142.250.206.202', family: 4 },
    { address: '2607:f8b0:400a:801::200a', family: 6 }
  ] as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('web push delivery policy', () => {
  it('hard-bounds slow targeted deliveries globally, per user, and in the queue', async () => {
    const scheduler = createPushDeliveryScheduler({
      maxConcurrent: 2,
      maxQueued: 3,
      maxPendingPerUser: 2
    });
    const started: string[] = [];
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
      });
      return { promise, resolve };
    };
    const gates = Object.fromEntries(
      ['a1', 'a2', 'b1', 'c1', 'd1'].map((key) => [key, deferred()])
    ) as Record<string, ReturnType<typeof deferred>>;
    const schedule = (userId: string, key: string) => scheduler.schedule({
      userId,
      dedupeKey: key,
      task: async () => {
        started.push(key);
        await gates[key].promise;
      }
    });

    const a1 = schedule('user-a', 'a1');
    const duplicateA1 = schedule('user-a', 'a1');
    expect(duplicateA1).toBe(a1);
    const a2 = schedule('user-a', 'a2');
    await expect(scheduler.schedule({
      userId: 'user-a',
      dedupeKey: 'a3',
      task: vi.fn()
    })).resolves.toBe('dropped');

    const b1 = schedule('user-b', 'b1');
    const c1 = schedule('user-c', 'c1');
    const d1 = schedule('user-d', 'd1');
    await expect(scheduler.schedule({
      userId: 'user-e',
      dedupeKey: 'e1',
      task: vi.fn()
    })).resolves.toBe('dropped');

    expect(started).toEqual(['a1', 'b1']);
    expect(started).not.toContain('a2');
    expect(scheduler.getStats()).toEqual({
      active: 2,
      queued: 3,
      pendingUsers: 4,
      pendingTotal: 5,
      dropped: 2
    });

    Object.values(gates).forEach((gate) => gate.resolve());
    await Promise.all([a1, a2, b1, c1, d1]);
    expect(scheduler.getStats()).toEqual({
      active: 0,
      queued: 0,
      pendingUsers: 0,
      pendingTotal: 0,
      dropped: 2
    });
  });

  it('normalizes targeted delivery limits against safe hard caps', () => {
    expect(normalizePushDeliverySchedulerConfig({})).toEqual({
      maxConcurrent: 4,
      maxQueued: 64,
      maxPendingPerUser: 2
    });
    expect(normalizePushDeliverySchedulerConfig({
      maxConcurrent: 10_000,
      maxQueued: 10_000,
      maxPendingPerUser: 10_000
    })).toEqual({
      maxConcurrent: 16,
      maxQueued: 256,
      maxPendingPerUser: 4
    });
  });

  it('always supplies a bounded library-supported socket timeout', () => {
    expect(buildWebPushRequestOptions(10_000)).toMatchObject({
      TTL: 3600,
      urgency: 'normal',
      timeout: 10_000
    });
    expect(buildWebPushRequestOptions().timeout).toBeGreaterThanOrEqual(1_000);
    expect(buildWebPushRequestOptions().timeout).toBeLessThanOrEqual(60_000);
    expect(normalizePushSendTimeoutMs(500)).toBe(1_000);
    expect(normalizePushSendTimeoutMs(120_000)).toBe(60_000);
    expect(normalizePushSendTimeoutMs('invalid')).toBe(10_000);
  });

  it('preserves cleanup classification for gone push subscriptions', () => {
    expect(isExpiredPushSubscriptionError({ statusCode: 404 })).toBe(true);
    expect(isExpiredPushSubscriptionError({ statusCode: 410 })).toBe(true);
    expect(isExpiredPushSubscriptionError(new Error('Socket timeout'))).toBe(false);
  });

  it('allows established browser push services with public DNS answers', async () => {
    expect(isKnownWebPushHostname('fcm.googleapis.com')).toBe(true);
    expect(isKnownWebPushHostname('updates.push.services.mozilla.com')).toBe(true);
    expect(isKnownWebPushHostname('web.push.apple.com')).toBe(true);
    expect(isKnownWebPushHostname('wns2-by3p.notify.windows.com')).toBe(true);

    const validated = await validatePushEndpoint(
      'https://fcm.googleapis.com/fcm/send/public-subscription-token'
    );
    expect(validated.url.hostname).toBe('fcm.googleapis.com');
    expect(validated.addresses).toHaveLength(2);
  });

  it('rejects non-HTTPS, localhost, IP-literal and unknown push endpoints', async () => {
    await expect(validatePushEndpoint(
      'http://fcm.googleapis.com/fcm/send/token'
    )).rejects.toMatchObject({ code: 'UNSAFE_PROTOCOL' });
    await expect(validatePushEndpoint(
      'https://localhost/push/token'
    )).rejects.toMatchObject({ code: 'UNSAFE_HOST' });
    await expect(validatePushEndpoint(
      'https://127.0.0.1/push/token'
    )).rejects.toMatchObject({ code: 'IP_LITERAL' });
    await expect(validatePushEndpoint(
      'https://attacker.example/push/token'
    )).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
    await expect(validatePushEndpoint(
      `https://fcm.googleapis.com/fcm/send/${'a'.repeat(PUSH_ENDPOINT_MAX_LENGTH)}`
    )).rejects.toMatchObject({ code: 'URL_LENGTH' });
  });

  it('accepts only canonical Web Push key material and keeps a small per-user cap', () => {
    const auth = Buffer.alloc(16, 0x11).toString('base64url');
    const p256dh = Buffer.from(
      '04' +
      '6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296' +
      '4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
      'hex'
    ).toString('base64url');

    expect(normalizePushSubscriptionKeys(auth, p256dh)).toEqual({ authKey: auth, p256dhKey: p256dh });
    expect(normalizePushSubscriptionKeys(Buffer.alloc(15).toString('base64url'), p256dh)).toBeNull();
    expect(normalizePushSubscriptionKeys(auth, Buffer.alloc(65, 0x03).toString('base64url'))).toBeNull();
    expect(normalizePushSubscriptionKeys('not base64url!', p256dh)).toBeNull();
    expect(PUSH_MAX_SUBSCRIPTIONS_PER_USER).toBeGreaterThan(0);
    expect(PUSH_MAX_SUBSCRIPTIONS_PER_USER).toBeLessThanOrEqual(10);
  });

  it('rejects a known push hostname when DNS resolves to private or metadata space', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce([
      { address: '169.254.169.254', family: 4 }
    ] as any);

    await expect(validatePushEndpoint(
      'https://fcm.googleapis.com/fcm/send/private-answer'
    )).rejects.toMatchObject({ code: 'UNSAFE_ADDRESS' });
  });

  it('pins the validated public addresses into the web-push HTTPS agent', async () => {
    const sendSpy = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({
      statusCode: 201,
      headers: {},
      body: ''
    });

    await sendValidatedPushNotification({
      endpoint: 'https://fcm.googleapis.com/fcm/send/pinned-token',
      keys: { auth: 'auth', p256dh: 'p256dh' }
    }, '{"title":"test"}');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const options = sendSpy.mock.calls[0]?.[2];
    expect(options?.timeout).toBeGreaterThanOrEqual(1_000);
    expect(options?.agent).toBeDefined();

    const lookup = options?.agent?.options.lookup as LookupFunction;
    const selected = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookup('fcm.googleapis.com', { family: 4, all: false }, (error, address, family) => {
        if (error) return reject(error);
        resolve({ address: String(address), family: Number(family) });
      });
    });
    expect(selected).toEqual({ address: '142.250.206.202', family: 4 });
  });

  it('never calls web-push when send-time DNS validation becomes unsafe', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce([
      { address: '10.0.0.10', family: 4 }
    ] as any);
    const sendSpy = vi.spyOn(webpush, 'sendNotification');

    await expect(sendValidatedPushNotification({
      endpoint: 'https://fcm.googleapis.com/fcm/send/rebound-token',
      keys: { auth: 'auth', p256dh: 'p256dh' }
    }, '{}')).rejects.toMatchObject({ code: 'UNSAFE_ADDRESS' });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
