import { Request, Response } from 'express';
import {
  userRepository,
  streamerRepository,
  userCardRepository
} from '../repositories';
import { IS_PRODUCTION } from '../config';
import { fetchChzzkChannelProfile } from '../services/chzzkService';
import { getUserReservations } from './tradeController';

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
      lastFreeDraw: user.last_free_draw,
      representativeCardChannelId: user.representative_card_channel_id || null
    });
  } catch (err: any) {
    console.error('[PlayController] getUserMe 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 2. 자산 랭킹 상위 유저 목록 조회
 */
export const getUserRankings = async (req: Request, res: Response) => {
  try {
    const rankings = await userRepository.findRankings(10);
    // 프론트엔드가 요구하는 구조로 매핑 (실제 보유 카드 수 및 포인트+카드가치 총자산 포함)
    const mapped = rankings.map((u) => ({
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url || `https://api.dicebear.com/7.x/pixel-art/svg?seed=${u.id}`,
      point: u.point,
      card_count: u.card_count,
      total_asset: u.total_asset
    }));

    return res.status(200).json(mapped);
  } catch (err: any) {
    console.error('[PlayController] getUserRankings 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
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
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
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

    // B. 가챠 대상 스트리머 목록 추출 (재화 소모 전에 먼저 검증)
    const streamers = await streamerRepository.findAll();
    if (streamers.length === 0) {
      return res.status(400).json({ error: 'BadRequest', message: '소환할 스트리머 정보가 없습니다. DB를 점검해 주세요.' });
    }

    // C. 무료 뽑기 시도 (KST 자정 기준, 단일 원자적 UPDATE로 이중 무료뽑기 방지)
    const nowIso = new Date().toISOString();
    const todayStrKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
    const isFreeDraw = await userRepository.claimFreeDrawIfEligible(userId, todayStrKst, nowIso);

    // D. 무료가 아니면 잔액이 충분할 때만 원자적으로 차감
    if (!isFreeDraw) {
      const deducted = await userRepository.tryDeductPoint(userId, DRAW_COST);
      if (!deducted) {
        return res.status(400).json({ error: 'BadRequest', message: `포인트가 부족합니다. (1회 뽑기: ${DRAW_COST.toLocaleString()} P)` });
      }
    }

    // E. 실시간 스트리머 가치 기반 가중치 추첨 (가치가 높을수록 확률 하락, 낮을수록 확률 상승)
    const weights = streamers.map(s => 1 / (s.base_value || 100));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);

    let randomNum = Math.random() * totalWeight;
    let luckyStreamer = streamers[0];

    for (let i = 0; i < streamers.length; i++) {
      randomNum -= weights[i];
      if (randomNum <= 0) {
        luckyStreamer = streamers[i];
        break;
      }
    }

    // F. 해당 스트리머 카드의 발행 일련번호 부여 (기존 발행분 + 1)
    const latestSn = await userCardRepository.findLatestSerialNumber(luckyStreamer.channel_id);
    const serialNumber = latestSn + 1;

    // G. 보유 카드 레코드 영구 등록
    const newCard = await userCardRepository.create({
      user_id: userId,
      channel_id: luckyStreamer.channel_id,
      serial_number: serialNumber
    });

    // 차감/지급 이후 최신 잔액 조회
    const refreshed = await userRepository.findById(userId);
    const nextPoint = refreshed ? refreshed.point : user.point;

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
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
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
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 6. 사용자가 수동으로 새로운 스트리머를 카드로 등록
 *
 * 보안: 클라이언트가 보낸 팔로워 수/이름/이미지를 신뢰하지 않고, 서버에서 치지직 API로
 * 직접 재조회한 권위 있는 값으로 검증 및 시세를 산정합니다.
 */
export const registerStreamer = async (req: Request, res: Response) => {
  const { channelId } = req.body;

  if (!channelId) {
    return res.status(400).json({ error: 'BadRequest', message: '스트리머 채널 ID가 필요합니다.' });
  }

  try {
    // 중복 체크
    const exists = await streamerRepository.findById(channelId);
    if (exists) {
      return res.status(400).json({ error: 'Conflict', message: '이미 카드로 등록되어 있는 스트리머입니다.' });
    }

    // 치지직 API로 권위 있는 프로필을 서버측에서 직접 조회 (실패 시 throw)
    let profile;
    try {
      profile = await fetchChzzkChannelProfile(channelId, true);
    } catch {
      return res.status(404).json({
        error: 'ChannelNotFound',
        message: '치지직에서 해당 채널 정보를 확인할 수 없습니다. 채널 ID를 다시 확인해 주세요.'
      });
    }

    const verifiedName = profile.name;
    const verifiedFollowerCount = profile.followerCount;
    const verifiedLogoUrl = profile.logoUrl;

    // README 명세 기준 팔로워 150명 이상의 스트리머만 등록 가능하도록 서버 검증값으로 차단 필터 적용
    if (verifiedFollowerCount < 150) {
      return res.status(400).json({
        error: 'InsufficientFollowers',
        message: '치지직 카드 등록 정책에 따라 팔로워 수가 150명 이상인 스트리머만 카드로 등록할 수 있습니다.'
      });
    }

    // 기본 시세 계산 (기본 가치는 팔로워 수와 1:1 매칭하되 하한 100, 상한 500,000 적용)
    const baseValue = Math.min(500000, Math.max(verifiedFollowerCount, 100));
    // 스트리머용 시리얼 넘버 할당 (1 ~ 9999 중 비어있는 가장 작은 번호 자동 매칭)
    const allocatedStreamerSns = await streamerRepository.findAllocatedStreamerSerialNumbers();
    const allocatedSet = new Set(allocatedStreamerSns);
    let serialNumber = 1;
    for (let i = 1; i <= 9999; i++) {
      if (!allocatedSet.has(i)) {
        serialNumber = i;
        break;
      }
    }

    const newStreamer = {
      channel_id: channelId,
      name: verifiedName,
      logo_url: verifiedLogoUrl || null,
      custom_image_url: null,
      is_image_banned: false,
      follower_count: verifiedFollowerCount,
      activity_score: 50, // 기본 활동점수
      base_value: baseValue,
      is_active: profile.openLive,
      serial_number: serialNumber
    };
    await streamerRepository.save(newStreamer);

    return res.status(200).json({
      message: `${verifiedName} 스트리머가 신규 카드 리스트로 성공적으로 등록되었습니다.`,
      streamer: newStreamer
    });
  } catch (err: any) {
    console.error('[PlayController] registerStreamer 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 7. 카드 판매 및 일괄 판매 처리 API
 * POST /api/cards/sell
 * Body: { items: Array<{ channelId: string, count: number }> }
 */
export const sellCards = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'BadRequest', message: '판매할 카드 목록(items)이 필요합니다.' });
  }

  try {
    // A. 유저 정보 조회
    const user = await userRepository.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
    }

    // B. 유저 보유 카드 데이터 조회
    const userCards = await userCardRepository.findByUserId(userId);

    // channelId별 유저 보유 카드 매핑
    const userCardsByChannel: { [key: string]: any[] } = {};
    userCards.forEach(uc => {
      const cid = uc.channel_id;
      if (!userCardsByChannel[cid]) {
        userCardsByChannel[cid] = [];
      }
      userCardsByChannel[cid].push(uc);
    });

    // 진행 중인 거래에 묶인(에스크로) 카드는 판매 불가하도록 예약량 차감
    const reservations = await getUserReservations(userId);

    let totalGainedPoints = 0;
    const sellActions: { channelId: string, count: number, baseValue: number }[] = [];

    // C. 판매 항목 수량 및 시세 검증
    for (const item of items) {
      const { channelId, count } = item;
      if (!channelId || !count || count <= 0) {
        return res.status(400).json({ error: 'BadRequest', message: '올바른 channelId와 0보다 큰 수량이 필요합니다.' });
      }

      const owned = userCardsByChannel[channelId] || [];
      const reserved = reservations.cards[channelId] || 0;
      const sellable = owned.length - reserved;
      if (sellable < count) {
        return res.status(400).json({
          error: 'InsufficientCards',
          message: `판매 가능한 카드 수량이 부족합니다. (보유 ${owned.length}장 중 거래 중 ${reserved}장, 판매 요청 ${count}장)`
        });
      }

      // 시세 가치 조회
      const streamer = owned[0]?.streamer;
      if (!streamer) {
        return res.status(404).json({ error: 'NotFound', message: `스트리머 정보를 찾을 수 없습니다. (채널 ID: ${channelId})` });
      }

      const baseValue = streamer.base_value || 0;
      totalGainedPoints += baseValue * count;
      sellActions.push({ channelId, count, baseValue });
    }

    // D. 판매 처리: 실제로 삭제된 카드 수량만큼만 정산하여 동시 판매로 인한 초과 지급 방지
    let actualGainedPoints = 0;
    for (const action of sellActions) {
      const deletedCount = await userCardRepository.deleteCards(userId, action.channelId, action.count);
      actualGainedPoints += action.baseValue * deletedCount;
    }

    // 원자적으로 포인트 가산
    if (actualGainedPoints > 0) {
      await userRepository.incrementPoint(userId, actualGainedPoints);
    }
    const refreshed = await userRepository.findById(userId);
    const nextPoint = refreshed ? refreshed.point : user.point + actualGainedPoints;

    return res.status(200).json({
      message: `성공적으로 카드 판매가 완료되었습니다. 총 ${actualGainedPoints.toLocaleString()} 포인트를 획득하였습니다!`,
      points_gained: actualGainedPoints,
      new_points: nextPoint
    });
  } catch (err: any) {
    console.error('[PlayController] sellCards 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 8. 특정 스트리머 상세 정보 + 시세 변화 그래프 데이터 조회 (공개)
 * GET /api/streamers/:channel_id?range=24h|7d
 */
export const getStreamerDetail = async (req: Request, res: Response) => {
  const { channel_id } = req.params;
  const range = (req.query.range as string) || '7d';

  if (!channel_id) {
    return res.status(400).json({ error: 'BadRequest', message: '스트리머 채널 ID가 필요합니다.' });
  }

  try {
    const streamer = await streamerRepository.findById(channel_id);
    if (!streamer) {
      return res.status(404).json({ error: 'NotFound', message: '스트리머 정보를 찾을 수 없습니다.' });
    }

    const hours = range === '24h' ? 24 : 24 * 7;
    const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const history = await streamerRepository.getValueHistory(channel_id, sinceIso);

    // 24h 등락률 계산용 24h 전 시세
    const value24hMap = await streamerRepository.getValue24hAgoMap();
    const prevValue24h = value24hMap[channel_id] ?? streamer.prev_value ?? streamer.base_value;

    return res.status(200).json({
      streamer: { ...streamer, prev_value: prevValue24h },
      history
    });
  } catch (err: any) {
    console.error('[PlayController] getStreamerDetail 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 상세 조회에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 9. 대표 카드 설정/해제
 * POST /api/users/me/representative  Body: { channel_id: string | null }
 */
export const setRepresentativeCard = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const { channel_id } = req.body;

  try {
    if (channel_id) {
      // 본인이 해당 스트리머 카드를 1장 이상 보유하고 있는지 검증
      const cards = await userCardRepository.findByUserId(userId);
      const owns = cards.some((c) => c.channel_id === channel_id);
      if (!owns) {
        return res.status(400).json({ error: 'BadRequest', message: '보유하지 않은 카드는 대표 카드로 설정할 수 없습니다.' });
      }
      await userRepository.updateRepresentativeCard(userId, channel_id);
    } else {
      // null 전달 시 대표 카드 해제
      await userRepository.updateRepresentativeCard(userId, null);
    }

    return res.status(200).json({
      message: channel_id ? '대표 카드가 설정되었습니다.' : '대표 카드가 해제되었습니다.',
      representative_card_channel_id: channel_id || null
    });
  } catch (err: any) {
    console.error('[PlayController] setRepresentativeCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '대표 카드 설정에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};
