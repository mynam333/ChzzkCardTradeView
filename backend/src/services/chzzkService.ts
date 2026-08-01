import dotenv from 'dotenv';
import { decryptToken, encryptToken } from './cryptoService';
import { userRepository } from '../repositories';

dotenv.config();

export interface ChzzkProfile {
  name: string;
  logoUrl: string;
  followerCount: number;
  openLive: boolean;
  lastLiveAt?: string | null;
  chatChannelId?: string | null;
  concurrentUserCount?: number;
}

export interface ChzzkLiveStatus {
  openLive: boolean;
  lastLiveAt: string | null;
  chatChannelId: string | null;
  concurrentUserCount: number;
}

export interface ChzzkTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // 초 단위 만료 시간
}

type ChzzkTokenRefreshResult =
  | { ok: true; token: ChzzkTokenResult }
  | { ok: false; status?: number };

export const isDiceBearImageUrl = (url: string | null | undefined): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'api.dicebear.com' || parsed.hostname.endsWith('.dicebear.com');
  } catch {
    return String(url).includes('dicebear.com');
  }
};

export const isPlaceholderProfileImageUrl = (url: string | null | undefined): boolean => {
  const raw = String(url || '').trim();
  if (!raw) return true;
  if (isDiceBearImageUrl(raw)) return true;

  try {
    const parsed = new URL(raw, 'https://chzzk.naver.com');
    const pathname = decodeURIComponent(parsed.pathname || '').toLowerCase();
    if (!parsed.protocol.startsWith('http') && !raw.startsWith('/')) return true;
    return pathname === '/icon.png' || pathname.endsWith('/icon.png');
  } catch {
    const normalized = raw.split('?')[0].split('#')[0].trim().toLowerCase();
    return normalized === '/icon.png' || normalized.endsWith('/icon.png');
  }
};

const normalizeChannelImageUrl = (url: string | null | undefined): string => {
  const raw = String(url || '').trim();
  return isPlaceholderProfileImageUrl(raw) ? '' : raw;
};

const CHZZK_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const readPositiveNumber = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CHZZK_FETCH_TIMEOUT_MS = Math.max(
  1_000,
  readPositiveNumber('CHZZK_FETCH_TIMEOUT_MS', 10_000)
);

type ChzzkJsonResponse = {
  response: Awaited<ReturnType<typeof fetch>>;
  body: any;
};

const createChzzkTimeoutError = (requestName: string) => {
  const error = new Error(
    `치지직 API 요청 시간이 초과되었습니다 (${requestName}, ${CHZZK_FETCH_TIMEOUT_MS}ms)`
  ) as Error & { code?: string };
  error.name = 'ChzzkApiTimeoutError';
  error.code = 'CHZZK_API_TIMEOUT';
  return error;
};

const getAbortReason = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason;
  return new DOMException('This operation was aborted', 'AbortError');
};

/**
 * 응답 헤더뿐 아니라 response.json()까지 같은 제한 시간 안에 완료되도록 합니다.
 * parentSignal은 프로필/방송 상태 병렬 호출 중 한쪽이 실패했을 때 남은 요청도 즉시 정리합니다.
 */
const fetchChzzkJson = async (
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  requestName: string,
  parentSignal?: AbortSignal
): Promise<ChzzkJsonResponse> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeParentAbortListener: (() => void) | undefined;

  const requestPromise = (async () => {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal
    });
    // 기존 동작처럼 HTTP 오류 본문은 파싱하지 않고 상태 코드만 상위에서 처리합니다.
    const body = response.ok ? await response.json() : undefined;
    return { response, body };
  })();

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = createChzzkTimeoutError(requestName);
      reject(error);
      controller.abort(error);
    }, CHZZK_FETCH_TIMEOUT_MS);
  });

  const parentAbortPromise = parentSignal
    ? new Promise<never>((_, reject) => {
        const onAbort = () => {
          const reason = getAbortReason(parentSignal);
          reject(reason);
          controller.abort(reason);
        };
        if (parentSignal.aborted) {
          onAbort();
          return;
        }
        parentSignal.addEventListener('abort', onAbort, { once: true });
        removeParentAbortListener = () => parentSignal.removeEventListener('abort', onAbort);
      })
    : null;

  try {
    return await Promise.race(
      parentAbortPromise
        ? [requestPromise, timeoutPromise, parentAbortPromise]
        : [requestPromise, timeoutPromise]
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    removeParentAbortListener?.();
  }
};

const findDateCandidate = (value: any, depth = 0): string | null => {
  if (!value || depth > 3 || typeof value !== 'object') return null;
  const keys = [
    'lastLiveAt',
    'lastLiveDate',
    'lastBroadcastAt',
    'lastBroadcastDate',
    'latestLiveAt',
    'latestLiveDate',
    'closeDate',
    'openDate'
  ];
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === 'string' && !Number.isNaN(new Date(raw).getTime())) {
      return new Date(raw).toISOString();
    }
  }
  for (const child of Object.values(value)) {
    const found = findDateCandidate(child, depth + 1);
    if (found) return found;
  }
  return null;
};

const createOfflineLiveStatus = (): ChzzkLiveStatus => ({
  openLive: false,
  lastLiveAt: null,
  chatChannelId: null,
  concurrentUserCount: 0
});

const fetchChzzkLiveStatusRequest = async (
  channelId: string,
  parentSignal?: AbortSignal
): Promise<ChzzkLiveStatus> => {
  const liveStatusUrl = `https://api.chzzk.naver.com/polling/v2/channels/${channelId}/live-status`;
  const { response, body } = await fetchChzzkJson(
    liveStatusUrl,
    { headers: CHZZK_BROWSER_HEADERS },
    `방송 상태 조회: ${channelId}`,
    parentSignal
  );
  if (!response.ok) {
    const error = new Error(`치지직 방송 상태 API 응답 실패 (HTTP 상태 코드: ${response.status})`) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }

  if (body.code !== 200 || !body.content) {
    throw new Error(body.message || '치지직 방송 상태 응답 형식이 올바르지 않습니다.');
  }

  const openLive = body.content.status === 'OPEN';
  return {
    openLive,
    chatChannelId: body.content.chatChannelId || null,
    concurrentUserCount: Number(body.content.concurrentUserCount || 0),
    lastLiveAt: openLive ? new Date().toISOString() : findDateCandidate(body.content)
  };
};

const recoverLiveStatusError = (
  channelId: string,
  error: unknown,
  throwOnError: boolean
): ChzzkLiveStatus => {
  if (throwOnError) {
    throw error instanceof Error ? error : new Error(String(error));
  }
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[ChzzkService] 방송 상태 조회 실패 (대상: ${channelId}):`, message);
  return createOfflineLiveStatus();
};

/** 프로필/팔로워 조회 없이 치지직의 방송 상태 엔드포인트만 호출합니다. */
export const fetchChzzkLiveStatus = async (
  channelId: string,
  throwOnError = false
): Promise<ChzzkLiveStatus> => {
  try {
    return await fetchChzzkLiveStatusRequest(channelId);
  } catch (error: unknown) {
    return recoverLiveStatusError(channelId, error, throwOnError);
  }
};

/**
 * refresh_token으로 치지직 OAuth access_token을 갱신합니다.
 * 성공 시 새 토큰 세트를, 실패 시 null을 반환합니다.
 */
const refreshChzzkTokenDetailed = async (refreshToken: string): Promise<ChzzkTokenRefreshResult> => {
  const clientId = process.env.CHZZK_CLIENT_ID || '';
  const clientSecret = process.env.CHZZK_CLIENT_SECRET || '';
  if (!refreshToken || !clientId || !clientSecret) return { ok: false };

  try {
    const res = await fetch('https://openapi.chzzk.naver.com/auth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: JSON.stringify({
        grantType: 'refresh_token',
        refreshToken,
        clientId,
        clientSecret
      })
    });
    if (!res.ok) {
      console.warn(`[ChzzkService] 토큰 갱신 실패 (HTTP ${res.status})`);
      return { ok: false, status: res.status };
    }
    const body = (await res.json()) as any;
    const content = body.content || body;
    const accessToken = content.accessToken || content.access_token;
    const newRefresh = content.refreshToken || content.refresh_token || refreshToken;
    const expiresIn = Number(content.expiresIn || content.expires_in || 0);
    if (!accessToken) return { ok: false };
    return { ok: true, token: { accessToken, refreshToken: newRefresh, expiresIn } };
  } catch (e: any) {
    console.warn('[ChzzkService] 토큰 갱신 중 예외:', e.message);
    return { ok: false };
  }
};

export const refreshChzzkToken = async (refreshToken: string): Promise<ChzzkTokenResult | null> => {
  const result = await refreshChzzkTokenDetailed(refreshToken);
  return result.ok ? result.token : null;
};

export const fetchChzzkChannelProfile = async (
  channelId: string,
  throwOnError = false,
  prefetchedLiveStatus?: ChzzkLiveStatus,
  throwOnLiveStatusError = false
): Promise<ChzzkProfile> => {
  const profileUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}`;
  const requestScopeController = new AbortController();

  try {
    const [profileResult, liveStatus] = await Promise.all([
      fetchChzzkJson(
        profileUrl,
        { headers: CHZZK_BROWSER_HEADERS },
        `채널 프로필 조회: ${channelId}`,
        requestScopeController.signal
      ),
      prefetchedLiveStatus
        ? Promise.resolve(prefetchedLiveStatus)
        : fetchChzzkLiveStatusRequest(channelId, requestScopeController.signal).catch((error) =>
            recoverLiveStatusError(channelId, error, throwOnLiveStatusError)
          )
    ]);

    const { response: profileRes, body: profileBody } = profileResult;

    if (!profileRes.ok) {
      const error = new Error(`치지직 API 응답 실패 (HTTP 상태 코드: ${profileRes.status})`) as Error & { statusCode?: number };
      error.statusCode = profileRes.status;
      throw error;
    }

    if (profileBody.code === 200 && profileBody.content) {
      const { channelName, channelImageUrl, followerCount } = profileBody.content;
      return {
        name: channelName || '알 수 없는 스트리머',
        logoUrl: normalizeChannelImageUrl(channelImageUrl),
        followerCount: followerCount || 0,
        openLive: liveStatus.openLive,
        lastLiveAt: liveStatus.lastLiveAt || findDateCandidate(profileBody.content),
        chatChannelId: liveStatus.chatChannelId,
        concurrentUserCount: liveStatus.concurrentUserCount
      };
    } else {
      throw new Error(profileBody.message || 'API 응답 형식이 올바르지 않습니다.');
    }
  } catch (error: any) {
    // Promise.all의 반대편 요청이 아직 대기 중이면 즉시 abort하여 타이머와 리스너를 정리합니다.
    requestScopeController.abort(error instanceof Error ? error : undefined);
    console.warn(`[ChzzkService] 치지직 API 조회 실패 (대상: ${channelId}):`, error.message);
    // 신규 카드 등록처럼 정확한 검증이 필요한 경우에는 폴백 더미 데이터 대신 에러를 전파합니다.
    if (throwOnError) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    return {
      name: `스트리머_${channelId.substring(0, 5)}`,
      logoUrl: `https://api.dicebear.com/7.x/adventurer/png?seed=${channelId}`,
      followerCount: 150,
      openLive: false,
      lastLiveAt: null
    };
  }
};

/**
 * 유저의 유효한 치지직 access_token을 반환합니다.
 * 만료 임박(5분 이내) 시 refresh_token으로 갱신 후 DB에 저장합니다.
 */
export const getValidUserAccessToken = async (userId: string): Promise<string | undefined> => {
  try {
    const user = await userRepository.findById(userId);
    if (!user || !user.access_token) return undefined;

    const accessToken = decryptToken(user.access_token) || undefined;
    const expiresAt = user.token_expires_at ? new Date(user.token_expires_at).getTime() : 0;
    const needsRefresh = expiresAt > 0 && Date.now() >= expiresAt - 5 * 60 * 1000;

    if (needsRefresh && user.refresh_token) {
      const refresh = decryptToken(user.refresh_token);
      if (refresh) {
        const refreshResult = await refreshChzzkTokenDetailed(refresh);
        if (refreshResult.ok) {
          const newExpiry = refreshResult.token.expiresIn
            ? new Date(Date.now() + refreshResult.token.expiresIn * 1000).toISOString()
            : null;
          await userRepository.updateTokens(
            userId,
            encryptToken(refreshResult.token.accessToken),
            encryptToken(refreshResult.token.refreshToken),
            newExpiry
          );
          console.log(`[ChzzkService] 치지직 토큰 갱신 완료 (유저: ${userId})`);
          return refreshResult.token.accessToken;
        }
        if (refreshResult.status === 401) {
          await userRepository.updateTokens(userId, null, null, null);
          console.warn(`[ChzzkService] 만료되었거나 폐기된 치지직 refresh_token을 정리했습니다 (유저: ${userId}).`);
        }
      }
    }
    return accessToken;
  } catch (err: any) {
    console.warn(`[ChzzkService] 토큰 갱신 중 에러 발생 (유저: ${userId}):`, err.message);
    return undefined;
  }
};

/**
 * 치지직 access_token을 사용하여 최신 유저 프로필 정보를 조회합니다.
 */
export const fetchChzzkUserProfile = async (
  userId: string,
  accessToken: string
): Promise<{ nickname: string; profileImageUrl: string | null } | null> => {
  try {
    const profileHeaders = {
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chikapo-App/1.0'
    };

    const profileResponse = await fetch('https://openapi.chzzk.naver.com/open/v1/users/me', {
      headers: profileHeaders
    });

    let nickname = '';
    if (profileResponse.ok) {
      const profileData = (await profileResponse.json()) as any;
      if (profileData.code === 200 && profileData.content) {
        nickname = profileData.content.nickname || '';
      }
    }

    if (!nickname) return null;

    let profileImageUrl: string | null = null;
    try {
      const channelProfileResponse = await fetch(`https://api.chzzk.naver.com/service/v1/channels/${userId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (channelProfileResponse.ok) {
        const channelData = (await channelProfileResponse.json()) as any;
        if (channelData.code === 200 && channelData.content) {
          profileImageUrl = channelData.content.channelImageUrl || null;
        }
      }
    } catch (e) {
      console.warn(`[ChzzkService] 유저 채널 프로필 이미지 조회 실패 (대상: ${userId}):`, e);
    }

    return { nickname, profileImageUrl };
  } catch (e: any) {
    console.error(`[ChzzkService] 유저 프로필 조회 실패 (대상: ${userId}):`, e.message);
    return null;
  }
};
