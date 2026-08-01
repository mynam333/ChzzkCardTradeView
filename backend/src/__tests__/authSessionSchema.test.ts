import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensurePostgresCompatibilityMigrations } from '../services/db';
import { PostgresDb } from '../services/postgresDb';

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('auth session schema readiness', () => {
  it('creates the PostgreSQL session table during startup migration', async () => {
    const run = vi.fn().mockResolvedValue({
      changes: 0,
      affectedRows: 0,
      insertId: 0,
      lastInsertRowid: 0
    });
    await ensurePostgresCompatibilityMigrations({ run } as unknown as PostgresDb);

    const statements = run.mock.calls.map(([sql]) => normalizeSql(String(sql)));
    const table = statements.find((sql) => /CREATE TABLE IF NOT EXISTS auth_sessions/i.test(sql));

    expect(table).toContain('user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE');
    expect(table).toContain('expires_at TIMESTAMPTZ NOT NULL');
    expect(statements).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auth_sessions_user_active ON auth_sessions (user_id, revoked_at, expires_at)'
    );
    const quotaReservations = statements.find((sql) =>
      /CREATE TABLE IF NOT EXISTS chat_attachment_quota_reservations/i.test(sql)
    );
    expect(quotaReservations).toContain('user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE');
    expect(quotaReservations).toContain('reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes > 0)');
  });

  it('defines the session FK and expiry index in every SQL bootstrap schema', () => {
    const repositoryRoot = path.resolve(__dirname, '../../..');
    for (const filename of ['init-db.sql', 'init-db-mysql.sql', 'init-db-postgres.sql']) {
      const schema = normalizeSql(fs.readFileSync(path.join(repositoryRoot, filename), 'utf8'));
      expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS auth_sessions/i);
      expect(schema).toMatch(/REFERENCES users\s*\(id\) ON DELETE CASCADE/i);
      expect(schema).toContain('idx_auth_sessions_user_active');
      expect(schema).toContain('idx_auth_sessions_expires_at');
      expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS chat_attachment_quota_locks/i);
      expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS chat_attachment_quota_reservations/i);
      expect(schema).toContain('idx_chat_attachment_quota_reservations_expiry');
    }
  });
});
