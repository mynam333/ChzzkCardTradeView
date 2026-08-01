import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JWT_SECRET } from '../config';
import { __setSqliteDbForTest } from '../services/db';
import {
  createAuthSessionToken,
  decodeAuthSessionToken,
  revokeAuthSessionToken,
  verifyAuthSessionToken,
  verifyAuthSessionTokens
} from '../services/authSessionService';

describe('authSessionService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL
      );
      CREATE TABLE auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run('user-1', 'tester');
    __setSqliteDbForTest(db);
  });

  afterEach(() => {
    __setSqliteDbForTest(null);
    db.close();
  });

  it('binds a signed JWT to an active database session and rejects it after logout', async () => {
    const token = await createAuthSessionToken('user-1', 'USER');
    const claims = decodeAuthSessionToken(token);

    expect(claims.id).toBe('user-1');
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(verifyAuthSessionToken(token)).resolves.toMatchObject({
      id: 'user-1',
      jti: claims.jti
    });

    await revokeAuthSessionToken(token);
    await expect(verifyAuthSessionToken(token)).rejects.toThrow('InvalidAuthSession');
  });

  it('keeps a stolen token invalid after account deletion and recreation with the same CHZZK id', async () => {
    const token = await createAuthSessionToken('user-1', 'USER');

    db.prepare('DELETE FROM users WHERE id = ?').run('user-1');
    db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run('user-1', 'rejoined');

    expect(db.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()).toEqual({ count: 0 });
    await expect(verifyAuthSessionToken(token)).rejects.toThrow('InvalidAuthSession');
  });

  it('rejects legacy JWTs that are not bound to a server-side session id', async () => {
    const legacyToken = jwt.sign({ id: 'user-1', role: 'USER' }, JWT_SECRET, { expiresIn: '7d' });

    await expect(verifyAuthSessionToken(legacyToken)).rejects.toBeDefined();
  });

  it('batch-validates active sessions while omitting revoked and legacy tokens', async () => {
    const activeToken = await createAuthSessionToken('user-1', 'USER');
    const revokedToken = await createAuthSessionToken('user-1', 'USER');
    await revokeAuthSessionToken(revokedToken);
    const legacyToken = jwt.sign({ id: 'user-1', role: 'USER' }, JWT_SECRET, { expiresIn: '7d' });

    const verified = await verifyAuthSessionTokens([activeToken, revokedToken, legacyToken, activeToken]);

    expect(Array.from(verified.keys())).toEqual([activeToken]);
    expect(verified.get(activeToken)).toMatchObject({ id: 'user-1' });
  });
});
