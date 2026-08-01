import { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedRequest } from '../middlewares/admin';

vi.mock('../repositories', () => ({
  minigameRepository: {
    getTicketStatus: vi.fn(),
    refreshTicketStatus: vi.fn(),
    updateTickets: vi.fn(),
    startSession: vi.fn(),
    expireSessions: vi.fn(),
    findSessionById: vi.fn(),
    findActiveStartedSession: vi.fn(),
    recordRoundOutcome: vi.fn(),
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
const refreshTicketStatus = vi.mocked(minigameRepository.refreshTicketStatus);
const updateTickets = vi.mocked(minigameRepository.updateTickets);
const startSession = vi.mocked(minigameRepository.startSession);
const expireSessions = vi.mocked(minigameRepository.expireSessions);
const findSessionById = vi.mocked(minigameRepository.findSessionById);
const findActiveStartedSession = vi.mocked(minigameRepository.findActiveStartedSession);
const recordRoundOutcome = vi.mocked(minigameRepository.recordRoundOutcome);
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
const authoritativePuzzleInitial = solvedPuzzlePieces.map((piece) => ({ ...piece }));
[authoritativePuzzleInitial[0], authoritativePuzzleInitial[1]] = [authoritativePuzzleInitial[1], authoritativePuzzleInitial[0]];
authoritativePuzzleInitial[2] = { ...authoritativePuzzleInitial[2], rotation: 90 };
const authoritativePuzzleMoves = [
  { type: 'swap', from: 0, to: 1 },
  { type: 'rotate', index: 2 },
  { type: 'rotate', index: 2 },
  { type: 'rotate', index: 2 }
];
const authoritativeMatchDeck = Array.from({ length: 6 }, (_, pair) => [0, 1].map((copy) => ({
  card_id: `card-${pair}-${copy}`,
  channel_id: `channel-${pair}`,
  name: `스트리머 ${pair}`,
  logo_url: `https://example.com/${pair}.png`
}))).flat();
const authoritativeMatchPairs = Array.from({ length: 6 }, (_, pair) => ({
  first_card_id: `card-${pair}-0`,
  second_card_id: `card-${pair}-1`
}));
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
  completeSession.mockResolvedValue({ ok: true, settledNow: true, newPoints: 5000, earnedPoints: 0, resultData: null });

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
  completeSession.mockResolvedValue({ ok: true, settledNow: true, newPoints: 5000, earnedPoints: 0, resultData: null });

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

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 0, expect.any(String));
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
    completeSession.mockResolvedValue({ ok: true, settledNow: true, newPoints: 6000, earnedPoints: 0, resultData: null });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'puzzle-session',
        payload: { success: true, puzzle_pieces: solvedPuzzlePieces }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 0, expect.any(String));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 0,
      practice_mode: true
    }));
  });

  it('completes a successful practice puzzle without awarding points', async () => {
    const response = await runPuzzleSubmission(124999, true);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 0, expect.any(String));
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

    expect(completeSession).toHaveBeenCalledWith('match-session', 0, expect.any(String));
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

    expect(completeSession).toHaveBeenCalledWith('match-session', 0, expect.any(String));
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
    completeSession.mockResolvedValue({ ok: true, settledNow: true, newPoints: 6200, earnedPoints: 0, resultData: null });
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
      expect(response.status).toHaveBeenCalledWith(409);
      expect(response.json).toHaveBeenCalledWith({
        error: 'LegacyMinigameSession',
        message: '이전 검증 방식으로 발급된 미니게임은 보상을 지급할 수 없어 안전하게 종료했습니다. 새 게임을 시작해 주세요.',
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

    expect(completeSession).toHaveBeenCalledWith(sessionId, 0, expect.any(String));
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

  it('locks a paid round choice before revealing whether it is correct', async () => {
    const session = {
      id: 'paid-quiz-session',
      user_id: 'user-1',
      game_type: 'quiz' as const,
      status: 'STARTED' as const,
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
      progress_data: JSON.stringify({
        round_outcomes: [],
        round_deadline_at: new Date(Date.now() + 5_000).toISOString()
      }),
      progress_revision: 0,
      created_at: new Date(Date.now() - 10_000).toISOString()
    };
    findSessionById.mockResolvedValue(session);
    recordRoundOutcome.mockResolvedValue({
      ok: true,
      duplicate: false,
      session: {
        ...session,
        progress_data: JSON.stringify({
          round_outcomes: [{ round: 0, selected_channel_id: 'quiz-answer-0' }],
          round_deadline_at: new Date(Date.now() + 12_000).toISOString()
        }),
        progress_revision: 1
      }
    });
    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: session.id,
        payload: { round: 0, selected_channel_id: 'quiz-answer-0' }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await checkMinigameRoundAnswer(request, response);

    expect(recordRoundOutcome).toHaveBeenCalledWith(
      session.id,
      'user-1',
      0,
      'quiz-answer-0',
      expect.any(String)
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      correct: true,
      correct_channel_ids: ['quiz-answer-0'],
      total_rounds: 5,
      next_round: expect.objectContaining({ round: 1 }),
      next_round_deadline_at: expect.any(String),
      server_now: expect.any(String)
    }));
    const responseBody = vi.mocked(response.json).mock.calls[0][0] as any;
    expect(responseBody.next_round.image_url).toMatch(/^minigame-image:v1:/);
    expect(responseBody.next_round.image_url).not.toContain('quiz-answer-1');
  });

  it('does not reveal an alternate paid answer after the round was resolved', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-quiz-session',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
      progress_data: JSON.stringify({
        round_outcomes: [{ round: 0, selected_channel_id: 'quiz-wrong-0' }]
      }),
      progress_revision: 1,
      created_at: new Date(Date.now() - 10_000).toISOString()
    });
    recordRoundOutcome.mockResolvedValue({ ok: false, reason: '이미 다른 답으로 확정된 라운드입니다.' });
    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-quiz-session',
        payload: { round: 0, selected_channel_id: 'quiz-answer-0' }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await checkMinigameRoundAnswer(request, response);

    expect(response.status).toHaveBeenCalledWith(409);
    const body = vi.mocked(response.json).mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('correct');
    expect(body).not.toHaveProperty('correct_channel_ids');
  });

  it('does not reveal feedback or the next question when the server round deadline expired', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-quiz-expired-round',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
      progress_data: JSON.stringify({
        round_outcomes: [],
        round_deadline_at: new Date(Date.now() - 1).toISOString()
      }),
      progress_revision: 0,
      created_at: new Date(Date.now() - 10_000).toISOString()
    });
    recordRoundOutcome.mockResolvedValue({ ok: false, reason: '현재 라운드의 서버 마감 시간이 지났습니다.' });
    const response = createResponse();

    await checkMinigameRoundAnswer({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-quiz-expired-round',
        payload: { round: 0, selected_channel_id: 'quiz-answer-0' }
      }
    } as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'RoundTimeExpired' }));
    const body = vi.mocked(response.json).mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('correct');
    expect(body).not.toHaveProperty('correct_channel_ids');
    expect(body).not.toHaveProperty('next_round');
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
      expect(response.status).toHaveBeenCalledWith(409);
      const body = vi.mocked(response.json).mock.calls[0][0] as Record<string, unknown>;
      expect(body).toEqual(expect.objectContaining({
        error: 'LegacyMinigameSession',
        session_closed: true,
        earned_points: 0
      }));
      expect(body).not.toHaveProperty('correct');
      expect(body).not.toHaveProperty('correct_channel_ids');
    }
  );
});

describe('authoritative paid minigame activation contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T00:00:00.000Z'));
    vi.clearAllMocks();
    findUserById.mockResolvedValue({ point: 5000 } as never);
    completeSession.mockResolvedValue({ ok: true, settledNow: true, newPoints: 6000, earnedPoints: 0, resultData: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not accept the universal solved puzzle payload for a versioned paid session without its issued move proof', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-puzzle-v1',
      user_id: 'user-1',
      game_type: 'puzzle',
      status: 'STARTED',
      target_data: JSON.stringify({
        validation_version: 1,
        practice_mode: false,
        correct_id: 'channel-answer',
        initial_puzzle_pieces: Array.from({ length: 12 }, (_, id) => ({ id: 11 - id, rotation: 90 }))
      }),
      created_at: new Date(Date.now() - 10_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-puzzle-v1',
        payload: { success: true, puzzle_pieces: solvedPuzzlePieces }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('does not settle paid round answers supplied only at final submit', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-quiz-v1',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'STARTED',
      target_data: JSON.stringify({
        validation_version: 1,
        practice_mode: false,
        rounds: quizRounds
      }),
      created_at: new Date(Date.now() - 20_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-quiz-v1',
        payload: {
          answers: quizRounds.map((round) => ({ round: round.round, selected_channel_id: round.answer_channel_id }))
        }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(409);
  });

  it('settles a paid round game only from the five outcomes stored by the server', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-quiz-stored-progress',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
      progress_data: JSON.stringify({
        round_outcomes: quizRounds.map((round) => ({
          round: round.round,
          selected_channel_id: round.answer_channel_id
        }))
      }),
      progress_revision: 5,
      created_at: new Date(Date.now() - 20_000).toISOString()
    });
    const response = createResponse();

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-quiz-stored-progress',
        payload: {
          answers: quizRounds.map((round) => ({
            round: round.round,
            selected_channel_id: `quiz-wrong-${round.round}`
          }))
        }
      }
    } as AuthenticatedRequest, response);

    expect(completeSession).toHaveBeenCalledWith('paid-quiz-stored-progress', 1200, expect.any(String));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ correct: true, earned_points: 1200 }));
  });

  it('uses the winning stored settlement when concurrent final submissions race', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-quiz-settlement-race',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
      progress_data: JSON.stringify({
        round_outcomes: quizRounds.map((round) => ({
          round: round.round,
          selected_channel_id: round.answer_channel_id
        }))
      }),
      progress_revision: 5,
      created_at: new Date(Date.now() - 20_000).toISOString()
    });
    completeSession.mockResolvedValue({
      ok: true,
      settledNow: false,
      earnedPoints: 0,
      newPoints: 5000,
      resultData: JSON.stringify({
        correct: false,
        earned_points: 0,
        message: '먼저 확정된 결과입니다.',
        practice_mode: false
      })
    });
    const response = createResponse();

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: { session_id: 'paid-quiz-settlement-race', payload: {} }
    } as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      correct: false,
      earned_points: 0,
      new_balance: 5000,
      message: '먼저 확정된 결과입니다.'
    }));
  });

  it('returns the stored completed result instead of regrading a replay payload', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-completed-result',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'COMPLETED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
      progress_data: '{}',
      result_data: JSON.stringify({
        correct: false,
        message: '처음 제출된 결과입니다.',
        practice_mode: false
      }),
      earned_points: 0,
      created_at: new Date(Date.now() - 20_000).toISOString()
    });
    const response = createResponse();

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-completed-result',
        payload: {
          answers: quizRounds.map((round) => ({ round: round.round, selected_channel_id: round.answer_channel_id }))
        }
      }
    } as AuthenticatedRequest, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      correct: false,
      earned_points: 0,
      message: '처음 제출된 결과입니다.'
    }));
  });

  it('replays a bounded server-issued puzzle move proof and awards the paid result once', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-puzzle-proof',
      user_id: 'user-1',
      game_type: 'puzzle',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({
        practice_mode: false,
        correct_id: 'channel-answer',
        initial_puzzle_pieces: authoritativePuzzleInitial
      }),
      progress_data: '{}',
      created_at: new Date(Date.now() - 10_000).toISOString()
    });
    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-puzzle-proof',
        payload: {
          success: true,
          puzzle_pieces: solvedPuzzlePieces,
          puzzle_moves: authoritativePuzzleMoves,
          client_remaining_ms: 120_000
        }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith('paid-puzzle-proof', 1200, expect.any(String));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ correct: true, earned_points: 1200 }));
  });

  it('uses server receipt time rather than forged client_remaining_ms for the puzzle bonus', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-puzzle-server-time',
      user_id: 'user-1',
      game_type: 'puzzle',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({
        practice_mode: false,
        correct_id: 'channel-answer',
        initial_puzzle_pieces: authoritativePuzzleInitial
      }),
      progress_data: '{}',
      created_at: new Date(Date.now() - 40_000).toISOString()
    });
    const response = createResponse();

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-puzzle-server-time',
        payload: {
          success: true,
          puzzle_pieces: solvedPuzzlePieces,
          puzzle_moves: authoritativePuzzleMoves,
          client_remaining_ms: 120_000
        }
      }
    } as AuthenticatedRequest, response);

    expect(completeSession).toHaveBeenCalledWith('paid-puzzle-server-time', 1000, expect.any(String));
  });

  it('rejects an over-cap puzzle transcript before doing unbounded replay work', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-puzzle-over-cap',
      user_id: 'user-1',
      game_type: 'puzzle',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, initial_puzzle_pieces: authoritativePuzzleInitial }),
      progress_data: '{}',
      created_at: new Date(Date.now() - 10_000).toISOString()
    });
    const response = createResponse();

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-puzzle-over-cap',
        payload: {
          success: true,
          puzzle_pieces: solvedPuzzlePieces,
          puzzle_moves: Array.from({ length: 129 }, () => ({ type: 'rotate', index: 2 }))
        }
      }
    } as AuthenticatedRequest, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('does not extend a paid puzzle hard deadline from client_remaining_ms', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-puzzle-expired',
      user_id: 'user-1',
      game_type: 'puzzle',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, initial_puzzle_pieces: authoritativePuzzleInitial }),
      progress_data: '{}',
      created_at: new Date(Date.now() - 126_000).toISOString()
    });
    const response = createResponse();

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-puzzle-expired',
        payload: {
          success: true,
          puzzle_pieces: solvedPuzzlePieces,
          puzzle_moves: authoritativePuzzleMoves,
          client_remaining_ms: 120_000
        }
      }
    } as AuthenticatedRequest, response);

    expect(completeSession).toHaveBeenCalledWith('paid-puzzle-expired', 0);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ correct: false, earned_points: 0 }));
  });

  it('validates all six unique pairs against the exact server-issued match deck', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-match-proof',
      user_id: 'user-1',
      game_type: 'match',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, cards: authoritativeMatchDeck }),
      progress_data: '{}',
      created_at: new Date(Date.now() - 10_000).toISOString()
    });
    const response = createResponse();

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-match-proof',
        payload: { success: true, matched_pairs: authoritativeMatchPairs }
      }
    } as AuthenticatedRequest, response);

    expect(completeSession).toHaveBeenCalledWith('paid-match-proof', 1200, expect.any(String));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ correct: true, earned_points: 1200 }));
  });

  it('rejects the old public channel-id multiset for a versioned paid match session', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-match-forgery',
      user_id: 'user-1',
      game_type: 'match',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, cards: authoritativeMatchDeck }),
      progress_data: '{}',
      created_at: new Date(Date.now() - 10_000).toISOString()
    });
    const response = createResponse();

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-match-forgery',
        payload: { success: true, matched_channel_ids: solvedMatchChannelIds }
      }
    } as AuthenticatedRequest, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });

  it('rejects a match proof that reuses the same server-issued card', async () => {
    findSessionById.mockResolvedValue({
      id: 'paid-match-reused-card',
      user_id: 'user-1',
      game_type: 'match',
      status: 'STARTED',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, cards: authoritativeMatchDeck }),
      progress_data: '{}',
      created_at: new Date(Date.now() - 10_000).toISOString()
    });
    const response = createResponse();
    const reusedPairs = authoritativeMatchPairs.map((pair, index) => index === 1 ? authoritativeMatchPairs[0] : pair);

    await submitMinigameResult({
      user: { id: 'user-1' },
      body: {
        session_id: 'paid-match-reused-card',
        payload: { success: true, matched_pairs: reusedPairs }
      }
    } as AuthenticatedRequest, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
  });
});

describe('daily minigame selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    systemConfigGet.mockResolvedValue('240');
    expireSessions.mockResolvedValue(undefined);
    findActiveStartedSession.mockResolvedValue(null);
    getExcludedPuzzleImageKeys.mockResolvedValue(new Set());
    refreshTicketStatus.mockResolvedValue({
      user_id: 'user-1',
      current_tickets: 5,
      bonus_tickets: 0,
      last_charged_at: new Date().toISOString(),
      seconds_until_next_ticket: 14_400
    });
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
    refreshTicketStatus.mockResolvedValue({
      user_id: 'user-1',
      current_tickets: 4,
      bonus_tickets: 0,
      last_charged_at: new Date('2026-06-06T00:00:00.000Z').toISOString(),
      seconds_until_next_ticket: 1800
    });
    const request = { user: { id: 'user-1' } } as AuthenticatedRequest;
    const response = createResponse();

    await getMinigameStatus(request, response);

    expect(systemConfigGet).toHaveBeenCalledWith('minigame_ticket_charge_interval_minutes', '240');
    expect(refreshTicketStatus).toHaveBeenCalledWith('user-1', 60);
    expect(updateTickets).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      base_tickets: 4,
      seconds_until_next_ticket: 1800,
      ticket_charge_interval_minutes: 60
    }));
  });

  it('rejects a paid start when it is not today\'s KST game', async () => {
    vi.setSystemTime(new Date('2026-06-06T03:00:00.000Z')); // puzzle day
    const request = {
      user: { id: 'user-1' },
      body: { game_type: 'quiz', practice_mode: false }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(refreshTicketStatus).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it('starts today\'s paid game with an authoritative server challenge', async () => {
    vi.setSystemTime(new Date('2026-06-06T03:00:00.000Z')); // puzzle day
    findAllStreamers.mockResolvedValue(createPlayableStreamers() as never);
    startSession.mockResolvedValue({ ok: true });
    const request = {
      user: { id: 'user-1' },
      body: { game_type: 'puzzle', practice_mode: false }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    const body = vi.mocked(response.json).mock.calls[0][0] as any;
    expect(body.practice_mode).toBe(false);
    expect(body.game_data.puzzle_pieces).toHaveLength(12);
    expect(refreshTicketStatus).toHaveBeenCalledWith('user-1', 240);
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({
      validation_version: 1,
      progress_data: JSON.stringify({ round_outcomes: [] })
    }), 240);
  });

  it('reveals only the current paid quiz round and stores its server deadline', async () => {
    vi.setSystemTime(new Date('2026-06-01T03:00:00.000Z')); // quiz day
    findAllStreamers.mockResolvedValue(createPlayableStreamers() as never);
    startSession.mockResolvedValue({ ok: true });
    const response = createResponse();

    await startMinigame({
      user: { id: 'user-1' },
      body: { game_type: 'quiz', practice_mode: false }
    } as AuthenticatedRequest, response);

    expect(response.status).toHaveBeenCalledWith(200);
    const body = vi.mocked(response.json).mock.calls[0][0] as any;
    expect(body.game_data).toEqual(expect.objectContaining({
      total_rounds: 5,
      round_deadline_at: expect.any(String)
    }));
    expect(body.game_data.rounds).toHaveLength(1);
    expect(body.game_data.rounds[0]).not.toHaveProperty('answer_channel_id');
    expect(body.game_data.rounds[0].image_url).toMatch(/^minigame-image:v1:/);
    expect(body.game_data.rounds[0].image_url).not.toContain('example.com');

    const issuedSession = startSession.mock.calls[0][0];
    const target = JSON.parse(issuedSession.target_data);
    const progress = JSON.parse(issuedSession.progress_data || '{}');
    expect(target.rounds).toHaveLength(5);
    expect(progress.round_outcomes).toEqual([]);
    expect(progress.round_deadline_at).toBe(body.game_data.round_deadline_at);
  });

  it.each([
    { label: 'omitted', practiceMode: undefined },
    { label: 'string true', practiceMode: 'true' },
    { label: 'numeric true', practiceMode: 1 }
  ])('does not treat $label practice_mode as the zero-reward mode', async ({ practiceMode }) => {
    vi.setSystemTime(new Date('2026-06-06T03:00:00.000Z')); // puzzle day
    findAllStreamers.mockResolvedValue(createPlayableStreamers() as never);
    startSession.mockResolvedValue({ ok: true });
    const request = {
      user: { id: 'user-1' },
      body: {
        game_type: 'puzzle',
        ...(practiceMode === undefined ? {} : { practice_mode: practiceMode })
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(startSession).toHaveBeenCalledWith(expect.objectContaining({
      target_data: expect.stringContaining('"practice_mode":false')
    }), 240);
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
    }), 240);
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
    completeSession.mockResolvedValue({ ok: true, settledNow: true, newPoints: 5000, earnedPoints: 0, resultData: null });
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
      legacy_session_closed: true,
      message: '이전 검증 방식의 미니게임 세션을 안전하게 종료했습니다. 새 게임을 시작해 주세요.'
    });
  });

  it('resumes a versioned paid crop detective session with server-stored round progress', async () => {
    vi.setSystemTime(new Date('2026-06-12T03:00:00.000Z'));
    const roundDeadlineAt = new Date(Date.now() + 5_000).toISOString();
    findActiveStartedSession.mockResolvedValue({
      id: 'crop-authoritative-session',
      user_id: 'user-1',
      game_type: 'crop_detective',
      status: 'STARTED',
      ticket_spent_type: 'BASE',
      validation_version: 1,
      target_data: JSON.stringify({ practice_mode: false, rounds: cropDetectiveRounds }),
      progress_data: JSON.stringify({
        round_outcomes: [{ round: 0, selected_channel_id: 'answer-0' }],
        round_deadline_at: roundDeadlineAt
      }),
      progress_revision: 1,
      created_at: new Date(Date.now() - 15_000).toISOString()
    });
    const response = createResponse();

    await getActiveMinigameSession({
      user: { id: 'user-1' },
      query: { game_type: 'crop_detective' }
    } as unknown as AuthenticatedRequest, response);

    expect(completeSession).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      active_session: expect.objectContaining({
        session_id: 'crop-authoritative-session',
        resumed_session: true,
        game_data: expect.objectContaining({
          total_rounds: 5,
          rounds: expect.arrayContaining([
            expect.objectContaining({ round: 0 }),
            expect.objectContaining({ round: 1 })
          ])
        }),
        round_progress: {
          outcomes: [{ round: 0, selected_channel_id: 'answer-0' }],
          next_round: 1,
          correct_count: 1,
          total_rounds: 5,
          round_deadline_at: roundDeadlineAt
        }
      })
    });
    const responseBody = vi.mocked(response.json).mock.calls[0][0] as any;
    for (const round of responseBody.active_session.game_data.rounds) {
      expect(round.source_image_url).toMatch(/^minigame-image:v1:/);
      expect(round.source_image_url).not.toContain('example.com');
      expect(round).not.toHaveProperty('source_fallback_image_url');
    }
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
    completeSession.mockResolvedValue({ ok: true, settledNow: true, newPoints: 5000, earnedPoints: 0, resultData: null });
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
    expect(responseBody.game_data).toEqual(expect.objectContaining({
      image_url: expect.stringMatching(/^https:\/\/example\.com\/\d+\.png$/),
      puzzle_pieces: expect.arrayContaining([
        expect.objectContaining({ id: expect.any(Number), rotation: expect.any(Number) })
      ])
    }));
    expect(responseBody.game_data.puzzle_pieces).toHaveLength(12);
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
