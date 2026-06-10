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

import { getDailyMinigame, getMinigameStatus, startMinigame, submitMinigameResult } from '../controllers/minigameController';
import { minigameRepository, streamerRepository, systemConfigRepository, userRepository } from '../repositories';

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

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
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
      payload: { success: true }
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
    target_data: JSON.stringify({ practice_mode: practiceMode }),
    created_at: new Date(Date.now() - elapsedMs).toISOString()
  });
  findUserById.mockResolvedValue({ point: 5000 } as never);
  completeSession.mockResolvedValue({ ok: true, newPoints: 5000 });

  const request = {
    user: { id: 'user-1' },
    body: {
      session_id: 'match-session',
      payload: { success: true }
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
        payload: { success: true }
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
});

describe('daily minigame selection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    systemConfigGet.mockResolvedValue('240');
    expireSessions.mockResolvedValue(undefined);
    findActiveStartedSession.mockResolvedValue(null);
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

  it('resumes an active paid session before reading or spending another ticket', async () => {
    vi.setSystemTime(new Date('2026-06-07T03:00:00.000Z'));
    const todayGame = getDailyMinigame().game_type;
    const activeTarget = todayGame === 'quiz'
      ? {
        practice_mode: false,
        correct_id: 'channel-answer',
        correct_name: '정답 스트리머',
        image_url: 'https://example.com/answer.png',
        star: 3,
        choices: [
          { channel_id: 'channel-answer', name: '정답 스트리머' },
          { channel_id: 'channel-2', name: '보기2' },
          { channel_id: 'channel-3', name: '보기3' },
          { channel_id: 'channel-4', name: '보기4' }
        ]
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
});
