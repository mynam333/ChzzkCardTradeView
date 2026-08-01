import { NextFunction, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../repositories', () => ({
  userRepository: {
    findById: vi.fn(),
    updateLastSeen: vi.fn()
  }
}));

vi.mock('../services/authSessionService', () => {
  class AuthSessionLookupTimeoutError extends Error {
    constructor() {
      super('AuthSessionLookupTimeout');
      this.name = 'AuthSessionLookupTimeoutError';
    }
  }
  return {
    AuthSessionLookupTimeoutError,
    getRequestSessionToken: vi.fn(),
    verifyAuthSessionToken: vi.fn()
  };
});

import { userRepository } from '../repositories';
import {
  AuthSessionLookupTimeoutError,
  getRequestSessionToken,
  verifyAuthSessionToken
} from '../services/authSessionService';
import { AuthenticatedRequest } from '../middlewares/admin';
import { __resetAuthCachesForTest, authMiddleware } from '../middlewares/auth';

const findUserById = vi.mocked(userRepository.findById);
const updateLastSeen = vi.mocked(userRepository.updateLastSeen);
const getSessionToken = vi.mocked(getRequestSessionToken);
const verifySessionToken = vi.mocked(verifyAuthSessionToken);

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const runMiddleware = async () => {
  const request = { headers: {}, cookies: {} } as unknown as AuthenticatedRequest;
  const response = createResponse();
  const next = vi.fn() as NextFunction;
  await authMiddleware(request, response, next);
  return { request, response, next };
};

describe('authMiddleware session validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    __resetAuthCachesForTest();
    getSessionToken.mockReturnValue('session-token');
    verifySessionToken.mockResolvedValue({ id: 'user-1', jti: 'session-1' } as any);
    updateLastSeen.mockResolvedValue(undefined as never);
  });

  it('loads the current user only after the database session is validated', async () => {
    const user = { id: 'user-1', role: 'USER' };
    findUserById.mockResolvedValue(user as never);

    const { request, response, next } = await runMiddleware();

    expect(verifySessionToken).toHaveBeenCalledWith('session-token');
    expect(findUserById).toHaveBeenCalledWith('user-1');
    expect(request.user).toBe(user);
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('fails closed when an expired user-cache entry cannot be refreshed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    findUserById.mockResolvedValueOnce({ id: 'user-1', role: 'USER' } as never);
    await runMiddleware();

    vi.setSystemTime(new Date('2026-08-01T00:00:16.000Z'));
    findUserById.mockRejectedValueOnce(new Error('AuthUserLookupTimeout'));
    const { response, next } = await runMiddleware();

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '3');
  });

  it('rejects a revoked session before consulting a cached user', async () => {
    verifySessionToken.mockRejectedValueOnce(new Error('InvalidAuthSession'));

    const { response, next } = await runMiddleware();

    expect(findUserById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
  });

  it('returns a retryable error when the session store cannot be checked in time', async () => {
    verifySessionToken.mockRejectedValueOnce(new AuthSessionLookupTimeoutError());

    const { response, next } = await runMiddleware();

    expect(findUserById).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '3');
  });
});
