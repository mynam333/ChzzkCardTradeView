import crypto from 'crypto';
import { Request } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { IS_PRODUCTION, JWT_SECRET } from '../config';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { SESSION_COOKIE_NAMES } from './sessionCookie';

export const AUTH_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const AUTH_SESSION_LOOKUP_TIMEOUT_MS = Math.max(
  500,
  Number(process.env.AUTH_SESSION_LOOKUP_TIMEOUT_MS || 3000)
);
const SESSION_TOKEN_ISSUER = 'chikapo-api';
const SESSION_TOKEN_AUDIENCE = 'chikapo-web';

export type AuthSessionClaims = JwtPayload & {
  id: string;
  role?: string;
  jti: string;
};

type AuthSessionRow = {
  id: string;
  user_id: string;
  expires_at: string | Date;
  revoked_at: string | Date | null;
};

export class AuthSessionLookupTimeoutError extends Error {
  constructor() {
    super('AuthSessionLookupTimeout');
    this.name = 'AuthSessionLookupTimeoutError';
  }
}

export class InvalidAuthSessionError extends Error {
  constructor() {
    super('InvalidAuthSession');
    this.name = 'InvalidAuthSessionError';
  }
}

const withLookupTimeout = <T>(promise: Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthSessionLookupTimeoutError()), AUTH_SESSION_LOOKUP_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const assertClaims = (decoded: string | JwtPayload): AuthSessionClaims => {
  if (
    typeof decoded === 'string' ||
    typeof decoded.id !== 'string' ||
    decoded.id.length === 0 ||
    decoded.id.length > 191 ||
    typeof decoded.jti !== 'string' ||
    decoded.jti.length === 0 ||
    decoded.jti.length > 128
  ) {
    throw new InvalidAuthSessionError();
  }
  return decoded as AuthSessionClaims;
};

export const decodeAuthSessionToken = (token: string): AuthSessionClaims => {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: SESSION_TOKEN_ISSUER,
    audience: SESSION_TOKEN_AUDIENCE
  });
  return assertClaims(decoded);
};

const insertSession = async (row: AuthSessionRow): Promise<void> => {
  const mode = getDbMode();
  if (mode === 'LOCAL_SQL') {
    getSqliteDb().prepare(`
      INSERT INTO auth_sessions (id, user_id, expires_at, revoked_at)
      VALUES (?, ?, ?, NULL)
    `).run(row.id, row.user_id, String(row.expires_at));
    return;
  }
  if (mode === 'MYSQL') {
    await getMysqlDb().run(
      'INSERT INTO auth_sessions (id, user_id, expires_at, revoked_at) VALUES (?, ?, ?, NULL)',
      row.id,
      row.user_id,
      new Date(row.expires_at)
    );
    return;
  }

  const { error } = await getSupabaseClient().from('auth_sessions').insert({
    id: row.id,
    user_id: row.user_id,
    expires_at: String(row.expires_at),
    revoked_at: null
  });
  if (error) throw error;
};

const findSession = async (sessionId: string): Promise<AuthSessionRow | null> => {
  const mode = getDbMode();
  if (mode === 'LOCAL_SQL') {
    return (getSqliteDb().prepare(`
      SELECT id, user_id, expires_at, revoked_at
        FROM auth_sessions
       WHERE id = ?
       LIMIT 1
    `).get(sessionId) as AuthSessionRow | undefined) || null;
  }
  if (mode === 'MYSQL') {
    return (await getMysqlDb().get<AuthSessionRow>(`
      SELECT id, user_id, expires_at, revoked_at
        FROM auth_sessions
       WHERE id = ?
       LIMIT 1
    `, sessionId)) || null;
  }

  const { data, error } = await getSupabaseClient()
    .from('auth_sessions')
    .select('id, user_id, expires_at, revoked_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data as AuthSessionRow | null) || null;
};

const findSessions = async (sessionIds: string[]): Promise<AuthSessionRow[]> => {
  if (sessionIds.length === 0) return [];
  const mode = getDbMode();
  const placeholders = sessionIds.map(() => '?').join(', ');
  if (mode === 'LOCAL_SQL') {
    return getSqliteDb().prepare(`
      SELECT id, user_id, expires_at, revoked_at
        FROM auth_sessions
       WHERE id IN (${placeholders})
    `).all(...sessionIds) as AuthSessionRow[];
  }
  if (mode === 'MYSQL') {
    return getMysqlDb().all<AuthSessionRow>(`
      SELECT id, user_id, expires_at, revoked_at
        FROM auth_sessions
       WHERE id IN (${placeholders})
    `, ...sessionIds);
  }

  const { data, error } = await getSupabaseClient()
    .from('auth_sessions')
    .select('id, user_id, expires_at, revoked_at')
    .in('id', sessionIds);
  if (error) throw error;
  return (data as AuthSessionRow[] | null) || [];
};

const revokeSession = async (sessionId: string, revokedAt: string): Promise<void> => {
  const mode = getDbMode();
  if (mode === 'LOCAL_SQL') {
    getSqliteDb().prepare(`
      UPDATE auth_sessions
         SET revoked_at = ?
       WHERE id = ?
         AND revoked_at IS NULL
    `).run(revokedAt, sessionId);
    return;
  }
  if (mode === 'MYSQL') {
    await getMysqlDb().run(`
      UPDATE auth_sessions
         SET revoked_at = ?
       WHERE id = ?
         AND revoked_at IS NULL
    `, new Date(revokedAt), sessionId);
    return;
  }

  const { error } = await getSupabaseClient()
    .from('auth_sessions')
    .update({ revoked_at: revokedAt })
    .eq('id', sessionId)
    .is('revoked_at', null);
  if (error) throw error;
};

export const createAuthSessionToken = async (userId: string, role?: string): Promise<string> => {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_SECONDS * 1000).toISOString();
  await insertSession({
    id: sessionId,
    user_id: userId,
    expires_at: expiresAt,
    revoked_at: null
  });

  try {
    return jwt.sign(
      { id: userId, role },
      JWT_SECRET,
      {
        algorithm: 'HS256',
        expiresIn: AUTH_SESSION_TTL_SECONDS,
        issuer: SESSION_TOKEN_ISSUER,
        audience: SESSION_TOKEN_AUDIENCE,
        jwtid: sessionId
      }
    );
  } catch (error) {
    await revokeSession(sessionId, new Date().toISOString()).catch(() => {});
    throw error;
  }
};

export const verifyAuthSessionToken = async (token: string): Promise<AuthSessionClaims> => {
  const claims = decodeAuthSessionToken(token);
  const session = await withLookupTimeout(findSession(claims.jti));
  const expiresAt = session ? new Date(session.expires_at).getTime() : Number.NaN;
  if (
    !session ||
    session.user_id !== claims.id ||
    session.revoked_at !== null ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new InvalidAuthSessionError();
  }
  return claims;
};

/**
 * WebSocket heartbeat처럼 다수의 세션을 확인할 때 N개의 개별 DB 조회 대신
 * 제한된 크기의 IN 쿼리로 검증합니다. 유효하지 않은 토큰은 결과 Map에서 제외됩니다.
 */
export const verifyAuthSessionTokens = async (tokens: string[]): Promise<Map<string, AuthSessionClaims>> => {
  const claimsByToken = new Map<string, AuthSessionClaims>();
  for (const token of new Set(tokens)) {
    try {
      claimsByToken.set(token, decodeAuthSessionToken(token));
    } catch {
      // 개별 손상 토큰 때문에 다른 연결의 검증까지 실패시키지 않습니다.
    }
  }

  const sessionIds = Array.from(new Set(Array.from(claimsByToken.values()).map((claims) => claims.jti)));
  const rows: AuthSessionRow[] = [];
  for (let index = 0; index < sessionIds.length; index += 500) {
    rows.push(...await withLookupTimeout(findSessions(sessionIds.slice(index, index + 500))));
  }
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const now = Date.now();
  const verified = new Map<string, AuthSessionClaims>();
  for (const [token, claims] of claimsByToken) {
    const session = rowsById.get(claims.jti);
    const expiresAt = session ? new Date(session.expires_at).getTime() : Number.NaN;
    if (
      session &&
      session.user_id === claims.id &&
      session.revoked_at === null &&
      Number.isFinite(expiresAt) &&
      expiresAt > now
    ) {
      verified.set(token, claims);
    }
  }
  return verified;
};

export const revokeAuthSessionToken = async (token: string): Promise<void> => {
  const claims = decodeAuthSessionToken(token);
  await withLookupTimeout(revokeSession(claims.jti, new Date().toISOString()));
};

const bearerSessionEnabled = () =>
  process.env.AUTH_BEARER_ENABLED === 'true' ||
  (!IS_PRODUCTION && process.env.AUTH_BEARER_ENABLED !== 'false');

export const getRequestSessionToken = (req: Request): string | undefined => {
  const cookies = (req as any).cookies || {};
  const cookieToken = SESSION_COOKIE_NAMES
    .map((cookieName) => cookies[cookieName])
    .find(Boolean);
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (!authHeader || !bearerSessionEnabled()) return undefined;
  const [type, token] = authHeader.split(' ');
  return type === 'Bearer' && token ? token : undefined;
};
