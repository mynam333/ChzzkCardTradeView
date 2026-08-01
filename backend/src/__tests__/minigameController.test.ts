import { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedRequest } from '../middlewares/admin';

vi.mock('../repositories', () => ({
  minigameRepository: {
    getTicketStatus: vi.fn(),
    updateTickets: vi.fn(),
    startSession: vi.fn(),
    expireSessions: vi.fn(),
    findSessionById: vi.fn(),
    findActiveStartedSession: vi.fn(),
    completeSession: vi.fn()
  },
  streamerRepository: {
    findAll: vi.fn(),
    findById: vi.fn()
  },
  userRepository: {
    findById: vi.fn()
  },
  systemConfigRepository: {
    get: vi.fn()
  }
}));

vi.mock('../services/puzzleImageExclusionService', () => {
  const normalizePuzzleImageKey = (rawUrl: string | null | undefined): string => {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return '';
    try {
      const parsed = new URL(trimmed, 'https://chikapo.local');
      const pathname = parsed.pathname.replace(/\/{2,}/g, '/');
      const lowerPath = pathname.toLowerCase();
      const uploadsIndex = lowerPath.indexOf('/uploads/');
      if (uploadsIndex >= 0) {
        return `uploads:${decodeURIComponent(lowerPath.slice(uploadsIndex + '/uploads/'.length))}`;
      }
      const host = parsed.hostname && parsed.hostname !== 'chikapo.local'
        ? `${parsed.hostname.toLowerCase()}:`
        : '';
      return `url:${host}${decodeURIComponent(lowerPath)}`;
    } catch {
      return `raw:${trimmed.split(/[?#]/, 1)[0].toLowerCase()}`;
    }
  };

  return {
    getPuzzleExcludedImageKeys: vi.fn(async () => new Set<string>()),
    normalizePuzzleImageKey
  };
});

import { abandonMinigameSession, checkMinigameRoundAnswer, getActiveMinigameSession, getCardImageUrl, getDailyMinigame, getMinigameStatus, startMinigame, submitMinigameResult } from '../controllers/minigameController';
import { minigameRepository, streamerRepository, systemConfigRepository, userRepository } from '../repositories';
import { getPuzzleExcludedImageKeys } from '../services/puzzleImageExclusionService';

const getTicketStatus = vi.mocked(minigameRepository.getTicketStatus);
const updateTickets = vi.mocked(minigameRepository.updateTickets);
const startSession = vi.mocked(minigameRepository.startSession);
const expireSessions = vi.mocked(minigameRepository.expireSessions);
const findSessionById = vi.mocked(minigameRepository.findSessionById);
const findActiveStartedSession = vi.mocked(minigameRepository.findActiveStartedSession);
const completeSession = vi.mocked(minigameRepository.completeSession);
const findAllStreamers = vi.mocked(streamerRepository.findAll);
const findUserById = vi.mocked(userRepository.findById);
const systemConfigGet = vi.mocked(systemConfigRepository.get);
const getExcludedPuzzleImageKeys = vi.mocked(getPuzzleExcludedImageKeys);

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const solvedPuzzlePieces = Array.from({ length: 12 }, (_, id) => ({ id, rotation: 0 }));
const solvedMatchChannelIds = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
const affectedRewardMinigameTypes = ['quiz', 'puzzle', 'match', 'value_duel', 'crop_detective'] as const;

const valueDuelRounds = Array.from({ length: 5 }, (_, round) => ({
  round,
  left: {
    channel_id: `left-${round}`,
    name: `왼쪽 ${round}`,
    image_url: `https://example.com/left-${round}.png`,
    star: 0,
    base_value: 1000 + round
  },
  right: {
    channel_id: `right-${round}`,
    name: `오른쪽 ${round}`,
    image_url: `https://example.com/right-${round}.png`,
    star: 0,
    base_value: 900 + round
  }
}));

const cropDetectiveRounds = Array.from({ length: 5 }, (_, round) => ({
  round,
  answer_channel_id: `answer-${round}`,
  source_image_url: `https://example.com/answer-${round}.png`,
  crop: { x: 0.5, y: 0.5, size: 0.15 },
  choices: [
    { channel_id: `answer-${round}`, name: `정답 ${round}`, image_url: `https://example.com/answer-${round}.png`, star: 0 },
    { channel_id: `wrong-a-${round}`, name: `오답 A ${round}`, image_url: `https://example.com/wrong-a-${round}.png`, star: 0 },
    { channel_id: `wrong-b-${round}`, name: `오답 B ${round}`, image_url: `https://example.com/wrong-b-${round}.png`, star: 0 },
    { channel_id: `wrong-c-${round}`, name: `오답 C ${round}`, image_url: `https://example.com/wrong-c-${round}.png`, star: 0 }
  ]
}));

const quizRounds = Array.from({ length: 5 }, (_, round) => ({
  round,
  answer_channel_id: `quiz-answer-${round}`,
  answer_name: `정답 ${round}`,
  image_url: `https://example.com/quiz-answer-${round}.png`,
  star: round % 6,
  choices: [
    { channel_id: `quiz-answer-${round}`, name: `정답 ${round}` },
    { channel_id: `quiz-wrong-${round}`, name: `오답 ${round}` }
  ]
}));

const getTestRotatedCropSafeMargins = (size: number, rotation: number) => {
  const radians = (rotation * Math.PI) / 180;
  const horizontalHalfExtent = (size * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)))) / 2;
  return {
    x: Math.min(0.48, horizontalHalfExtent + 0.025),
    y: Math.min(0.48, horizontalHalfExtent * (5 / 8) + 0.025)
  };
};

const createPlayableStreamers = (count = 6) =>
  Array.from({ length: count }, (_, index) => ({
    channel_id: `channel-${index}`,
    name: `streamer-${index}`,
    logo_url: `https://example.com/${index}.png`,
    custom_images: Array.from({ length: 6 }, (_, star) => `https://example.com/${index}-${star}.png`),
    base_value: 1000 + index
  }));

const runPuzzleSubmission = async (elapsedMs: number, practiceMode = false) => {
  findSessionById.mockResolvedValue({
    id: 'puzzle-session',
    user_id: 'user-1',
    game_type: 'puzzle',
    status: 'STARTED',
    target_data: JSON.stringify({
      practice_mode: practiceMode,
      correct_id: 'channel-answer',
      correct_name: '정답 스트리머',
      image_url: 'https://example.com/answer.png',
      star: 3
    }),
    created_at: new Date(Date.now() - elapsedMs).toISOString()
  });
  findUserById.mockResolvedValue({ point: 5000 } as never);
  completeSession.mockResolvedValue({ ok: true, newPoints: 5000 });

  const request = {
    user: { id: 'user-1' },
    body: {
      session_id: 'puzzle-session',
      payload: { success: true, puzzle_pieces: solvedPuzzlePieces }
    }
  } as AuthenticatedRequest;
  const response = createResponse();

  await submitMinigameResult(request, response);

  return response;
};

const runMatchSubmission = async (elapsedMs: number, practiceMode = false) => {
  findSessionById.mockResolvedValue({
    id: 'match-session',
    user_id: 'user-1',
    game_type: 'match',
    status: 'STARTED',
    target_data: JSON.stringify({ practice_mode: practiceMode, channel_ids: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }),
    created_at: new Date(Date.now() - elapsedMs).toISOString()
  });
  findUserById.mockResolvedValue({ point: 5000 } as never);
  completeSession.mockResolvedValue({ ok: true, newPoints: 5000 });

  const request = {
    user: { id: 'user-1' },
    body: {
      session_id: 'match-session',
      payload: { success: true, matched_channel_ids: solvedMatchChannelIds }
    }
  } as AuthenticatedRequest;
  const response = createResponse();

  await submitMinigameResult(request, response);

  return response;
};

describe('submitMinigameResult puzzle time limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T00:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails and closes the session when puzzle submission exceeds 125 seconds', async () => {
    const response = await runPuzzleSubmission(125001, true);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      correct: false,
      earned_points: 0,
      message: '연습 게임의 120초 시간 제한이 초과되었습니다. 연습 모드에서는 포인트가 지급되지 않습니다.',
      practice_mode: true,
      answer: expect.objectContaining({
        channel_id: 'channel-answer',
        name: '정답 스트리머',
        image_url: 'https://example.com/answer.png'
      })
    }));
  });

  it('accepts a solved puzzle within the server time allowance', async () => {
    const response = await runPuzzleSubmission(124999, true);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 0,
      practice_mode: true,
      answer: expect.objectContaining({
        name: '정답 스트리머',
        image_url: 'https://example.com/answer.png'
      })
    }));
  });

  it('parses timezone-less DB timestamp strings as KST', async () => {
    findSessionById.mockResolvedValue({
      id: 'puzzle-session',
      user_id: 'user-1',
      game_type: 'puzzle',
      status: 'STARTED',
      target_data: JSON.stringify({
        practice_mode: true,
        correct_id: 'channel-answer',
        correct_name: '정답 스트리머',
        image_url: 'https://example.com/answer.png',
        star: 3
      }),
      created_at: '2026-06-06 08:58:00'
    });
    findUserById.mockResolvedValue({ point: 5000 } as never);
    completeSession.mockResolvedValue({ ok: true, newPoints: 6000 });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'puzzle-session',
        payload: { success: true, puzzle_pieces: solvedPuzzlePieces }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 0);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 0,
      practice_mode: true
    }));
  });

  it('completes a successful practice puzzle without awarding points', async () => {
    const response = await runPuzzleSubmission(124999, true);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 0,
      practice_mode: true
    }));
  });

  it('rejects a bare success flag without a verifiable puzzle state', async () => {
    findSessionById.mockResolvedValue({
      id: 'puzzle-session',
      user_id: 'user-1',
      game_type: 'puzzle',
      status: 'STARTED',
      target_data: JSON.stringify({
        practice_mode: true,
        correct_id: 'channel-answer',
        correct_name: '정답 스트리머',
        image_url: 'https://example.com/answer.png',
        star: 3
      }),
      created_at: new Date(Date.now() - 5000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'puzzle-session',
        payload: { success: true }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });
});

describe('submitMinigameResult match time limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T00:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails and closes the session when match submission exceeds 37 seconds', async () => {
    const response = await runMatchSubmission(37001, true);

    expect(completeSession).toHaveBeenCalledWith('match-session', 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      correct: false,
      earned_points: 0,
      message: '연습 게임의 30초 시간 제한이 초과되었습니다. 연습 모드에서는 포인트가 지급되지 않습니다.',
      practice_mode: true
    }));
  });

  it('accepts a solved match game within the server time allowance', async () => {
    const response = await runMatchSubmission(36999, true);

    expect(completeSession).toHaveBeenCalledWith('match-session', 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 0,
      practice_mode: true
    }));
  });

  it('completes a successful practice match without awarding points', async () => {
    const response = await runMatchSubmission(36999, true);

    expect(completeSession).toHaveBeenCalledWith('match-session', 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 0,
      practice_mode: true
    }));
  });

  it('rejects a bare success flag without verifiable matched card ids', async () => {
    findSessionById.mockResolvedValue({
      id: 'match-session',
      user_id: 'user-1',
      game_type: 'match',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: true, channel_ids: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }),
      created_at: new Date(Date.now() - 7000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'match-session',
        payload: { success: true }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });
});

describe('round-based minigames', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T00:00:00.000Z'));
    vi.clearAllMocks();
    findUserById.mockResolvedValue({ point: 5000 } as never);
    completeSession.mockResolvedValue({ ok: true, newPoints: 6200 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(affectedRewardMinigameTypes)(
    'closes a legacy paid STARTED %s session with zero points before evaluating the submission',
    async (gameType) => {
      const sessionId = `legacy-paid-${gameType}`;
      findSessionById.mockResolvedValue({
        id: sessionId,
        user_id: 'user-1',
        game_type: gameType,
        status: 'STARTED',
        target_data: JSON.stringify({ practice_mode: false }),
        created_at: new Date(Date.now() - 20_000).toISOString()
      });

      const request = {
        user: { id: 'user-1' },
        body: { session_id: sessionId, payload: { success: true } }
      } as AuthenticatedRequest;
      const response = createResponse();

      await submitMinigameResult(request, response);

      expect(completeSession).toHaveBeenCalledWith(sessionId, 0);
      expect(findUserById).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(503);
      expect(response.json).toHaveBeenCalledWith({
        error: 'MinigameRewardsTemporarilyUnavailable',
        message: '서버 권위 검증이 준비될 때까지 보상형 미니게임을 일시적으로 이용할 수 없습니다. 연습 모드를 이용해 주세요.',
        practice_mode_available: true,
        session_closed: true,
        earned_points: 0
      });
    }
  );

  it.each([
    {
      gameType: 'quiz',
      sessionId: 'practice-quiz-session',
      rounds: quizRounds,
      answers: quizRounds.map((round) => ({ round: round.round, selected_channel_id: round.answer_channel_id }))
    },
    {
      gameType: 'value_duel',
      sessionId: 'practice-value-duel-session',
      rounds: valueDuelRounds,
      answers: valueDuelRounds.map((round) => ({ round: round.round, selected_channel_id: round.left.channel_id }))
    },
    {
      gameType: 'crop_detective',
      sessionId: 'practice-crop-session',
      rounds: cropDetectiveRounds,
      answers: cropDetectiveRounds.map((round) => ({ round: round.round, selected_channel_id: round.answer_channel_id }))
    }
  ] as const)('completes a successful practice $gameType game without awarding points', async ({ gameType, sessionId, rounds, answers }) => {
    findSessionById.mockResolvedValue({
      id: sessionId,
      user_id: 'user-1',
      game_type: gameType,
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: true, rounds }),
      created_at: new Date(Date.now() - 20_000).toISOString()
    });
    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: sessionId,
        payload: { answers, client_remaining_ms: 30_000 }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith(sessionId, 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 0,
      practice_mode: true
    }));
  });

  it('rejects round answers that are not one of the issued choices', async () => {
    findSessionById.mockResolvedValue({
      id: 'crop-session',
      user_id: 'user-1',
      game_type: 'crop_detective',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: true, rounds: cropDetectiveRounds }),
      created_at: new Date(Date.now() - 20_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'crop-session',
        payload: {
          answers: [{ round: 0, selected_channel_id: 'not-a-choice' }],
          client_remaining_ms: 30_000
        }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('returns immediate quiz round feedback without completing the session', async () => {
    findSessionById.mockResolvedValue({
      id: 'quiz-session',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: true, rounds: quizRounds }),
      created_at: new Date(Date.now() - 10_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'quiz-session',
        payload: { round: 0, selected_channel_id: 'quiz-answer-0' }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await checkMinigameRoundAnswer(request, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      correct_channel_ids: ['quiz-answer-0']
    }));
  });

  it('returns immediate round feedback without completing the session', async () => {
    findSessionById.mockResolvedValue({
      id: 'value-duel-session',
      user_id: 'user-1',
      game_type: 'value_duel',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: true, rounds: valueDuelRounds }),
      created_at: new Date(Date.now() - 10_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'value-duel-session',
        payload: { round: 0, selected_channel_id: 'left-0' }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await checkMinigameRoundAnswer(request, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      correct_channel_ids: ['left-0']
    }));
  });

  it.each([
    { gameType: 'quiz', rounds: quizRounds },
    { gameType: 'value_duel', rounds: valueDuelRounds },
    { gameType: 'crop_detective', rounds: cropDetectiveRounds }
  ] as const)(
    'closes a legacy paid $gameType session before returning a round-answer oracle',
    async ({ gameType, rounds }) => {
      const sessionId = `legacy-round-${gameType}`;
      findSessionById.mockResolvedValue({
        id: sessionId,
        user_id: 'user-1',
        game_type: gameType,
        status: 'STARTED',
        target_data: JSON.stringify({ practice_mode: false, rounds }),
        created_at: new Date(Date.now() - 10_000).toISOString()
      });
      const request = {
        user: { id: 'user-1' },
        body: {
          session_id: sessionId,
          payload: { round: 0, selected_channel_id: 'attacker-controlled-choice' }
        }
      } as AuthenticatedRequest;
      const response = createResponse();

      await checkMinigameRoundAnswer(request, response);

      expect(completeSession).toHaveBeenCalledWith(sessionId, 0);
      expect(response.status).toHaveBeenCalledWith(503);
      const body = vi.mocked(response.json).mock.calls[0][0] as Record<string, unknown>;
      expect(body).toEqual(expect.objectContaining({
        error: 'MinigameRewardsTemporarilyUnavailable',
        session_closed: true,
        earned_points: 0
      }));
      expect(body).not.toHaveProperty('correct');
      expect(body).not.toHaveProperty('correct_channel_ids');
    }
  );
});

describe('daily minigame selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    systemConfigGet.mockResolvedValue('240');
    expireSessions.mockResolvedValue(undefined);
    findActiveStartedSession.mockResolvedValue(null);
    getExcludedPuzzleImageKeys.mockResolvedValue(new Set());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('changes the KST date boundary at midnight and returns the exact next reset time', () => {
    const beforeMidnight = getDailyMinigame(new Date('2026-06-06T14:59:59.000Z').getTime());
    const afterMidnight = getDailyMinigame(new Date('2026-06-06T15:00:00.000Z').getTime());

    expect(beforeMidnight.kst_date).toBe('2026-06-06');
    expect(beforeMidnight.next_game_at).toBe('2026-06-06T15:00:00.000Z');
    expect(beforeMidnight.seconds_until_game_change).toBe(1);
    expect(afterMidnight.kst_date).toBe('2026-06-07');
    expect(afterMidnight.next_game_at).toBe('2026-06-07T15:00:00.000Z');
    expect(afterMidnight.seconds_until_game_change).toBe(86400);
  });

  it('uses the configured minigame ticket charge interval without resetting a charging user', async () => {
    vi.setSystemTime(new Date('2026-06-06T00:30:00.000Z'));
    systemConfigGet.mockResolvedValue('60');
    getTicketStatus.mockResolvedValue({
      user_id: 'user-1',
      current_tickets: 4,
      bonus_tickets: 0,
      last_charged_at: new Date('2026-06-06T00:00:00.000Z').toISOString()
    });
    const request = { user: { id: 'user-1' } } as AuthenticatedRequest;
    const response = createResponse();

    await getMinigameStatus(request, response);

    expect(systemConfigGet).toHaveBeenCalledWith('minigame_ticket_charge_interval_minutes', '240');
    expect(updateTickets).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      base_tickets: 4,
      seconds_until_next_ticket: 1800,
      ticket_charge_interval_minutes: 60
    }));
  });

  it.each(affectedRewardMinigameTypes)(
    'rejects paid %s starts before reading tickets or creating a session',
    async (gameType) => {
      const request = {
        user: { id: 'user-1' },
        body: { game_type: gameType, practice_mode: false }
      } as AuthenticatedRequest;
      const response = createResponse();

      await startMinigame(request, response);

      expect(response.status).toHaveBeenCalledWith(503);
      expect(response.json).toHaveBeenCalledWith({
        error: 'MinigameRewardsTemporarilyUnavailable',
        message: '서버 권위 검증이 준비될 때까지 보상형 미니게임을 일시적으로 이용할 수 없습니다. 연습 모드를 이용해 주세요.',
        practice_mode_available: true
      });
      expect(findActiveStartedSession).not.toHaveBeenCalled();
      expect(getTicketStatus).not.toHaveBeenCalled();
      expect(updateTickets).not.toHaveBeenCalled();
      expect(findAllStreamers).not.toHaveBeenCalled();
      expect(startSession).not.toHaveBeenCalled();
    }
  );

  it.each([
    { label: 'omitted', practiceMode: undefined },
    { label: 'string true', practiceMode: 'true' },
    { label: 'numeric true', practiceMode: 1 }
  ])('does not treat $label practice_mode as the zero-reward mode', async ({ practiceMode }) => {
    const request = {
      user: { id: 'user-1' },
      body: {
        game_type: 'quiz',
        ...(practiceMode === undefined ? {} : { practice_mode: practiceMode })
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(startSession).not.toHaveBeenCalled();
  });

  it.each(affectedRewardMinigameTypes)('starts %s in practice mode without reading or spending tickets', async (gameType) => {
    vi.setSystemTime(new Date('2026-06-06T03:00:00.000Z'));
    findAllStreamers.mockResolvedValue(createPlayableStreamers() as never);
    startSession.mockResolvedValue({ ok: true });
    const request = {
      user: { id: 'user-1' },
      body: { game_type: gameType, practice_mode: true }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      game_type: gameType,
      practice_mode: true
    }));
    expect(getTicketStatus).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({
      target_data: expect.stringContaining('"practice_mode":true')
    }));
  });

  it('issues quiz as five two-choice rounds without exposing answers', async () => {
    findAllStreamers.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        channel_id: `channel-${index}`,
        name: `streamer-${index}`,
        logo_url: `https://example.com/${index}.png`
      })) as never
    );
    startSession.mockResolvedValue({ ok: true });
    const request = {
      user: { id: 'user-1' },
      body: { game_type: 'quiz', practice_mode: true }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    const responseBody = vi.mocked(response.json).mock.calls[0][0] as any;
    expect(responseBody.game_data.rounds).toHaveLength(5);
    for (const round of responseBody.game_data.rounds) {
      expect(round.choices).toHaveLength(2);
      expect(round.image_url).toMatch(/^https:\/\/example\.com\/\d+\.png$/);
      expect(round).not.toHaveProperty('answer_channel_id');
      expect(round).not.toHaveProperty('star');
    }
  });

  it('closes a legacy paid crop detective session instead of resuming it', async () => {
    vi.setSystemTime(new Date('2026-06-12T03:00:00.000Z'));
    completeSession.mockResolvedValue({ ok: true, newPoints: 5000 });
    findActiveStartedSession.mockResolvedValue({
      id: 'crop-active-session',
      user_id: 'user-1',
      game_type: 'crop_detective',
      status: 'STARTED',
      ticket_spent_type: 'BASE',
      target_data: JSON.stringify({ practice_mode: false, rounds: cropDetectiveRounds }),
      created_at: new Date(Date.now() - 15_000).toISOString()
    });
    const request = {
      user: { id: 'user-1' },
      query: { game_type: 'crop_detective' }
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await getActiveMinigameSession(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(completeSession).toHaveBeenCalledWith('crop-active-session', 0);
    expect(response.json).toHaveBeenCalledWith({
      active_session: null,
      rewards_temporarily_unavailable: true,
      practice_mode_available: true
    });
  });

  it('does not resume an expired crop detective session', async () => {
    vi.setSystemTime(new Date('2026-06-12T03:00:00.000Z'));
    findActiveStartedSession.mockResolvedValue({
      id: 'expired-crop-session',
      user_id: 'user-1',
      game_type: 'crop_detective',
      status: 'STARTED',
      ticket_spent_type: 'BASE',
      target_data: JSON.stringify({ practice_mode: true, rounds: cropDetectiveRounds }),
      created_at: new Date(Date.now() - 4 * 60_000).toISOString()
    });
    const request = {
      user: { id: 'user-1' },
      query: { game_type: 'crop_detective' }
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await getActiveMinigameSession(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ active_session: null });
    expect(expireSessions).toHaveBeenCalledWith(3, 50);
  });

  it('does not resume inside the cleanup boundary even when preplay timing still has milliseconds left', async () => {
    vi.setSystemTime(new Date('2026-06-12T03:00:00.000Z'));
    findActiveStartedSession.mockResolvedValue({
      id: 'cleanup-boundary-crop-session',
      user_id: 'user-1',
      game_type: 'crop_detective',
      status: 'STARTED',
      ticket_spent_type: 'BASE',
      target_data: JSON.stringify({ practice_mode: true, rounds: cropDetectiveRounds }),
      created_at: new Date(Date.now() - 181_000).toISOString()
    });
    const request = {
      user: { id: 'user-1' },
      query: { game_type: 'crop_detective' }
    } as unknown as AuthenticatedRequest;
    const response = createResponse();

    await getActiveMinigameSession(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ active_session: null });
    expect(expireSessions).toHaveBeenCalledWith(3, 50);
  });

  it('closes an explicitly abandoned session without starting or charging another game', async () => {
    findSessionById.mockResolvedValue({
      id: 'crop-abandon-session',
      user_id: 'user-1',
      game_type: 'crop_detective',
      status: 'STARTED',
      ticket_spent_type: 'BASE',
      target_data: JSON.stringify({ practice_mode: false, rounds: cropDetectiveRounds }),
      created_at: new Date().toISOString()
    });
    completeSession.mockResolvedValue({ ok: true, newPoints: 5000 });
    const request = {
      user: { id: 'user-1' },
      body: { session_id: 'crop-abandon-session' }
    } as AuthenticatedRequest;
    const response = createResponse();

    await abandonMinigameSession(request, response);

    expect(completeSession).toHaveBeenCalledWith('crop-abandon-session', 0);
    expect(startSession).not.toHaveBeenCalled();
    expect(getTicketStatus).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      abandoned: true
    }));
  });

  it('keeps the puzzle answer private until the game is submitted', async () => {
    findAllStreamers.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        channel_id: `channel-${index}`,
        name: `streamer-${index}`,
        logo_url: `https://example.com/${index}.png`
      })) as never
    );
    startSession.mockResolvedValue({ ok: true });
    const request = {
      user: { id: 'user-1' },
      body: { game_type: 'puzzle', practice_mode: true }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    const responseBody = vi.mocked(response.json).mock.calls[0][0] as any;
    expect(responseBody.game_data).toEqual({
      image_url: expect.stringMatching(/^https:\/\/example\.com\/\d+\.png$/)
    });
    expect(responseBody.game_data).not.toHaveProperty('name');

    const session = startSession.mock.calls[0][0];
    const target = JSON.parse(session.target_data);
    expect(target).toEqual(expect.objectContaining({
      correct_id: expect.stringMatching(/^channel-\d+$/),
      correct_name: expect.stringMatching(/^streamer-\d+$/),
      image_url: expect.stringMatching(/^https:\/\/example\.com\/\d+\.png$/)
    }));
  });

  it('uses the same lower-star image fallback as card rendering', () => {
    const streamer = {
      logo_url: 'https://example.com/logo.png',
      custom_image_url: null,
      custom_images: [
        null,
        'https://example.com/star-1.png',
        null,
        'https://example.com/star-3.png',
        null,
        null
      ]
    };

    expect(getCardImageUrl(streamer, 5)).toBe('https://example.com/star-3.png');
    expect(getCardImageUrl(streamer, 2)).toBe('https://example.com/star-1.png');
    expect(getCardImageUrl(streamer, 0)).toBe('https://example.com/logo.png');
  });

  it('issues crop detective rounds inside the 5:8 card viewport with doubled zoom and rotation data', async () => {
    vi.setSystemTime(new Date('2030-07-01T03:00:00.000Z'));
    findAllStreamers.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        channel_id: `channel-${index}`,
        name: `streamer-${index}`,
        logo_url: `https://example.com/${index}-logo.png`,
        custom_images: Array.from({ length: 6 }, (_, star) => `https://example.com/${index}-${star}.png`)
      })) as never
    );
    startSession.mockResolvedValue({ ok: true });
    const request = {
      user: { id: 'user-1' },
      body: { game_type: 'crop_detective', practice_mode: true }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    const responseBody = vi.mocked(response.json).mock.calls[0][0] as any;
    expect(responseBody.game_data.rounds).toHaveLength(5);
    for (const round of responseBody.game_data.rounds) {
      expect(round.crop.size).toBeGreaterThanOrEqual(0.05);
      expect(round.crop.size).toBeLessThanOrEqual(0.10);
      expect(round.crop.rotation).toBeGreaterThanOrEqual(0);
      expect(round.crop.rotation).toBeLessThan(360);
      const safeMargins = getTestRotatedCropSafeMargins(round.crop.size, round.crop.rotation);
      expect(round.crop.x).toBeGreaterThanOrEqual(safeMargins.x - 0.001);
      expect(round.crop.x).toBeLessThanOrEqual(1 - safeMargins.x + 0.001);
      expect(round.crop.y).toBeGreaterThanOrEqual(safeMargins.y - 0.001);
      expect(round.crop.y).toBeLessThanOrEqual(1 - safeMargins.y + 0.001);
      expect(round.source_image_url).toMatch(/^https:\/\/example\.com\/\d+-\d\.png$/);
      expect(round.source_fallback_image_url).toMatch(/^https:\/\/example\.com\/\d+-logo\.png$/);
      expect(round.choices).toHaveLength(4);
    }

    const session = startSession.mock.calls[0][0];
    const target = JSON.parse(session.target_data);
    expect(target.rounds[0].crop).toEqual(expect.objectContaining({
      x: expect.any(Number),
      y: expect.any(Number),
      size: expect.any(Number),
      rotation: expect.any(Number)
    }));
    for (const targetRound of target.rounds) {
      const publicRound = responseBody.game_data.rounds.find(
        (round: any) => round.round === targetRound.round
      );
      const answerChoice = targetRound.choices.find(
        (choice: any) => choice.channel_id === targetRound.answer_channel_id
      );
      expect(answerChoice).toBeDefined();
      expect(targetRound.source_image_url).toBe(answerChoice.image_url);
      expect(targetRound.source_fallback_image_url).toBe(answerChoice.fallback_image_url);
      expect(publicRound.source_image_url).toBe(targetRound.source_image_url);
      expect(publicRound.source_fallback_image_url).toBe(targetRound.source_fallback_image_url);
      expect(publicRound.choices).toContainEqual(answerChoice);
    }
  });
});
