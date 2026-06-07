import { Request, Response } from 'express';
import {
  userRepository,
  streamerRepository,
  userCardRepository,
  systemConfigRepository,
  marketRepository,
  titleRepository
} from '../repositories';
import { IS_PRODUCTION } from '../config';
import { fetchChzzkChannelProfile, getValidUserAccessToken, fetchChzzkUserProfile } from '../services/chzzkService';
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

    // 치지직 최신 프로필/닉네임 동기화
    try {
      const accessToken = await getValidUserAccessToken(userId);
      if (accessToken) {
        const profile = await fetchChzzkUserProfile(userId, accessToken);
        if (profile) {
          const { nickname, profileImageUrl } = profile;
          if (user.username !== nickname || user.avatar_url !== profileImageUrl) {
            await userRepository.updateProfile(userId, nickname, profileImageUrl);
            user.username = nickname;
            user.avatar_url = profileImageUrl;
            console.log(`[PlayController] 유저 정보 업데이트 완료 (ID: ${userId}, 닉네임: ${nickname})`);
          }
        }
      }
    } catch (syncErr: any) {
      console.warn(`[PlayController] 유저 정보 로그인 동기화 실패 (기존 정보 사용):`, syncErr.message);
    }

    // 무료 뽑기 간격 및 가챠 비용 정보 추가
    const intervalStr = await systemConfigRepository.get('free_draw_interval', '24');
    const intervalHours = parseFloat(intervalStr);
    const drawCostStr = await systemConfigRepository.get('draw_cost', '10000');
    const drawCost = Math.max(0, parseInt(drawCostStr, 10) || 10000);

    let segmentStartIso: string | null = null;
    let nextFreeDrawAt: string | null = null;

    if (intervalHours > 0) {
      const now = new Date();
      const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

      const kstDate = new Date(now.getTime() + KST_OFFSET_MS);
      const kstYear = kstDate.getUTCFullYear();
      const kstMonth = kstDate.getUTCMonth();
      const kstDay = kstDate.getUTCDate();

      const midnightKstUtcMs = Date.UTC(kstYear, kstMonth, kstDay, 0, 0, 0) - KST_OFFSET_MS;

      const diffMs = now.getTime() - midnightKstUtcMs;
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const count = Math.floor(diffMs / intervalMs);

      segmentStartIso = new Date(midnightKstUtcMs + count * intervalMs).toISOString();
      nextFreeDrawAt = new Date(midnightKstUtcMs + (count + 1) * intervalMs).toISOString();
    }

    let isFreeDrawEligible = false;
    if (segmentStartIso === null) {
      isFreeDrawEligible = true; // 0시간마다 = 무제한 무료
    } else {
      if (!user.last_free_draw) {
        isFreeDrawEligible = true;
      } else {
        isFreeDrawEligible = new Date(user.last_free_draw).getTime() < new Date(segmentStartIso).getTime();
      }
    }

    const ownedTitles = await titleRepository.findByUserId(userId);
    const titles = ownedTitles.filter((title) => title.is_equipped);

    return res.status(200).json({
      id: user.id,
      username: user.username,
      avatarUrl: user.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${user.id}`,
      role: user.role,
      titles,
      ownedTitles,
      point: user.point,
      lastFreeDraw: user.last_free_draw,
      representativeCardChannelId: user.representative_card_channel_id || null,
      representativeCardStar: user.representative_card_star ?? null,
      drawCost,
      freeDrawInterval: intervalHours,
      isFreeDrawEligible,
      nextFreeDrawAt
    });
  } catch (err: any) {
    console.error('[PlayController] getUserMe 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '서버 내부 오류가 발생했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 닉네임으로 유저 검색 (거래 상대 선택용)
 */
export const searchUsers = async (req: Request, res: Response) => {
  const keyword = String(req.query.keyword || '').trim();
  const selfId = (req as any).user?.id;
  if (keyword.length < 1) {
    return res.status(400).json({ error: 'BadRequest', message: '검색어가 필요합니다.' });
  }
  try {
    const users = await userRepository.searchByUsername(keyword, 12);
    const mapped = users
      .filter((u) => u.id !== selfId) // 자기 자신 제외
      .map((u) => ({
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${u.id}`
      }));
    return res.status(200).json(mapped);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '유저 검색 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 특정 유저의 보유 카드 컬렉션(channel_id별 묶음) 조회 — 거래 시 상대 보유 카드 선택용
 */
export const getUserCollection = async (req: Request, res: Response) => {
  const { user_id } = req.params;
  if (!user_id) {
    return res.status(400).json({ error: 'BadRequest', message: '유저 ID가 필요합니다.' });
  }
  try {
    const cards = await userCardRepository.findByUserId(user_id);
    // 같은 스트리머라도 별(0~5성)별로 분리해 묶음
    const map: { [key: string]: any } = {};
    for (const c of cards) {
      const star = c.star || 0;
      const key = `${c.channel_id}#${star}`;
      if (!map[key]) {
        map[key] = { channel_id: c.channel_id, star, count: 0, streamer: c.streamer };
      }
      map[key].count += 1;
    }
    // 채널명 → 별 오름차순 정렬
    const list = Object.values(map).sort((a: any, b: any) => {
      const an = a.streamer?.name || '', bn = b.streamer?.name || '';
      return an === bn ? a.star - b.star : an.localeCompare(bn);
    });
    return res.status(200).json(list);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '컬렉션 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 차단 목록 조회
 */
export const getMyBlocks = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  try {
    const users = await userRepository.getBlockedUsers(userId);
    return res.status(200).json(users.map((u) => ({
      id: u.id,
      username: u.username,
      avatar_url: u.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${u.id}`
    })));
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '차단 목록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 유저 차단 (닉네임으로 검색하여 차단)
 * Body: { user_id?: string, username?: string }
 */
export const blockUser = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const { user_id, username } = req.body;
  if (!user_id && !(username && String(username).trim())) {
    return res.status(400).json({ error: 'BadRequest', message: '차단할 사용자를 지정해 주세요.' });
  }
  try {
    const target = user_id
      ? await userRepository.findById(String(user_id))
      : await userRepository.findByUsername(String(username).trim());
    if (!target) {
      return res.status(404).json({ error: 'NotFound', message: '해당 사용자를 찾을 수 없습니다.' });
    }
    if (target.id === userId) {
      return res.status(400).json({ error: 'BadRequest', message: '자기 자신은 차단할 수 없습니다.' });
    }
    await userRepository.blockUser(userId, target.id);
    return res.status(200).json({
      message: `${target.username}님을 차단했습니다. 해당 사용자는 회원님에게 교환을 제안할 수 없습니다.`,
      blocked: { id: target.id, username: target.username }
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '차단 처리 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 유저 차단 해제
 */
export const unblockUser = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  const targetId = req.params.user_id;
  if (!targetId) return res.status(400).json({ error: 'BadRequest', message: '대상 사용자 ID가 필요합니다.' });
  try {
    await userRepository.unblockUser(userId, targetId);
    return res.status(200).json({ message: '차단을 해제했습니다.' });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '차단 해제 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 유저 공개 프로필 조회 — 프로필 모달(닉네임/포인트/대표 카드/보유 카드 요약/총자산)
 */
export const getUserProfile = async (req: Request, res: Response) => {
  const { user_id } = req.params;
  if (!user_id) {
    return res.status(400).json({ error: 'BadRequest', message: '유저 ID가 필요합니다.' });
  }
  try {
    const user = await userRepository.findById(user_id);
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
    }
    const cards = await userCardRepository.findByUserId(user_id);

    // 채널+별 등급별 묶음 + 총 자산 계산
    const map: { [key: string]: any } = {};
    let cardAsset = 0;
    for (const c of cards) {
      const star = c.star || 0;
      const key = `${c.channel_id}#${star}`;
      const baseValue = c.streamer?.base_value || 0;
      cardAsset += Math.round(baseValue * starValueMultiplier(star));
      if (!map[key]) {
        map[key] = {
          channel_id: c.channel_id,
          star,
          count: 0,
          streamer: c.streamer
        };
      }
      map[key].count += 1;
    }
    const collection = Object.values(map).sort(
      (a: any, b: any) =>
        (b.streamer?.base_value || 0) * starValueMultiplier(b.star)
        - (a.streamer?.base_value || 0) * starValueMultiplier(a.star)
    );

    // 대표 카드: 채널+별을 함께 식별. 레거시 데이터는 지정 채널 중 가장 높은 별을 사용.
    let repCard: any = null;
    const repChannel = user.representative_card_channel_id;
    const repStar = user.representative_card_star;
    const pool = repChannel
      ? cards.filter((c) =>
          c.channel_id === repChannel
          && (repStar == null || (c.star || 0) === repStar)
        )
      : cards;
    const candidates = (pool.length ? pool : cards).slice();
    candidates.sort((a, b) => {
      const sa = a.star || 0, sb = b.star || 0;
      if (sb !== sa) return sb - sa;
      return (b.streamer?.base_value || 0) - (a.streamer?.base_value || 0);
    });
    if (candidates.length) {
      const c = candidates[0];
      repCard = {
        channel_id: c.channel_id,
        star: c.star || 0,
        serial_number: c.streamer?.serial_number ?? null,
        streamer: c.streamer,
        border: c.border || null,
        name_effect: c.name_effect || null
      };
    }

    const titles = (await titleRepository.findByUserId(user_id)).filter((title) => title.is_equipped);

    return res.status(200).json({
      id: user.id,
      username: user.username,
      role: user.role,
      titles,
      avatar_url: user.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${user.id}`,
      point: user.point,
      card_count: cards.length,
      unique_count: collection.length,
      total_asset: user.point + cardAsset,
      representative_card: repCard,
      collection
    });
  } catch (err: any) {
    console.error('[PlayController] getUserProfile 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '프로필 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 2. 자산 랭킹 상위 유저 목록 조회
 */
export const getUserRankings = async (req: Request, res: Response) => {
  try {
    const keyword = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    // 100위까지 랭킹을 늘리고 검색 키워드를 리포지토리에 전달
    const rankings = await userRepository.findRankings(100, keyword);
    const userIds = rankings.map((user) => user.id);
    const [titlesByUser, linkedStreamers] = await Promise.all([
      titleRepository.findByUserIds(userIds),
      streamerRepository.findByIds(userIds)
    ]);
    const streamerByChannelId = new Map(linkedStreamers.map((streamer) => [streamer.channel_id, streamer]));
    // 프론트엔드가 요구하는 구조로 매핑 (실제 보유 카드 수 및 포인트+카드가치 총자산 포함, 랭크 순위 추가)
    const mapped = rankings.map((u) => {
      const linkedStreamer = streamerByChannelId.get(u.id);
      return {
        id: u.id,
        username: u.username,
        avatar_url: u.avatar_url || `https://api.dicebear.com/10.x/fun-emoji/svg?seed=${u.id}`,
        point: u.point,
        card_count: u.card_count,
        total_asset: u.total_asset,
        rank: u.rank,
        titles: (titlesByUser[u.id] || []).filter((title) => title.is_equipped),
        is_streamer: !!linkedStreamer,
        is_live: linkedStreamer?.is_active === true
      };
    });

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

  // 뽑기 비용: DB의 draw_cost 설정값 사용 (기본 10000P)
  const drawCostStr = await systemConfigRepository.get('draw_cost', '10000');
  const DRAW_COST = Math.max(0, parseInt(drawCostStr, 10) || 10000);

  try {
    // A. 가챠 대상 스트리머 목록 추출 (재화 소모 전에 먼저 검증)
    const streamers = await streamerRepository.findAll();
    if (streamers.length === 0) {
      return res.status(400).json({ error: 'BadRequest', message: '소환할 스트리머 정보가 없습니다. DB를 점검해 주세요.' });
    }

    // B. 무료 뽑기 가능 세그먼트 계산 — KST 자정 기준으로 설정된 n시간 간격마다 정각에 리셋
    // 예) 1시간 설정 시: 00:00, 01:00, 02:00 ... KST 정각마다 리셋
    //     → 00:59에 뽑아도 01:00 정각이 되면 다시 뽑을 수 있음
    const nowIso = new Date().toISOString();
    const intervalStr = await systemConfigRepository.get('free_draw_interval', '24');
    const intervalHours = parseFloat(intervalStr);

    let segmentStartIso: string | null = null;
    if (intervalHours > 0) {
      const now = new Date();
      const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

      // KST 기준 오늘 날짜의 연·월·일 추출
      // now + KST_OFFSET_MS → UTC 메서드로 읽으면 KST 날짜로 해석 가능
      const kstDate = new Date(now.getTime() + KST_OFFSET_MS);
      const kstYear = kstDate.getUTCFullYear();
      const kstMonth = kstDate.getUTCMonth();
      const kstDay = kstDate.getUTCDate();

      // KST 00:00:00 → UTC 타임스탬프 (= 전날 UTC 15:00)
      const midnightKstUtcMs = Date.UTC(kstYear, kstMonth, kstDay, 0, 0, 0) - KST_OFFSET_MS;

      // 자정 이후 경과 시간으로 현재 세그먼트 번호 산출
      const diffMs = now.getTime() - midnightKstUtcMs;
      const intervalMs = intervalHours * 60 * 60 * 1000;
      const count = Math.floor(diffMs / intervalMs);

      // 현재 세그먼트 시작 시각(UTC ISO)
      segmentStartIso = new Date(midnightKstUtcMs + count * intervalMs).toISOString();
    }
    // intervalHours === 0 이면 segmentStartIso = null → 무제한 무료뽑기

    // C. 실시간 스트리머 가치 기반 가중치 추첨 (가치가 높을수록 확률 하락, 낮을수록 확률 상승)
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

    // D. 무료권/포인트 차감 + 시리얼 채번 + 카드 생성을 단일 트랜잭션/RPC로 처리
    const draw = await userCardRepository.drawAtomic(userId, luckyStreamer.channel_id, DRAW_COST, nowIso, segmentStartIso);
    if (!draw.ok) {
      if (draw.reason === 'USER_NOT_FOUND') {
        return res.status(404).json({ error: 'NotFound', message: '사용자를 찾을 수 없습니다.' });
      }
      if (draw.reason === 'INSUFFICIENT_POINT') {
        return res.status(400).json({ error: 'BadRequest', message: `포인트가 부족합니다. (1회 뽑기: ${DRAW_COST.toLocaleString()} P)` });
      }
      return res.status(500).json({ error: 'InternalServerError', message: '카드 뽑기 처리에 실패했습니다.' });
    }

    return res.status(200).json({
      message: draw.is_free
        ? `일일 무료 뽑기로 ${luckyStreamer.name} 카드를 획득하였습니다!`
        : `${luckyStreamer.name} 카드를 획득하였습니다!`,
      points_left: draw.points_left,
      is_free: draw.is_free,
      card: {
        id: draw.card?.id,
        channel_id: luckyStreamer.channel_id,
        serial_number: draw.card?.serial_number,
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
      serial_number: serialNumber,
      registered_by: (req as any).user?.id || null // 등록한 유저 ID 기록 (Null 가능)
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
 * Body: { items: Array<{ channelId: string, star: number, count: number }> }
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

    const pendingMarketIds = new Set(await marketRepository.findPendingCardIdsByUser(userId));

    // channelId+star별 유저 보유 카드 매핑
    const userCardsByKey: { [key: string]: any[] } = {};
    userCards.forEach(uc => {
      const key = `${uc.channel_id}#${uc.star || 0}`;
      if (!userCardsByKey[key]) {
        userCardsByKey[key] = [];
      }
      userCardsByKey[key].push(uc);
    });

    // 진행 중인 거래에 묶인(에스크로) 카드는 판매 불가하도록 예약량 차감
    const reservations = await getUserReservations(userId);

    const sellActions: { channelId: string, star: number, count: number, baseValue: number }[] = [];

    // C. 판매 항목 수량 및 시세 검증
    for (const item of items) {
      const { channelId, count } = item;
      const star = Number(item.star);
      if (!channelId || !Number.isInteger(star) || star < 0 || star > 5 || !Number.isInteger(count) || count <= 0) {
        return res.status(400).json({ error: 'BadRequest', message: '올바른 channelId, 별 등급(0~5), 수량이 필요합니다.' });
      }

      const key = `${channelId}#${star}`;
      const owned = userCardsByKey[key] || [];
      const reserved = reservations.cardsByStar[key] || 0;
      const pendingMarket = owned.filter((card) => pendingMarketIds.has(card.id)).length;
      const sellable = owned.length - reserved - pendingMarket;
      if (sellable < count) {
        return res.status(400).json({
          error: 'InsufficientCards',
          message: `${star}성 카드의 판매 가능 수량이 부족합니다. (보유 ${owned.length}장, 교환 중 ${reserved}장, 마켓 판매 중 ${pendingMarket}장, 판매 요청 ${count}장)`
        });
      }

      // 시세 가치 조회
      const streamer = owned[0]?.streamer;
      if (!streamer) {
        return res.status(404).json({ error: 'NotFound', message: `스트리머 정보를 찾을 수 없습니다. (채널 ID: ${channelId})` });
      }

      const baseValue = streamer.base_value || 0;
      sellActions.push({ channelId, star, count, baseValue });
    }

    // D. 판매 처리: 카드 삭제와 포인트 가산을 단일 트랜잭션/RPC로 처리
    const actualGainedPoints = await userCardRepository.sellCardsAtomic(userId, sellActions);
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

/** 별 등급에 따른 가치 배율 (0성=1배 ~ 5성=4배) */
export const starValueMultiplier = (star: number): number => 1 + (star || 0) * 0.8;

/**
 * 카드 한계돌파: 대상 카드 별 상승 + 같은 스트리머의 0성 카드 1장 소모
 * POST /api/cards/fuse  Body: { channel_id, star }
 */
export const fuseCards = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const { channel_id, star } = req.body;
  const starNum = Number(star) || 0;
  if (!channel_id) return res.status(400).json({ error: 'BadRequest', message: '합성할 카드(channel_id)가 필요합니다.' });
  if (starNum < 0 || starNum >= 5) return res.status(400).json({ error: 'BadRequest', message: '0~4성 카드만 합성할 수 있습니다.' });

  try {
    // 진행 중 거래에 예약된 카드는 합성 재료로 사용할 수 없도록 차단
    const cards = await userCardRepository.findByUserId(userId);
    const reservations = await getUserReservations(userId);
    const pendingMarketIds = new Set(await marketRepository.findPendingCardIdsByUser(userId));
    const key = (st: number) => `${channel_id}#${st}`;
    const available = (st: number) =>
      cards.filter((c) =>
        c.channel_id === channel_id
        && (c.star || 0) === st
        && c.id != null
        && !pendingMarketIds.has(c.id)
      ).length
      - (reservations.cardsByStar[key(st)] || 0);
    const targetAvailable = available(starNum);
    const fodderAvailable = available(0) - (starNum === 0 ? 1 : 0);
    if (targetAvailable < 1 || fodderAvailable < 1) {
      return res.status(400).json({
        error: 'FuseFailed',
        reason: 'RESERVED_OR_SHORT',
        message: '한계돌파에 사용할 수 있는 카드가 부족합니다. 진행 중인 교환에 묶인 카드는 사용할 수 없습니다.'
      });
    }

    const result = await userCardRepository.fuse(userId, channel_id, starNum);
    if (!result.ok) {
      let msg = '한계돌파에 실패했습니다.';
      if (result.reason === 'MAX_STAR') msg = '이미 최고 등급(5성)입니다.';
      else if (result.reason === 'NO_TARGET') msg = `${starNum}성 카드를 보유하고 있지 않습니다.`;
      else if (result.reason === 'NO_FODDER') {
        msg = starNum === 0
          ? '한계돌파에는 같은 스트리머의 0성 카드가 2장(대상 1장 + 재료 1장) 필요합니다.'
          : '한계돌파에는 재료로 쓸 같은 스트리머의 0성 카드가 1장 더 필요합니다.';
      }
      return res.status(400).json({ error: 'FuseFailed', reason: result.reason, message: msg });
    }
    return res.status(200).json({ message: `한계돌파 성공! ${result.newStar}성 카드가 되었습니다. ⭐`, new_star: result.newStar });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '합성 처리 실패', details: IS_PRODUCTION ? undefined : err.message });
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

    // 최근 마켓 거래 체결가 조회
    const recentMarketPrice = await marketRepository.getRecentPrice(channel_id);

    return res.status(200).json({
      streamer: {
        ...streamer,
        prev_value: prevValue24h,
        recent_market_price: recentMarketPrice
      },
      history
    });
  } catch (err: any) {
    console.error('[PlayController] getStreamerDetail 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '스트리머 상세 조회에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};

/**
 * 9. 대표 카드 설정/해제
 * POST /api/users/me/representative  Body: { channel_id: string | null, star: number | null }
 */
export const setRepresentativeCard = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  const { channel_id } = req.body;
  const star = channel_id ? Number(req.body.star) : null;

  try {
    if (channel_id) {
      if (!Number.isInteger(star) || star! < 0 || star! > 5) {
        return res.status(400).json({ error: 'BadRequest', message: '대표 카드의 별 등급(0~5)이 필요합니다.' });
      }
      // 본인이 해당 스트리머의 해당 별 카드를 1장 이상 보유하고 있는지 검증
      const cards = await userCardRepository.findByUserId(userId);
      const owns = cards.some((c) => c.channel_id === channel_id && (c.star || 0) === star);
      if (!owns) {
        return res.status(400).json({ error: 'BadRequest', message: '보유하지 않은 카드는 대표 카드로 설정할 수 없습니다.' });
      }
      await userRepository.updateRepresentativeCard(userId, channel_id, star);
    } else {
      // null 전달 시 대표 카드 해제
      await userRepository.updateRepresentativeCard(userId, null, null);
    }

    return res.status(200).json({
      message: channel_id ? '대표 카드가 설정되었습니다.' : '대표 카드가 해제되었습니다.',
      representative_card_channel_id: channel_id || null,
      representative_card_star: star
    });
  } catch (err: any) {
    console.error('[PlayController] setRepresentativeCard 에러:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '대표 카드 설정에 실패했습니다.', details: IS_PRODUCTION ? undefined : err.message });
  }
};
