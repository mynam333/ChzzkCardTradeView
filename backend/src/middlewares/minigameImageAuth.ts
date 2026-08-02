import { NextFunction, Request, Response } from 'express';
import {
  getRequestSessionToken,
  verifyAuthSessionToken
} from '../services/authSessionService';

export type MinigameImageAuthenticatedRequest = Request & {
  minigameImageUserId?: string;
};

/**
 * Verifies the signed session JWT and its server-side revocation state before a
 * protected clue can mutate the authoritative round deadline.
 */
export const minigameImageAuthMiddleware = async (
  req: MinigameImageAuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  res.removeHeader('Access-Control-Allow-Origin');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const token = getRequestSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요한 이미지입니다.' });
  }

  try {
    req.minigameImageUserId = (await verifyAuthSessionToken(token)).id;
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized', message: '만료되었거나 손상된 로그인 정보입니다.' });
  }
};
