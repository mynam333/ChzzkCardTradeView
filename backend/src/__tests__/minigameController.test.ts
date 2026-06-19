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

import { checkMinigameRoundAnswer, getCardImageUrl, getDailyMinigame, getMinigameStatus, startMinigame, submitMinigameResult } from '../controllers/minigameController';
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

const getTestRotatedCropSafeMargin = (size: number, rotation: number) => {
  const radians = (rotation * Math.PI) / 180;
  return Math.min(0.48, (size * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)))) / 2 + 0.025);
};

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
    const response = await runPuzzleSubmission(125001);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      correct: false,
      earned_points: 0,
      message: '120초 시간 제한이 초과되어 실패 처리되었습니다.',
      answer: expect.objectContaining({
        channel_id: 'channel-answer',
        name: '정답 스트리머',
        image_url: 'https://example.com/answer.png'
      })
    }));
  });

  it('accepts a solved puzzle within the server time allowance', async () => {
    const response = await runPuzzleSubmission(124999);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 1000);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 1000,
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
        practice_mode: false,
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

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 1000);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true
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
        practice_mode: false,
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
    const response = await runMatchSubmission(37001);

    expect(completeSession).toHaveBeenCalledWith('match-session', 0);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      correct: false,
      earned_points: 0,
      message: '30초 시간 제한이 초과되어 실패 처리되었습니다.'
    }));
  });

  it('accepts a solved match game within the server time allowance', async () => {
    const response = await runMatchSubmission(36999);

    expect(completeSession).toHaveBeenCalledWith('match-session', 1000);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 1000
    }));
  });

  it('rejects a bare success flag without verifiable matched card ids', async () => {
    findSessionById.mockResolvedValue({
      id: 'match-session',
      user_id: 'user-1',
      game_type: 'match',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, channel_ids: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'] }),
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

  it('awards base points when quiz has at least 3 correct answers', async () => {
    findSessionById.mockResolvedValue({
      id: 'quiz-session',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
      created_at: new Date(Date.now() - 20_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'quiz-session',
        payload: {
          answers: [
            { round: 0, selected_channel_id: 'quiz-answer-0' },
            { round: 1, selected_channel_id: 'quiz-answer-1' },
            { round: 2, selected_channel_id: 'quiz-answer-2' },
            { round: 3, selected_channel_id: 'quiz-wrong-3' },
            { round: 4, selected_channel_id: 'quiz-wrong-4' }
          ],
          client_remaining_ms: 0
        }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith('quiz-session', 1000);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 1000,
      message: expect.stringContaining('3/5')
    }));
  });

  it('awards bonus points when quiz has all 5 correct answers', async () => {
    findSessionById.mockResolvedValue({
      id: 'quiz-session',
      user_id: 'user-1',
      game_type: 'quiz',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
      created_at: new Date(Date.now() - 20_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'quiz-session',
        payload: {
          answers: quizRounds.map((round) => ({
            round: round.round,
            selected_channel_id: round.answer_channel_id
          })),
          client_remaining_ms: 0
        }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith('quiz-session', 1200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 1200,
      message: expect.stringContaining('5문제')
    }));
  });

  it('awards base points when value duel has at least 3 correct answers', async () => {
    findSessionById.mockResolvedValue({
      id: 'value-duel-session',
      user_id: 'user-1',
      game_type: 'value_duel',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, rounds: valueDuelRounds }),
      created_at: new Date(Date.now() - 20_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'value-duel-session',
        payload: {
          answers: [
            { round: 0, selected_channel_id: 'left-0' },
            { round: 1, selected_channel_id: 'left-1' },
            { round: 2, selected_channel_id: 'left-2' },
            { round: 3, selected_channel_id: 'right-3' },
            { round: 4, selected_channel_id: 'right-4' }
          ],
          client_remaining_ms: 30_000
        }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith('value-duel-session', 1000);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 1000,
      message: expect.stringContaining('3/5')
    }));
  });

  it('does not fail round-based games only because total wall-clock time exceeds 50 seconds', async () => {
    findSessionById.mockResolvedValue({
      id: 'value-duel-session',
      user_id: 'user-1',
      game_type: 'value_duel',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, rounds: valueDuelRounds }),
      created_at: new Date(Date.now() - 70_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'value-duel-session',
        payload: {
          answers: [
            { round: 0, selected_channel_id: 'left-0' },
            { round: 1, selected_channel_id: 'left-1' },
            { round: 2, selected_channel_id: 'left-2' }
          ],
          client_remaining_ms: 0
        }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith('value-duel-session', 1000);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      correct: true,
      earned_points: 1000
    }));
  });

  it('awards bonus points when crop detective has all 5 correct answers', async () => {
    findSessionById.mockResolvedValue({
      id: 'crop-session',
      user_id: 'user-1',
      game_type: 'crop_detective',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, rounds: cropDetectiveRounds }),
      created_at: new Date(Date.now() - 20_000).toISOString()
    });

    const request = {
      user: { id: 'user-1' },
      body: {
        session_id: 'crop-session',
        payload: {
          answers: cropDetectiveRounds.map((round) => ({
            round: round.round,
            selected_channel_id: round.answer_channel_id
          })),
          client_remaining_ms: 30_000
        }
      }
    } as AuthenticatedRequest;
    const response = createResponse();

    await submitMinigameResult(request, response);

    expect(completeSession).toHaveBeenCalledWith('crop-session', 1200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 1200,
      message: expect.stringContaining('5문제')
    }));
  });

  it('rejects round answers that are not one of the issued choices', async () => {
    findSessionById.mockResolvedValue({
      id: 'crop-session',
      user_id: 'user-1',
      game_type: 'crop_detective',
      status: 'STARTED',
      target_data: JSON.stringify({ practice_mode: false, rounds: cropDetectiveRounds }),
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
      target_data: JSON.stringify({ practice_mode: false, rounds: quizRounds }),
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
      target_data: JSON.stringify({ practice_mode: false, rounds: valueDuelRounds }),
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

  it('rejects a game that is not selected for today before reading or spending tickets', async () => {
    vi.setSystemTime(new Date('2026-06-06T03:00:00.000Z'));
    const todayGame = getDailyMinigame().game_type;
    const unavailableGame = (['quiz', 'puzzle', 'match'] as const).find(game => game !== todayGame)!;
    const request = {
      user: { id: 'user-1' },
      body: { game_type: unavailableGame }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'DailyMinigameChanged',
      today_game: todayGame
    }));
    expect(getTicketStatus).not.toHaveBeenCalled();
  });

  it('starts any game in practice mode without reading or spending tickets', async () => {
    vi.setSystemTime(new Date('2026-06-06T03:00:00.000Z'));
    const todayGame = getDailyMinigame().game_type;
    const practiceGame = (['quiz', 'puzzle', 'match'] as const).find(game => game !== todayGame)!;
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
      body: { game_type: practiceGame, practice_mode: true }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      game_type: practiceGame,
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

  it('resumes an active paid session before reading or spending another ticket', async () => {
    vi.setSystemTime(new Date('2026-06-07T03:00:00.000Z'));
    const todayGame = getDailyMinigame().game_type;
    const activeTarget = todayGame === 'quiz'
      ? {
        practice_mode: false,
        rounds: quizRounds
      }
      : todayGame === 'puzzle'
        ? {
          practice_mode: false,
          correct_id: 'channel-answer',
          correct_name: '정답 스트리머',
          image_url: 'https://example.com/answer.png',
          star: 3
        }
        : {
          practice_mode: false,
          cards: [
            { channel_id: 'channel-1', name: '보기1', logo_url: 'https://example.com/1.png' },
            { channel_id: 'channel-2', name: '보기2', logo_url: 'https://example.com/2.png' }
          ]
        };
    findActiveStartedSession.mockResolvedValue({
      id: 'started-session',
      user_id: 'user-1',
      game_type: todayGame,
      status: 'STARTED',
      ticket_spent_type: 'BASE',
      target_data: JSON.stringify(activeTarget)
    });
    const request = {
      user: { id: 'user-1' },
      body: { game_type: todayGame }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'started-session',
      resumed: true,
      game_data: todayGame === 'match'
        ? expect.objectContaining({ cards: expect.arrayContaining([expect.objectContaining({ channel_id: 'channel-1' })]) })
        : todayGame === 'quiz'
          ? expect.objectContaining({ rounds: expect.arrayContaining([expect.objectContaining({ image_url: 'https://example.com/quiz-answer-0.png' })]) })
          : expect.objectContaining({ image_url: 'https://example.com/answer.png' })
    }));
    expect(getTicketStatus).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
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

  it('does not issue a puzzle image that is excluded through a lower-star fallback', async () => {
    let puzzleDay = Date.parse('2026-06-01T03:00:00.000Z');
    for (let offset = 0; offset < 40; offset++) {
      const candidate = Date.UTC(2026, 5, 1 + offset, 3, 0, 0);
      if (getDailyMinigame(candidate).game_type === 'puzzle') {
        puzzleDay = candidate;
        break;
      }
    }
    vi.setSystemTime(new Date(puzzleDay));

    const excludedImage = 'https://api.yuaru.com/uploads/cards/reported-image.webp';
    getExcludedPuzzleImageKeys.mockResolvedValue(new Set(['uploads:cards/reported-image.webp']));
    findAllStreamers.mockResolvedValue([
      {
        channel_id: 'reported-channel',
        name: '신고된 이미지',
        logo_url: 'https://example.com/reported-logo.png',
        custom_image_url: null,
        custom_images: [null, null, null, excludedImage, null, null]
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        channel_id: `safe-channel-${index}`,
        name: `안전 ${index}`,
        logo_url: `https://example.com/safe-${index}.png`,
        custom_image_url: null,
        custom_images: []
      }))
    ] as never);
    getTicketStatus.mockResolvedValue({
      user_id: 'user-1',
      current_tickets: 5,
      bonus_tickets: 0,
      last_charged_at: new Date(puzzleDay).toISOString()
    });
    updateTickets.mockResolvedValue(undefined);
    startSession.mockResolvedValue({ ok: true });

    const request = {
      user: { id: 'user-1' },
      body: { game_type: 'puzzle' }
    } as AuthenticatedRequest;
    const response = createResponse();

    await startMinigame(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    const responseBody = vi.mocked(response.json).mock.calls[0][0] as any;
    expect(responseBody.game_data.image_url).not.toBe(excludedImage);

    const target = JSON.parse(startSession.mock.calls[0][0].target_data);
    expect(target.image_url).not.toBe(excludedImage);
  });

  it('issues crop detective rounds with doubled zoom and random rotation data', async () => {
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
      const safeMargin = getTestRotatedCropSafeMargin(round.crop.size, round.crop.rotation);
      expect(round.crop.x).toBeGreaterThanOrEqual(safeMargin - 0.001);
      expect(round.crop.x).toBeLessThanOrEqual(1 - safeMargin + 0.001);
      expect(round.crop.y).toBeGreaterThanOrEqual(safeMargin - 0.001);
      expect(round.crop.y).toBeLessThanOrEqual(1 - safeMargin + 0.001);
      expect(round.source_image_url).toMatch(/^https:\/\/example\.com\/\d+\.png$/);
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
  });
});
