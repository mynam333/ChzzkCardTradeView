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

  const DRAW_COST = 1000;

  try {
    // A. 유저 정보 조회 및 포인트 검증
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
    }

    if (user.point < DRAW_COST) {
      return res.status(400).json({ error: 'BadRequest', message: '포인트가 부족합니다. (1회 뽑기: 1,000 P)' });
    }

    // B. 가챠 대상 스트리머 목록 추출
    const streamers = await streamerRepository.findAll();
    if (streamers.length === 0) {
      return res.status(400).json({ error: 'BadRequest', message: '소환할 스트리머 정보가 없습니다. DB를 점검해 주세요.' });
    }

    // C. 무작위 스트리머 추첨
    const luckyStreamer = streamers[Math.floor(Math.random() * streamers.length)];

    // D. 포인트 차감 업데이트
    const nextPoint = user.point - DRAW_COST;
    await userRepository.updatePoint(userId, nextPoint);

    // E. 보유 카드 레코드 영구 등록
    const serialNumber = Math.floor(Math.random() * 900) + 100;
    const newCard = await userCardRepository.create({
      user_id: userId,
      channel_id: luckyStreamer.channel_id,
      serial_number: serialNumber
    });

    return res.status(200).json({
      message: `${luckyStreamer.name} 카드를 획득하였습니다!`,
      points_left: nextPoint,
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
