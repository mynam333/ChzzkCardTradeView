import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import crypto from 'crypto';
import { minigameRepository, streamerRepository, systemConfigRepository, userRepository } from '../repositories';
import { UserMinigameTicket, MinigameSession } from '../repositories/interfaces';

const DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES = 240; // 4시간
const MAX_TICKETS = 5;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAILY_MINIGAMES = ['quiz', 'puzzle', 'match'] as const;
const COUNTDOWN_MS = 3_000;
const SUBMISSION_GRACE_MS = 2_000;
const CLIENT_REPORTED_GRACE_MS = 8_000;
const PUZZLE_TIME_LIMIT_MS = 120_000;
const MATCH_REVEAL_MS = 2_000;
const MATCH_TIME_LIMIT_MS = 30_000;
const STARTED_SESSION_RECOVERY_MINUTES = 3;

type DailyMinigameType = typeof DAILY_MINIGAMES[number];

const formatKstDbTime = (dateMs = Date.now()): string => {
  const kst = new Date(dateMs + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}-${String(kst.getUTCDate()).padStart(2, '0')} ${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')}`;
};

const parseDbKstTimeMs = (value: string | undefined | null): number => {
  if (!value) return NaN;
  const trimmed = String(value).trim();
  if (!trimmed) return NaN;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) return new Date(trimmed).getTime();
  const kst = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (kst) {
    const ms = kst[7] ? Number(kst[7].padEnd(3, '0').slice(0, 3)) : 0;
    return Date.UTC(Number(kst[1]), Number(kst[2]) - 1, Number(kst[3]), Number(kst[4]), Number(kst[5]), Number(kst[6]), ms) - KST_OFFSET_MS;
  }
  return new Date(trimmed).getTime();
};

const getGamePreplayMs = (gameType: DailyMinigameType): number => {
  if (gameType === 'match') return COUNTDOWN_MS + MATCH_REVEAL_MS;
  return COUNTDOWN_MS;
};

const getGamePlayLimitMs = (gameType: DailyMinigameType): number => {
  if (gameType === 'quiz') return 15_000;
  if (gameType === 'puzzle') return PUZZLE_TIME_LIMIT_MS;
  return MATCH_TIME_LIMIT_MS;
};

const getGameSubmitAllowanceMs = (gameType: DailyMinigameType): number => {
  if (gameType === 'quiz') return 20_000;
  return getGamePreplayMs(gameType) + getGamePlayLimitMs(gameType) + SUBMISSION_GRACE_MS;
};

const getSessionTiming = (session: Pick<MinigameSession, 'game_type' | 'created_at'>) => {
  const nowMs = Date.now();
  const createdMs = parseDbKstTimeMs(session.created_at);
  const elapsedMs = Number.isFinite(createdMs) ? Math.max(0, nowMs - createdMs) : 0;
  const preplayMs = getGamePreplayMs(session.game_type);
  const playLimitMs = getGamePlayLimitMs(session.game_type);
  const playElapsedMs = Math.max(0, elapsedMs - preplayMs);
  const timeRemainingMs = Math.max(0, playLimitMs - playElapsedMs);

  return {
    server_now: new Date(nowMs).toISOString(),
    session_started_at: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : null,
    session_started_at_kst: Number.isFinite(createdMs) ? formatKstDbTime(createdMs) : null,
    server_elapsed_ms: elapsedMs,
    preplay_ms: preplayMs,
    time_limit_ms: playLimitMs,
    time_remaining_ms: timeRemainingMs,
    submit_allowance_ms: getGameSubmitAllowanceMs(session.game_type)
  };
};

async function getTicketChargeIntervalMinutes(): Promise<number> {
  const value = await systemConfigRepository.get(
    'minigame_ticket_charge_interval_minutes',
    String(DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES)
  );
  const minutes = parseInt(value, 10);
  return Number.isFinite(minutes) && minutes >= 1 ? minutes : DEFAULT_TICKET_CHARGE_INTERVAL_MINUTES;
}

export function getDailyMinigame(nowMs = Date.now()): {
  game_type: DailyMinigameType;
  kst_date: string;
  next_game_at: string;
  seconds_until_game_change: number;
} {
  const kstNow = new Date(nowMs + KST_OFFSET_MS);
  const year = kstNow.getUTCFullYear();
  const month = kstNow.getUTCMonth();
  const date = kstNow.getUTCDate();
  const kstDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  const nextMidnightUtcMs = Date.UTC(year, month, date + 1) - KST_OFFSET_MS;
  const digest = crypto.createHash('sha256').update(`chikapo-daily-minigame:${kstDate}`).digest();
  const gameType = DAILY_MINIGAMES[digest.readUInt32BE(0) % DAILY_MINIGAMES.length];

  return {
    game_type: gameType,
    kst_date: kstDate,
    next_game_at: new Date(nextMidnightUtcMs).toISOString(),
    seconds_until_game_change: Math.max(0, Math.ceil((nextMidnightUtcMs - nowMs) / 1000))
  };
}

// 티켓 계산 및 갱신 헬퍼
function refreshUserTickets(
  ticket: UserMinigameTicket,
  chargeIntervalMinutes: number
): { current_tickets: number; last_charged_at: string; seconds_until_next_ticket: number } {
  let { current_tickets, last_charged_at } = ticket;
  const now = Date.now();
  const intervalMs = Math.max(1, chargeIntervalMinutes) * 60 * 1000;
  let lastChargedMs = new Date(last_charged_at).getTime();
  if (!Number.isFinite(lastChargedMs) || lastChargedMs > now) {
    lastChargedMs = now;
    last_charged_at = new Date(now).toISOString();
  }

  if (current_tickets >= MAX_TICKETS) {
    return {
      current_tickets: MAX_TICKETS,
      last_charged_at: new Date(now).toISOString(),
      seconds_until_next_ticket: intervalMs / 1000
    };
  }

  const elapsedMs = now - lastChargedMs;
  if (elapsedMs >= intervalMs) {
    const chargedCount = Math.floor(elapsedMs / intervalMs);
    current_tickets = Math.min(MAX_TICKETS, current_tickets + chargedCount);

    const newChargedMs = current_tickets === MAX_TICKETS
      ? now
      : lastChargedMs + chargedCount * intervalMs;

    last_charged_at = new Date(newChargedMs).toISOString();
  }

  const nextChargeTime = new Date(last_charged_at).getTime() + intervalMs;
  const seconds_until_next_ticket = current_tickets >= MAX_TICKETS
    ? intervalMs / 1000
    : Math.max(0, Math.ceil((nextChargeTime - now) / 1000));

  return {
    current_tickets,
    last_charged_at,
    seconds_until_next_ticket
  };
}

// 스트리머 카드 이미지 경로 결정 함수 (프론트와 동치)
function getCardImageUrl(streamer: any, star: number): string {
  const images = streamer.custom_images || [];
  if (star > 0 && images[star]) {
    return images[star];
  }
  if (streamer.custom_image_url) {
    return streamer.custom_image_url;
  }
  return streamer.logo_url || '';
}

type MinigameAnswerReveal = {
  channel_id: string;
  name: string;
  image_url: string;
  star: number;
};

async function getAnswerReveal(
  gameType: string,
  target: any
): Promise<MinigameAnswerReveal | undefined> {
  if (!['quiz', 'puzzle'].includes(gameType) || !target.correct_id) return undefined;

  if (target.correct_name && target.image_url) {
    return {
      channel_id: target.correct_id,
      name: target.correct_name,
      image_url: target.image_url,
      star: Number(target.star) || 0
    };
  }

  const streamer = await streamerRepository.findById(target.correct_id);
  if (!streamer) return undefined;

  return {
    channel_id: streamer.channel_id,
    name: streamer.name,
    image_url: getCardImageUrl(streamer, Number(target.star) || 0),
    star: Number(target.star) || 0
  };
}

async function buildRecoverableGameData(
  gameType: DailyMinigameType,
  target: any
): Promise<any | null> {
  if (target?.practice_mode === true) return null;

  if (gameType === 'quiz') {
    if (!target?.image_url || !Array.isArray(target?.choices) || target.choices.length < 4) return null;
    return {
      image_url: target.image_url,
      choices: target.choices.map((choice: any) => ({
        channel_id: choice.channel_id,
        name: choice.name
      }))
    };
  }

  if (gameType === 'puzzle') {
    if (!target?.image_url) return null;
    return { image_url: target.image_url };
  }

  if (gameType === 'match') {
    if (Array.isArray(target?.cards) && target.cards.length >= 2) {
      return {
        cards: target.cards.map((card: any) => ({
          channel_id: card.channel_id,
          name: card.name,
          logo_url: card.logo_url
        }))
      };
    }

    if (!Array.isArray(target?.channel_ids) || target.channel_ids.length < 2) return null;
    const streamers = await streamerRepository.findByIds(target.channel_ids);
    if (streamers.length < 2) return null;
    const byId = new Map(streamers.map((streamer: any) => [streamer.channel_id, streamer]));
    return {
      cards: target.channel_ids
        .map((channelId: string) => byId.get(channelId))
        .filter(Boolean)
        .map((streamer: any) => ({
          channel_id: streamer.channel_id,
          name: streamer.name,
          logo_url: streamer.logo_url
        }))
    };
  }

  return null;
}

// 1. GET /api/minigames/status
export const getMinigameStatus = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  try {
    const chargeIntervalMinutes = await getTicketChargeIntervalMinutes();
    const dbTicket = await minigameRepository.getTicketStatus(userId);
    const refreshed = refreshUserTickets(dbTicket, chargeIntervalMinutes);
    const dailyMinigame = getDailyMinigame();

    // 충전으로 인해 티켓이 늘어난 경우 DB 업데이트
    if (refreshed.current_tickets !== dbTicket.current_tickets || refreshed.last_charged_at !== dbTicket.last_charged_at) {
      await minigameRepository.updateTickets(userId, refreshed.current_tickets, refreshed.last_charged_at);
    }

    return res.status(200).json({
      current_tickets: refreshed.current_tickets + dbTicket.bonus_tickets,
      base_tickets: refreshed.current_tickets,
      bonus_tickets: dbTicket.bonus_tickets,
      max_tickets: MAX_TICKETS,
      seconds_until_next_ticket: refreshed.seconds_until_next_ticket,
      ticket_charge_interval_minutes: chargeIntervalMinutes,
      last_charged_at: refreshed.last_charged_at,
      today_game: dailyMinigame.game_type,
      kst_date: dailyMinigame.kst_date,
      next_game_at: dailyMinigame.next_game_at,
      seconds_until_game_change: dailyMinigame.seconds_until_game_change
    });
  } catch (err: any) {
    console.error('[MinigameController] status error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '티켓 상태 조회에 실패했습니다.' });
  }
};

// 2. POST /api/minigames/start
export const startMinigame = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const { game_type, practice_mode } = req.body;
  const practiceMode = practice_mode === true;
  if (!['quiz', 'puzzle', 'match'].includes(game_type)) {
    return res.status(400).json({ error: 'BadRequest', message: '유효하지 않은 게임 타입입니다.' });
  }

  // 연습 모드 한정 테스트용 강제 지정: 특정 스트리머(channel)와 특정 별(0~5성) 이미지를 사용합니다.
  // (일반 게임에서는 무시 — 무작위성/공정성을 해치지 않도록 연습 모드에서만 적용)
  const forceChannelId = practiceMode && typeof req.body.force_channel_id === 'string'
    ? req.body.force_channel_id.trim()
    : '';
  const forceStar = practiceMode
    && req.body.force_star !== undefined && req.body.force_star !== null && req.body.force_star !== ''
    && Number.isFinite(Number(req.body.force_star))
    ? Math.max(0, Math.min(5, Math.floor(Number(req.body.force_star))))
    : null;

  try {
    const dailyMinigame = getDailyMinigame();
    if (!practiceMode && game_type !== dailyMinigame.game_type) {
      return res.status(409).json({
        error: 'DailyMinigameChanged',
        message: '오늘 플레이할 수 있는 미니게임이 변경되었습니다. 오늘의 미니게임을 다시 확인해 주세요.',
        today_game: dailyMinigame.game_type,
        kst_date: dailyMinigame.kst_date,
        next_game_at: dailyMinigame.next_game_at
      });
    }

    if (!practiceMode) {
      await minigameRepository.expireSessions(STARTED_SESSION_RECOVERY_MINUTES).catch((err) => {
        console.warn('[MinigameController] stale session cleanup failed:', err);
      });

      const activeSession = await minigameRepository.findActiveStartedSession(userId, game_type as DailyMinigameType);
      if (activeSession) {
        let activeTarget: any = null;
        try {
          activeTarget = JSON.parse(activeSession.target_data || '{}');
        } catch {
          activeTarget = null;
        }

        const recoveredGameData = await buildRecoverableGameData(activeSession.game_type, activeTarget);
        if (recoveredGameData) {
          const timing = getSessionTiming(activeSession);
          if (timing.time_remaining_ms > 0 && timing.server_elapsed_ms <= timing.submit_allowance_ms + CLIENT_REPORTED_GRACE_MS) {
            return res.status(200).json({
              session_id: activeSession.id,
              game_type,
              practice_mode: false,
              resumed: true,
              message: '끊긴 미니게임 세션을 이어서 시작합니다.',
              game_data: recoveredGameData,
              timing
            });
          }

          await minigameRepository.completeSession(activeSession.id, 0).catch((err) => {
            console.warn('[MinigameController] expired active session close failed:', err);
          });
        }
      }

      // 일반 게임만 티켓 정보 조회 및 dynamic 충전을 반영합니다.
      const chargeIntervalMinutes = await getTicketChargeIntervalMinutes();
      const dbTicket = await minigameRepository.getTicketStatus(userId);
      const refreshed = refreshUserTickets(dbTicket, chargeIntervalMinutes);

      if (refreshed.current_tickets + dbTicket.bonus_tickets <= 0) {
        return res.status(403).json({ error: 'Forbidden', message: '사용 가능한 미니게임 티켓이 부족합니다.' });
      }

      await minigameRepository.updateTickets(userId, refreshed.current_tickets, refreshed.last_charged_at);
    }

    // 2. 문제 은행 데이터 가져오기
    const streamers = await streamerRepository.findAll();
    if (streamers.length < 4) {
      return res.status(400).json({ error: 'BadRequest', message: '등록된 스트리머가 부족하여 미니게임을 시작할 수 없습니다. (최소 4명 필요)' });
    }

    // 연습 모드 강제 지정 스트리머 해석
    const forcedStreamer = forceChannelId ? streamers.find(s => s.channel_id === forceChannelId) : null;
    if (forceChannelId && !forcedStreamer) {
      return res.status(404).json({ error: 'NotFound', message: '지정한 스트리머(channel_id)를 찾을 수 없습니다.' });
    }

    const sessionId = crypto.randomUUID();
    let gameData: any = {};
    let targetData: any = {};

    if (game_type === 'quiz') {
      const correctStreamer = forcedStreamer || [...streamers].sort(() => 0.5 - Math.random())[0];
      const star = forceStar !== null ? forceStar : Math.floor(Math.random() * 6); // 0 ~ 5성
      const imageUrl = getCardImageUrl(correctStreamer, star);

      // 정답을 반드시 포함한 4지선다 (정답 + 서로 다른 오답 3)
      const distractors = streamers
        .filter(s => s.channel_id !== correctStreamer.channel_id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);
      const choices = [correctStreamer, ...distractors]
        .map(s => ({ channel_id: s.channel_id, name: s.name }))
        .sort(() => 0.5 - Math.random()); // 보기 섞기

      targetData = {
        correct_id: correctStreamer.channel_id,
        correct_name: correctStreamer.name,
        image_url: imageUrl,
        star: star,
        choices
      };

      gameData = {
        image_url: imageUrl,
        choices
      };

    } else if (game_type === 'puzzle') {
      // 카드 퍼즐: 가로 3칸 세로 4칸 (정사각형 조각)
      const correctStreamer = forcedStreamer || streamers[Math.floor(Math.random() * streamers.length)];
      const star = forceStar !== null ? forceStar : Math.floor(Math.random() * 6);
      const imageUrl = getCardImageUrl(correctStreamer, star);

      targetData = {
        correct_id: correctStreamer.channel_id,
        correct_name: correctStreamer.name,
        image_url: imageUrl,
        star: star
      };

      gameData = {
        image_url: imageUrl
      };

    } else if (game_type === 'match') {
      // 카드 뒤집기: 6명 선정 (12장). 강제 지정 스트리머가 있으면 반드시 포함.
      const pool = [...streamers].sort(() => 0.5 - Math.random());
      let chosen = pool.slice(0, 6);
      if (forcedStreamer && !chosen.some(s => s.channel_id === forcedStreamer.channel_id)) {
        chosen = [forcedStreamer, ...pool.filter(s => s.channel_id !== forcedStreamer.channel_id).slice(0, 5)];
      }

      targetData = {
        channel_ids: chosen.map(s => s.channel_id),
        cards: chosen.map(s => ({
          channel_id: s.channel_id,
          name: s.name,
          logo_url: s.logo_url
        }))
      };

      gameData = {
        cards: chosen.map(s => ({
          channel_id: s.channel_id,
          name: s.name,
          logo_url: s.logo_url
        }))
      };
    }

    targetData.practice_mode = practiceMode;

    const sessionStartedAt = formatKstDbTime();
    const newSession: MinigameSession = {
      id: sessionId,
      user_id: userId,
      game_type: game_type as any,
      status: 'STARTED',
      target_data: JSON.stringify(targetData),
      created_at: sessionStartedAt
    };

    const startResult = await minigameRepository.startSession(newSession);
    if (!startResult.ok) {
      return res.status(500).json({ error: 'InternalServerError', message: startResult.reason || '게임 세션 시작에 실패했습니다.' });
    }

    minigameRepository.expireSessions(STARTED_SESSION_RECOVERY_MINUTES).catch(() => { });

    return res.status(200).json({
      session_id: sessionId,
      game_type,
      practice_mode: practiceMode,
      game_data: gameData,
      timing: getSessionTiming({
        ...newSession,
        created_at: sessionStartedAt
      })
    });

  } catch (err: any) {
    console.error('[MinigameController] start error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '미니게임을 시작하지 못했습니다.' });
  }
};

// 3. POST /api/minigames/submit
export const submitMinigameResult = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const { session_id, payload } = req.body;
  if (!session_id) {
    return res.status(400).json({ error: 'BadRequest', message: '세션 ID가 누락되었습니다.' });
  }

  try {
    // 1. 세션 조회
    const session = await minigameRepository.findSessionById(session_id);
    if (!session) {
      return res.status(404).json({ error: 'NotFound', message: '유효하지 않은 미니게임 세션입니다.' });
    }
    if (session.user_id !== userId) {
      return res.status(403).json({ error: 'Forbidden', message: '잘못된 세션 소유권입니다.' });
    }
    const target = JSON.parse(session.target_data);
    const practiceMode = target.practice_mode === true;
    const answer = await getAnswerReveal(session.game_type, target);

    if (session.status === 'COMPLETED') {
      const user = await userRepository.findById(userId);
      const replayCorrect =
        session.game_type === 'quiz'
          ? payload?.answer_channel_id === target.correct_id
          : payload?.success === true;

      return res.status(200).json({
        success: true,
        correct: replayCorrect || (session.earned_points ?? 0) > 0,
        earned_points: session.earned_points ?? 0,
        new_balance: user?.point ?? 0,
        message: '이미 처리된 미니게임 결과를 다시 불러왔습니다.',
        practice_mode: practiceMode,
        answer
      });
    }
    if (session.status !== 'STARTED') {
      return res.status(400).json({ error: 'BadRequest', message: '이미 처리되었거나 만료된 세션입니다.' });
    }

    // 서버 사이드 시간 경과 체크 (치팅 패킷 변조 차단)
    const sessionCreatedMs = parseDbKstTimeMs(session.created_at);
    const serverElapsedMs = Number.isFinite(sessionCreatedMs) ? Math.max(0, Date.now() - sessionCreatedMs) : 0;
    const clientRemainingMs = Math.max(0, Math.floor(Number(payload?.client_remaining_ms || 0)));
    const exceededTimeLimit = (allowedMs: number) => {
      if (serverElapsedMs <= allowedMs + SUBMISSION_GRACE_MS) return false;
      return !(clientRemainingMs > 0 && serverElapsedMs <= allowedMs + CLIENT_REPORTED_GRACE_MS);
    };

    let isCorrect = false;
    let earnedPoints = 0;
    let message = '아쉽게도 정답이 아닙니다!';

    const BASE_REWARD = 1000;
    const BONUS_REWARD = 200;

    // 게임 타입별 채점 및 치팅 검증
    if (session.game_type === 'quiz') {
      const { answer_channel_id } = payload || {};

      // 15초 제한시간 초과 검증 (카운트다운 3초 + 15초 플레이 + RTT 2초 = 20000ms 초과 시 실패)
      if (serverElapsedMs > 20000) {
        await minigameRepository.completeSession(session_id, 0);
        const user = await userRepository.findById(userId);
        return res.status(200).json({
          success: false,
          correct: false,
          earned_points: 0,
          new_balance: user?.point ?? 0,
          message: practiceMode
            ? '연습 게임의 15초 시간 제한이 초과되었습니다. 연습 모드에서는 포인트가 지급되지 않습니다.'
            : '15초 시간 제한이 초과되어 실패 처리되었습니다.',
          practice_mode: practiceMode,
          answer
        });
      }

      // 초고속 자동 매칭 치팅 차단 (카운트다운 3초 감안하여 3300ms 미만 차단)
      if (serverElapsedMs < 3300) {
        return res.status(400).json({ error: 'BadRequest', message: '비정상적인 접근이 감지되었습니다. (치팅 의심)' });
      }

      if (answer_channel_id === target.correct_id) {
        isCorrect = true;
        earnedPoints = BASE_REWARD;

        // 3초(카운트다운 3초 + 3초 플레이 + RTT 0.5초 = 6500ms) 내 해결 시 보너스 200 P
        if (serverElapsedMs <= 6500) {
          earnedPoints += BONUS_REWARD;
          message = `3초 내로 정답을 맞추셨습니다! 보너스 ${BONUS_REWARD} P를 포함하여 총 ${earnedPoints} P 획득!`;
        } else {
          message = `정답입니다! 기본 성공 포인트 ${earnedPoints} P 획득!`;
        }
      }

    } else if (session.game_type === 'puzzle') {
      const { success } = payload || {};

      // 120초 시간 제한 초과 검증 (카운트다운 3초 + 120초 플레이 + RTT 2초 = 125000ms 초과 시 실패)
      if (exceededTimeLimit(COUNTDOWN_MS + PUZZLE_TIME_LIMIT_MS)) {
        await minigameRepository.completeSession(session_id, 0);
        const user = await userRepository.findById(userId);
        return res.status(200).json({
          success: false,
          correct: false,
          earned_points: 0,
          new_balance: user?.point ?? 0,
          message: practiceMode
            ? '연습 게임의 120초 시간 제한이 초과되었습니다. 연습 모드에서는 포인트가 지급되지 않습니다.'
            : '120초 시간 제한이 초과되어 실패 처리되었습니다.',
          practice_mode: practiceMode,
          answer
        });
      }

      // 퍼즐 4.5초 컷은 패킷 치팅 의심 (카운트다운 3초 + 1.5초 조작)
      if (serverElapsedMs < 4500) {
        return res.status(400).json({ error: 'BadRequest', message: '비정상적인 접근이 감지되었습니다. (치팅 의심)' });
      }

      if (success === true) {
        isCorrect = true;
        earnedPoints = BASE_REWARD;

        // 30초(카운트다운 3초 + 30초 플레이 + RTT 1초 = 34000ms) 내 퍼즐 완성 시 보너스 200 P
        if (serverElapsedMs <= 34000) {
          earnedPoints += BONUS_REWARD;
          message = `30초 내로 퍼즐을 완성하셨습니다! 보너스 ${BONUS_REWARD} P를 포함하여 총 ${earnedPoints} P 획득!`;
        } else {
          message = `퍼즐을 무사히 완성하셨습니다! 기본 성공 포인트 ${earnedPoints} P 획득!`;
        }
      } else {
        message = '120초 시간 제한이 초과되어 실패 처리되었습니다.';
      }

    } else if (session.game_type === 'match') {
      const { success } = payload || {};

      // 30초 시간 제한 초과 검증 (카운트다운 3초 + 2초 선공개 + 30초 플레이 + RTT 2초 = 37000ms 초과 시 실패)
      if (exceededTimeLimit(COUNTDOWN_MS + MATCH_REVEAL_MS + MATCH_TIME_LIMIT_MS)) {
        await minigameRepository.completeSession(session_id, 0);
        const user = await userRepository.findById(userId);
        return res.status(200).json({
          success: false,
          correct: false,
          earned_points: 0,
          new_balance: user?.point ?? 0,
          message: practiceMode
            ? '연습 게임의 30초 시간 제한이 초과되었습니다. 연습 모드에서는 포인트가 지급되지 않습니다.'
            : '30초 시간 제한이 초과되어 실패 처리되었습니다.',
          practice_mode: practiceMode
        });
      }

      // 카드 뒤집기 최소 물리 시간 검증 (카운트다운 3초 + 2초 노출 + 최소 1.5초 조작 = 6500ms 미만 차단)
      if (serverElapsedMs < 6500) {
        return res.status(400).json({ error: 'BadRequest', message: '비정상적인 접근이 감지되었습니다. (치팅 의심)' });
      }

      if (success === true) {
        isCorrect = true;
        earnedPoints = BASE_REWARD;

        // 10초(카운트다운 3초 + 2초 노출 + 10초 플레이 = 15000ms) 내 완료 시 보너스 200 P
        if (serverElapsedMs <= 15000) {
          earnedPoints += BONUS_REWARD;
          message = `10초 내에 짝을 맞추셨습니다! 보너스 ${BONUS_REWARD} P를 포함하여 총 ${earnedPoints} P 획득!`;
        } else {
          message = `모든 카드의 짝을 찾으셨습니다! 기본 성공 포인트 ${earnedPoints} P 획득!`;
        }
      }
    }

    if (practiceMode) {
      earnedPoints = 0;
      message = isCorrect
        ? '연습 게임을 성공했습니다! 연습 모드에서는 동전을 소모하지 않으며 포인트도 지급되지 않습니다.'
        : '연습 게임을 완료했습니다. 연습 모드에서는 동전을 소모하지 않으며 포인트도 지급되지 않습니다.';
    }

    // 2. 세션 완료 및 포인트 적립
    const completeResult = await minigameRepository.completeSession(session_id, earnedPoints);
    if (!completeResult.ok) {
      return res.status(500).json({ error: 'InternalServerError', message: completeResult.reason || '포인트 지급에 실패했습니다.' });
    }

    return res.status(200).json({
      success: true,
      correct: isCorrect,
      earned_points: earnedPoints,
      new_balance: completeResult.newPoints ?? 0,
      message,
      practice_mode: practiceMode,
      answer
    });

  } catch (err: any) {
    console.error('[MinigameController] submit error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '게임 결과 제출 중 오류가 발생했습니다.' });
  }
};
