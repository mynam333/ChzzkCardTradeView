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

export const fetchChzzkChannelProfile = async (channelId: string): Promise<ChzzkProfile> => {
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
    return {
      name: `스트리머_${channelId.substring(0, 5)}`,
      logoUrl: `https://api.dicebear.com/7.x/adventurer/svg?seed=${channelId}`,
      followerCount: 150,
      openLive: false
    };
  }
};
