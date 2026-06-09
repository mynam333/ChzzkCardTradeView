/**
 * push.ts - PWA 서비스 워커 등록 및 웹 푸시 구독 유틸리티
 */
import { apiFetch } from './api';

/** PWA/푸시 지원 환경 여부 */
export const isPushSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** 서비스 워커 등록 (앱 로드시 1회 호출) */
export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (e) {
    console.warn('[Push] 서비스 워커 등록 실패:', e);
    return null;
  }
};

// VAPID 공개키(base64url)를 Web Push API가 요구하는 Uint8Array로 변환
const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no_vapid' | 'error'; message: string };

let subscribeInFlight: Promise<SubscribeResult> | null = null;
let lastRegisteredEndpoint = '';
let lastRegisteredAt = 0;
const PUSH_REGISTER_DEDUPE_MS = 10 * 60 * 1000;

const waitForServiceWorkerReady = async (): Promise<ServiceWorkerRegistration | null> => {
  const registration = await registerServiceWorker();
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration | null>((resolve) => {
        window.setTimeout(() => resolve(registration), 8000);
      })
    ]);
  } catch {
    return registration;
  }
};

/**
 * 알림 권한을 요청하고 푸시 구독을 생성하여 백엔드에 등록합니다.
 * 로그인(JWT) 상태에서 호출해야 합니다(/push/subscribe는 인증 필요).
 */
export const subscribeToPush = async (): Promise<SubscribeResult> => {
  if (subscribeInFlight) return subscribeInFlight;

  subscribeInFlight = subscribeToPushInternal().finally(() => {
    subscribeInFlight = null;
  });
  return subscribeInFlight;
};

const subscribeToPushInternal = async (): Promise<SubscribeResult> => {
  if (!isPushSupported()) {
    return { ok: false, reason: 'unsupported', message: '이 브라우저는 웹 푸시 알림을 지원하지 않습니다.' };
  }

  try {
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: 'denied', message: '알림 권한이 허용되지 않았습니다.' };
    }

    const registration = await waitForServiceWorkerReady();
    if (!registration) {
      return { ok: false, reason: 'error', message: '서비스 워커를 사용할 수 없습니다.' };
    }

    // 서버에서 VAPID 공개키 수급
    const keyRes = await apiFetch('/push/vapid-key');
    const keyData = await keyRes.json();
    if (!keyData.publicKey) {
      return { ok: false, reason: 'no_vapid', message: '서버에 푸시 공개키(VAPID)가 설정되어 있지 않습니다.' };
    }

    // 기존 구독이 있으면 재사용, 없으면 신규 구독
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey) as BufferSource
      });
    }

    const endpoint = subscription.endpoint || '';
    if (
      endpoint &&
      endpoint === lastRegisteredEndpoint &&
      Date.now() - lastRegisteredAt < PUSH_REGISTER_DEDUPE_MS
    ) {
      return { ok: true };
    }

    // 백엔드에 구독 정보 등록
    const res = await apiFetch('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription, origin: window.location.origin })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, reason: 'error', message: data.message || '구독 등록에 실패했습니다.' };
    }

    lastRegisteredEndpoint = endpoint;
    lastRegisteredAt = Date.now();
    return { ok: true };
  } catch (e: any) {
    console.error('[Push] 구독 처리 중 오류:', e);
    return { ok: false, reason: 'error', message: e?.message || '알 수 없는 오류가 발생했습니다.' };
  }
};
