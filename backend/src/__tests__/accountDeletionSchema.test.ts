import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensurePostgresCompatibilityMigrations } from '../services/db';
import { PostgresDb } from '../services/postgresDb';

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('account deletion schema readiness', () => {
  it('PostgreSQL startup migration creates the audit table and tombstone snapshot columns', async () => {
    const run = vi.fn().mockResolvedValue({
      changes: 0,
      affectedRows: 0,
      insertId: 0,
      lastInsertRowid: 0
    });
    const db = { run } as unknown as PostgresDb;

    await ensurePostgresCompatibilityMigrations(db);

    const statements = run.mock.calls.map(([sql]) => normalizeSql(String(sql)));
    const auditTable = statements.find((sql) =>
      /CREATE TABLE IF NOT EXISTS market_transaction_audit_logs/i.test(sql)
    );
    const tombstoneColumns = statements.find((sql) =>
      /ALTER TABLE deleted_user_accounts/i.test(sql)
    );

    expect(auditTable).toContain('audit_key TEXT NOT NULL');
    expect(auditTable).toContain('current_bidder_id TEXT');
    expect(auditTable).toContain('recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(tombstoneColumns).toContain('ADD COLUMN IF NOT EXISTS username_snapshot TEXT');
    expect(tombstoneColumns).toContain('ADD COLUMN IF NOT EXISTS avatar_url_snapshot TEXT');
    expect(tombstoneColumns).toContain('ADD COLUMN IF NOT EXISTS point_at_deletion BIGINT');
    expect(statements).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uniq_market_audit_key ON market_transaction_audit_logs (audit_key)'
    );
  });

  it('fresh MySQL and PostgreSQL schemas both include the account deletion audit table', () => {
    const repositoryRoot = path.resolve(__dirname, '../../..');
    const postgresSchema = normalizeSql(
      fs.readFileSync(path.join(repositoryRoot, 'init-db-postgres.sql'), 'utf8')
    );
    const mysqlSchema = normalizeSql(
      fs.readFileSync(path.join(repositoryRoot, 'init-db-mysql.sql'), 'utf8')
    );

    for (const schema of [postgresSchema, mysqlSchema]) {
      expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS market_transaction_audit_logs/i);
      expect(schema).toContain('current_bidder_id');
      expect(schema).toContain('listing_updated_at');
      expect(schema).toContain('recorded_at');
    }
  });
});
