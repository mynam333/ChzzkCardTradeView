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

export interface ChzzkTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // 초 단위 만료 시간
}

/**
 * refresh_token으로 치지직 OAuth access_token을 갱신합니다.
 * 성공 시 새 토큰 세트를, 실패 시 null을 반환합니다.
 */
export const refreshChzzkToken = async (refreshToken: string): Promise<ChzzkTokenResult | null> => {
  const clientId = process.env.CHZZK_CLIENT_ID || '';
  const clientSecret = process.env.CHZZK_CLIENT_SECRET || '';
  if (!refreshToken || !clientId || !clientSecret) return null;

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
      return null;
    }
    const body = (await res.json()) as any;
    const content = body.content || body;
    const accessToken = content.accessToken || content.access_token;
    const newRefresh = content.refreshToken || content.refresh_token || refreshToken;
    const expiresIn = Number(content.expiresIn || content.expires_in || 0);
    if (!accessToken) return null;
    return { accessToken, refreshToken: newRefresh, expiresIn };
  } catch (e: any) {
    console.warn('[ChzzkService] 토큰 갱신 중 예외:', e.message);
    return null;
  }
};

export const fetchChzzkChannelProfile = async (
  channelId: string,
  throwOnError = false
): Promise<ChzzkProfile> => {
  const profileUrl = `https://api.chzzk.naver.com/service/v1/channels/${channelId}`;
  const liveStatusUrl = `https://api.chzzk.naver.com/polling/v2/channels/${channelId}/live-status`;

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    const [profileRes, liveRes] = await Promise.all([
      fetch(profileUrl, { headers }),
      fetch(liveStatusUrl, { headers }).catch(() => null)
    ]);

    if (!profileRes.ok) {
      const error = new Error(`치지직 API 응답 실패 (HTTP 상태 코드: ${profileRes.status})`) as Error & { statusCode?: number };
      error.statusCode = profileRes.status;
      throw error;
    }

    const profileBody = (await profileRes.json()) as any;
    const findDateCandidate = (value: any, depth = 0): string | null => {
      if (!value || depth > 3) return null;
      if (typeof value !== 'object') return null;
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

    let openLive = false;
    let chatChannelId: string | null = null;
    let concurrentUserCount = 0;
    let lastLiveAt: string | null = null;

    if (liveRes && liveRes.ok) {
      try {
        const liveBody = (await liveRes.json()) as any;
        if (liveBody.code === 200 && liveBody.content) {
          openLive = liveBody.content.status === 'OPEN';
          chatChannelId = liveBody.content.chatChannelId || null;
          concurrentUserCount = liveBody.content.concurrentUserCount || 0;
          lastLiveAt = openLive ? new Date().toISOString() : findDateCandidate(liveBody.content);
        }
      } catch (e) {
        console.warn(`[ChzzkService] 방송 상태 파싱 실패 (대상: ${channelId})`);
      }
    }

    if (profileBody.code === 200 && profileBody.content) {
      const { channelName, channelImageUrl, followerCount } = profileBody.content;
      return {
        name: channelName || '알 수 없는 스트리머',
        logoUrl: channelImageUrl || 'https://api.dicebear.com/7.x/identicon/svg?seed=' + channelId,
        followerCount: followerCount || 0,
        openLive,
        lastLiveAt: lastLiveAt || findDateCandidate(profileBody.content),
        chatChannelId,
        concurrentUserCount
      };
    } else {
      throw new Error(profileBody.message || 'API 응답 형식이 올바르지 않습니다.');
    }
  } catch (error: any) {
    console.warn(`[ChzzkService] 치지직 API 조회 실패 (대상: ${channelId}):`, error.message);
    // 신규 카드 등록처럼 정확한 검증이 필요한 경우에는 폴백 더미 데이터 대신 에러를 전파합니다.
    if (throwOnError) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    return {
      name: `스트리머_${channelId.substring(0, 5)}`,
      logoUrl: `https://api.dicebear.com/7.x/adventurer/svg?seed=${channelId}`,
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
        const refreshed = await refreshChzzkToken(refresh);
        if (refreshed) {
          const newExpiry = refreshed.expiresIn
            ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
            : null;
          await userRepository.updateTokens(
            userId,
            encryptToken(refreshed.accessToken),
            encryptToken(refreshed.refreshToken),
            newExpiry
          );
          console.log(`[ChzzkService] 치지직 토큰 갱신 완료 (유저: ${userId})`);
          return refreshed.accessToken;
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
