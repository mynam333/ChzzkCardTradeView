import { NextFunction, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/authSessionService', () => ({
  getRequestSessionToken: vi.fn(),
  decodeAuthSessionToken: vi.fn()
}));

import {
  decodeAuthSessionToken,
  getRequestSessionToken
} from '../services/authSessionService';
import {
  minigameImageAuthMiddleware,
  type MinigameImageAuthenticatedRequest
} from '../middlewares/minigameImageAuth';

const getSessionToken = vi.mocked(getRequestSessionToken);
const decodeSessionToken = vi.mocked(decodeAuthSessionToken);

const createResponse = () => {
  const response: any = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    removeHeader: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as Response;
};

describe('minigameImageAuthMiddleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds the image request to the signed JWT user without a database lookup', () => {
    getSessionToken.mockReturnValue('signed-session');
    decodeSessionToken.mockReturnValue({ id: 'user-1', jti: 'session-1' } as any);
    const request = { headers: {}, cookies: {} } as unknown as MinigameImageAuthenticatedRequest;
    const response = createResponse();
    const next = vi.fn() as NextFunction;

    minigameImageAuthMiddleware(request, response, next);

    expect(decodeSessionToken).toHaveBeenCalledWith('signed-session');
    expect(request.minigameImageUserId).toBe('user-1');
    expect(next).toHaveBeenCalledOnce();
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(response.setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'same-site');
  });

  it('fails closed when the cookie is missing or its signature is invalid', () => {
    const responseWithoutToken = createResponse();
    const nextWithoutToken = vi.fn() as NextFunction;
    getSessionToken.mockReturnValue(undefined);

    minigameImageAuthMiddleware(
      { headers: {}, cookies: {} } as unknown as MinigameImageAuthenticatedRequest,
      responseWithoutToken,
      nextWithoutToken
    );

    expect(responseWithoutToken.status).toHaveBeenCalledWith(401);
    expect(nextWithoutToken).not.toHaveBeenCalled();

    const responseInvalid = createResponse();
    const nextInvalid = vi.fn() as NextFunction;
    getSessionToken.mockReturnValue('invalid-session');
    decodeSessionToken.mockImplementation(() => { throw new Error('invalid'); });

    minigameImageAuthMiddleware(
      { headers: {}, cookies: {} } as unknown as MinigameImageAuthenticatedRequest,
      responseInvalid,
      nextInvalid
    );

    expect(responseInvalid.status).toHaveBeenCalledWith(401);
    expect(nextInvalid).not.toHaveBeenCalled();
  });
});
