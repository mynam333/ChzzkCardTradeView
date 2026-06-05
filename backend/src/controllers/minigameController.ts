import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import crypto from 'crypto';
import { minigameRepository, streamerRepository, userRepository } from '../repositories';
import { UserMinigameTicket, MinigameSession } from '../repositories/interfaces';

const TICKET_CHARGE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4시간
const MAX_TICKETS = 5;

// 티켓 계산 및 갱신 헬퍼
function refreshUserTickets(ticket: UserMinigameTicket): { current_tickets: number; last_charged_at: string; seconds_until_next_ticket: number } {
  let { current_tickets, last_charged_at } = ticket;
  const now = Date.now();
  const lastChargedMs = new Date(last_charged_at).getTime();

  if (current_tickets >= MAX_TICKETS) {
    return {
      current_tickets: MAX_TICKETS,
      last_charged_at: new Date(now).toISOString(),
      seconds_until_next_ticket: TICKET_CHARGE_INTERVAL_MS / 1000
    };
  }

  const elapsedMs = now - lastChargedMs;
  if (elapsedMs >= TICKET_CHARGE_INTERVAL_MS) {
    const chargedCount = Math.floor(elapsedMs / TICKET_CHARGE_INTERVAL_MS);
    current_tickets = Math.min(MAX_TICKETS, current_tickets + chargedCount);

    const newChargedMs = current_tickets === MAX_TICKETS
      ? now
      : lastChargedMs + chargedCount * TICKET_CHARGE_INTERVAL_MS;

    last_charged_at = new Date(newChargedMs).toISOString();
  }

  const nextChargeTime = new Date(last_charged_at).getTime() + TICKET_CHARGE_INTERVAL_MS;
  const seconds_until_next_ticket = current_tickets >= MAX_TICKETS
    ? TICKET_CHARGE_INTERVAL_MS / 1000
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

// 1. GET /api/minigames/status
export const getMinigameStatus = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  try {
    const dbTicket = await minigameRepository.getTicketStatus(userId);
    const refreshed = refreshUserTickets(dbTicket);

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
      last_charged_at: refreshed.last_charged_at
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

  const { game_type } = req.body;
  if (!['quiz', 'puzzle', 'match'].includes(game_type)) {
    return res.status(400).json({ error: 'BadRequest', message: '유효하지 않은 게임 타입입니다.' });
  }

  try {
    // 1. 티켓 정보 조회 및 dynamic 충전 반영
    const dbTicket = await minigameRepository.getTicketStatus(userId);
    const refreshed = refreshUserTickets(dbTicket);

    if (refreshed.current_tickets + dbTicket.bonus_tickets <= 0) {
      return res.status(403).json({ error: 'Forbidden', message: '사용 가능한 미니게임 티켓이 부족합니다.' });
    }

    await minigameRepository.updateTickets(userId, refreshed.current_tickets, refreshed.last_charged_at);

    // 2. 문제 은행 데이터 가져오기
    const streamers = await streamerRepository.findAll();
    if (streamers.length < 4) {
      return res.status(400).json({ error: 'BadRequest', message: '등록된 스트리머가 부족하여 미니게임을 시작할 수 없습니다. (최소 4명 필요)' });
    }

    const sessionId = crypto.randomUUID();
    let gameData: any = {};
    let targetData: any = {};

    if (game_type === 'quiz') {
      const shuffled = [...streamers].sort(() => 0.5 - Math.random());
      const correctStreamer = shuffled[0];
      const star = Math.floor(Math.random() * 6); // 0 ~ 5성

      const choices = shuffled.slice(0, 4).map(s => ({
        channel_id: s.channel_id,
        name: s.name
      })).sort(() => 0.5 - Math.random()); // 보기 섞기

      targetData = {
        correct_id: correctStreamer.channel_id,
        star: star
      };

      gameData = {
        image_url: getCardImageUrl(correctStreamer, star),
        choices
      };

    } else if (game_type === 'puzzle') {
      // 카드 퍼즐: 가로 3칸 세로 4칸 (정사각형 조각)
      const correctStreamer = streamers[Math.floor(Math.random() * streamers.length)];
      const star = Math.floor(Math.random() * 6);

      targetData = {
        correct_id: correctStreamer.channel_id,
        star: star
      };

      gameData = {
        image_url: getCardImageUrl(correctStreamer, star)
      };

    } else if (game_type === 'match') {
      // 카드 뒤집기: 6명 선정 (12장)
      const shuffled = [...streamers].sort(() => 0.5 - Math.random()).slice(0, 6);

      targetData = {
        channel_ids: shuffled.map(s => s.channel_id)
      };

      gameData = {
        cards: shuffled.map(s => ({
          channel_id: s.channel_id,
          name: s.name,
          logo_url: s.logo_url
        }))
      };
    }

    const newSession: MinigameSession = {
      id: sessionId,
      user_id: userId,
      game_type: game_type as any,
      status: 'STARTED',
      target_data: JSON.stringify(targetData)
    };

    const startResult = await minigameRepository.startSession(newSession);
    if (!startResult.ok) {
      return res.status(500).json({ error: 'InternalServerError', message: startResult.reason || '게임 세션 시작에 실패했습니다.' });
    }

    minigameRepository.expireSessions(60).catch(() => { });

    return res.status(200).json({
      session_id: sessionId,
      game_type,
      game_data: gameData
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
    if (session.status !== 'STARTED') {
      return res.status(400).json({ error: 'BadRequest', message: '이미 처리되었거나 만료된 세션입니다.' });
    }

    // 서버 사이드 시간 경과 체크 (치팅 패킷 변조 차단)
    const sessionCreatedMs = new Date(session.created_at || '').getTime();
    const serverElapsedMs = Date.now() - sessionCreatedMs;

    const target = JSON.parse(session.target_data);
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
          message: '15초 시간 제한이 초과되어 실패 처리되었습니다.'
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

      // 퍼즐 4.5초 컷은 패킷 치팅 의심 (카운트다운 3초 + 1.5초 조작)
      if (serverElapsedMs < 4500) {
        return res.status(400).json({ error: 'BadRequest', message: '비정상적인 접근이 감지되었습니다. (치팅 의심)' });
      }

      if (success === true) {
        isCorrect = true;
        earnedPoints = BASE_REWARD;

        // 20초(카운트다운 3초 + 20초 플레이 + RTT 1초 = 24000ms) 내 퍼즐 완성 시 보너스 200 P
        if (serverElapsedMs <= 24000) {
          earnedPoints += BONUS_REWARD;
          message = `20초 내로 퍼즐을 완성하셨습니다! 보너스 ${BONUS_REWARD} P를 포함하여 총 ${earnedPoints} P 획득!`;
        } else {
          message = `퍼즐을 무사히 완성하셨습니다! 기본 성공 포인트 ${earnedPoints} P 획득!`;
        }
      }

    } else if (session.game_type === 'match') {
      const { success } = payload || {};

      // 60초 시간 제한 초과 검증 (카운트다운 3초 + 60초 + 2초 딜레이 = 65000ms 초과 시 실패)
      if (serverElapsedMs > 65000) {
        await minigameRepository.completeSession(session_id, 0);
        const user = await userRepository.findById(userId);
        return res.status(200).json({
          success: false,
          correct: false,
          earned_points: 0,
          new_balance: user?.point ?? 0,
          message: '60초 시간 제한이 초과되어 실패 처리되었습니다.'
        });
      }

      // 카드 뒤집기 최소 물리 시간 검증 (카운트다운 3초 + 2초 노출 + 최소 1.5초 조작 = 6500ms 미만 차단)
      if (serverElapsedMs < 6500) {
        return res.status(400).json({ error: 'BadRequest', message: '비정상적인 접근이 감지되었습니다. (치팅 의심)' });
      }

      if (success === true) {
        isCorrect = true;
        earnedPoints = BASE_REWARD;

        // 15초(카운트다운 3초 + 2초 노출 + 15초 플레이 = 20000ms) 내 완료 시 보너스 200 P
        if (serverElapsedMs <= 20000) {
          earnedPoints += BONUS_REWARD;
          message = `15초 내에 짝을 맞추셨습니다! 보너스 ${BONUS_REWARD} P를 포함하여 총 ${earnedPoints} P 획득!`;
        } else {
          message = `모든 카드의 짝을 찾으셨습니다! 기본 성공 포인트 ${earnedPoints} P 획득!`;
        }
      }
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
      message
    });

  } catch (err: any) {
    console.error('[MinigameController] submit error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: '게임 결과 제출 중 오류가 발생했습니다.' });
  }
};
