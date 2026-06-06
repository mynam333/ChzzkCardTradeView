import { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedRequest } from '../middlewares/admin';

vi.mock('../repositories', () => ({
  minigameRepository: {
    findSessionById: vi.fn(),
    completeSession: vi.fn()
  },
  streamerRepository: {},
  userRepository: {
    findById: vi.fn()
  }
}));

import { submitMinigameResult } from '../controllers/minigameController';
import { minigameRepository, userRepository } from '../repositories';

const findSessionById = vi.mocked(minigameRepository.findSessionById);
const completeSession = vi.mocked(minigameRepository.completeSession);
const findUserById = vi.mocked(userRepository.findById);

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const runPuzzleSubmission = async (elapsedMs: number) => {
  findSessionById.mockResolvedValue({
    id: 'puzzle-session',
    user_id: 'user-1',
    game_type: 'puzzle',
    status: 'STARTED',
    target_data: '{}',
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
      message: '120초 시간 제한이 초과되어 실패 처리되었습니다.'
    }));
  });

  it('accepts a solved puzzle within the server time allowance', async () => {
    const response = await runPuzzleSubmission(124999);

    expect(completeSession).toHaveBeenCalledWith('puzzle-session', 1000);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      correct: true,
      earned_points: 1000
    }));
  });
});
