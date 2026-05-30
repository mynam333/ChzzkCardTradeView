import { Request, Response } from 'express';
import { 
  userRepository, 
  streamerRepository, 
  userCardRepository 
} from '../repositories';

/**
 * 1. 현재 사용자 최신 세션 정보 반환 (포인트 동기화)
 */
export const getUserMe = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
    }

    return res.status(200).json({
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${user.id}`,
      role: user.role,
      point: user.point,
      lastFreeDraw: user.last_free_draw
    });
  } catch (err: any) {
    console.error('[PlayController] getUserMe 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
};

/**
 * 2. 자산 랭킹 상위 유저 목록 조회
 */
export const getUserRankings = async (req: Request, res: Response) => {
  try {
    const rankings = await userRepository.findRankings(10);
    // 프론트엔드가 요구하는 구조로 매핑
    const mapped = rankings.map((u, index) => ({
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${u.id}`,
      point: u.point,
      card_count: 0 // 심플하게 0 또는 랜덤 카운트 부여
    }));

    return res.status(200).json(mapped);
  } catch (err: any) {
    console.error('[PlayController] getUserRankings 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
};

/**
 * 3. 현재 사용자가 보유한 포토카드 인벤토리 목록 반환
 */
export const getUserCards = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const cards = await userCardRepository.findByUserId(userId);
    return res.status(200).json(cards);
  } catch (err: any) {
    console.error('[PlayController] getUserCards 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
};

/**
 * 4. 카드 팩 1회 소환 (가챠 뽑기)
 */
export const drawCard = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const DRAW_COST = 10000; // 1회 뽑기 비용 1만 포인트로 수정

  try {
    // A. 유저 정보 조회
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
    }

    // B. 무료 뽑기 가능 여부 체크 (KST 기준 자정 초기화)
    // KST는 UTC+9
    const nowKst = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
    const todayStrKst = nowKst.toISOString().split('T')[0]; // YYYY-MM-DD

    let isFreeDraw = false;
    if (!user.last_free_draw) {
      isFreeDraw = true;
    } else {
      const lastFreeKst = new Date(new Date(user.last_free_draw).getTime() + 9 * 60 * 60 * 1000);
      const lastFreeStrKst = lastFreeKst.toISOString().split('T')[0];
      if (lastFreeStrKst !== todayStrKst) {
        isFreeDraw = true;
      }
    }

    // 포인트 검증
    if (!isFreeDraw && user.point < DRAW_COST) {
      return res.status(400).json({ error: 'BadRequest', message: `포인트가 부족합니다. (1회 뽑기: ${DRAW_COST.toLocaleString()} P)` });
    }

    // C. 가챠 대상 스트리머 목록 추출
    const streamers = await streamerRepository.findAll();
    if (streamers.length === 0) {
      return res.status(400).json({ error: 'BadRequest', message: '소환할 스트리머 정보가 없습니다. DB를 점검해 주세요.' });
    }

    // D. 무작위 스트리머 추첨
    const luckyStreamer = streamers[Math.floor(Math.random() * streamers.length)];

    // E. 순차 시리얼 넘버 발급 (0001부터 9999까지 등록순)
    const lastSn = await userCardRepository.findLatestSerialNumber(luckyStreamer.channel_id);
    let serialNumber = lastSn + 1;
    if (serialNumber > 9999) {
      // 9999를 초과하면 순환하거나 에러를 내야하지만, 0001부터 다시 시작하도록 롤오버 처리
      serialNumber = 1;
    }

    // F. 재화 차감 또는 무료 기회 소진 업데이트
    let nextPoint = user.point;
    if (isFreeDraw) {
      // 무료 뽑기 시간 업데이트 (현재 시각 ISO String)
      await userRepository.updateLastFreeDraw(userId, new Date().toISOString());
    } else {
      nextPoint = user.point - DRAW_COST;
      await userRepository.updatePoint(userId, nextPoint);
    }

    // G. 보유 카드 레코드 영구 등록
    const newCard = await userCardRepository.create({
      user_id: userId,
      channel_id: luckyStreamer.channel_id,
      serial_number: serialNumber
    });

    return res.status(200).json({
      message: isFreeDraw 
        ? `일일 무료 뽑기로 ${luckyStreamer.name} 카드를 획득하였습니다!` 
        : `${luckyStreamer.name} 카드를 획득하였습니다!`,
      points_left: nextPoint,
      is_free: isFreeDraw,
      card: {
        id: newCard.id,
        channel_id: luckyStreamer.channel_id,
        serial_number: serialNumber,
        acquired_at: new Date().toISOString(),
        streamer: luckyStreamer
      }
    });
  } catch (err: any) {
    console.error('[PlayController] drawCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
};

/**
 * 5. 치지직 스트리머명 검색 API (비공식 치지직 검색 API 연동)
 */
export const searchChzzkStreamer = async (req: Request, res: Response) => {
  const { keyword } = req.query;
  if (!keyword) {
    return res.status(400).json({ error: 'BadRequest', message: '검색 키워드(keyword)가 필요합니다.' });
  }

  try {
    // 치지직 내부 비공식 검색 API 호출
    const response = await fetch(`https://api.chzzk.naver.com/service/v1/search/channels?keyword=${encodeURIComponent(keyword as string)}&size=8`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`치지직 채널 검색 실패: ${response.status}`);
    }

    const data = (await response.json()) as any;
    const channels = data.content?.data || [];

    // 필요한 프사, 이름, 채널 ID 형태만 추출하여 프론트에 전달
    const mapped = channels.map((item: any) => ({
      channelId: item.channel.channelId,
      channelName: item.channel.channelName,
      channelImageUrl: item.channel.channelImageUrl,
      followerCount: item.channel.followerCount || 0
    }));

    return res.status(200).json(mapped);
  } catch (err: any) {
    console.error('[PlayController] searchChzzkStreamer 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
};

/**
 * 6. 사용자가 수동으로 새로운 스트리머를 카드로 등록
 */
export const registerStreamer = async (req: Request, res: Response) => {
  const { channelId, channelName, channelImageUrl, followerCount } = req.body;

  if (!channelId || !channelName) {
    return res.status(400).json({ error: 'BadRequest', message: '스트리머 채널 ID와 이름이 필요합니다.' });
  }

  // README 명세 기준 팔로워 150명 이상의 스트리머만 등록 가능하도록 차단 필터 적용
  if (followerCount !== undefined && Number(followerCount) < 150) {
    return res.status(400).json({ 
      error: 'InsufficientFollowers', 
      message: '치지직 카드 등록 정책에 따라 팔로워 수가 150명 이상인 스트리머만 카드로 등록할 수 있습니다.' 
    });
  }

  try {
    // 중복 체크
    const exists = await streamerRepository.findById(channelId);
    if (exists) {
      return res.status(400).json({ error: 'Conflict', message: '이미 카드로 등록되어 있는 스트리머입니다.' });
    }

    // 기본 시세 계산 (기본 1000P + 팔로워 수의 1/100, 최대 10,000P 캡핑)
    const baseValue = Math.min(10000, 1000 + Math.floor((followerCount || 0) / 100));

    const newStreamer = {
      channel_id: channelId,
      name: channelName,
      logo_url: channelImageUrl || null,
      custom_image_url: null,
      is_image_banned: false,
      follower_count: followerCount || 0,
      activity_score: 50, // 기본 활동점수
      base_value: baseValue,
      is_active: true
    };

    await streamerRepository.save(newStreamer);

    return res.status(200).json({
      message: `${channelName} 스트리머가 신규 카드 리스트로 성공적으로 등록되었습니다.`,
      streamer: newStreamer
    });
  } catch (err: any) {
    console.error('[PlayController] registerStreamer 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: err.message });
  }
};
