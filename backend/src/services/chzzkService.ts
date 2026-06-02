import dotenv from 'dotenv';

dotenv.config();

export interface ChzzkProfile {
  name: string;
  logoUrl: string;
  followerCount: number;
  openLive: boolean;
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
      throw new Error(`치지직 API 응답 실패 (HTTP 상태 코드: ${profileRes.status})`);
    }

    const profileBody = (await profileRes.json()) as any;
    let openLive = false;
    let chatChannelId: string | null = null;
    let concurrentUserCount = 0;

    if (liveRes && liveRes.ok) {
      try {
        const liveBody = (await liveRes.json()) as any;
        if (liveBody.code === 200 && liveBody.content) {
          openLive = liveBody.content.status === 'OPEN';
          chatChannelId = liveBody.content.chatChannelId || null;
          concurrentUserCount = liveBody.content.concurrentUserCount || 0;
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
      openLive: false
    };
  }
};
