import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensurePostgresCompatibilityMigrations } from '../services/db';
import type { PostgresDb } from '../services/postgresDb';

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const catalogColumns = [
  'listed_at',
  'sale_start_at',
  'sale_end_at',
  'limited_total_quantity',
  'sold_quantity'
];

describe('shop catalog PostgreSQL schema readiness', () => {
  it('defines every catalog availability column and index in the bootstrap schema', () => {
    const repositoryRoot = path.resolve(__dirname, '../../..');
    const schema = fs.readFileSync(path.join(repositoryRoot, 'init-db-postgres.sql'), 'utf8');
    const table = schema.match(/CREATE TABLE IF NOT EXISTS shop_items\s*\([\s\S]*?\n\);/i)?.[0] || '';

    for (const column of catalogColumns) expect(table).toContain(column);
    expect(schema).toContain('idx_shop_items_active_listed');
    expect(schema).toContain('idx_shop_items_limited_sale');
    expect(schema).toMatch(/UPDATE shop_items SET listed_at = COALESCE\(created_at, NOW\(\)\) WHERE active = TRUE AND listed_at IS NULL/i);
  });

  it('backfills an existing PostgreSQL database during startup migration', async () => {
    const run = vi.fn().mockResolvedValue({
      changes: 0,
      affectedRows: 0,
      insertId: 0,
      lastInsertRowid: 0
    });

    await ensurePostgresCompatibilityMigrations({ run } as unknown as PostgresDb);

    const statements = run.mock.calls.map(([sql]) => normalizeSql(String(sql)));
    const alter = statements.find((sql) => sql.startsWith('ALTER TABLE shop_items')) || '';
    for (const column of catalogColumns) expect(alter).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    expect(statements).toContain(
      'UPDATE shop_items SET listed_at = COALESCE(created_at, NOW()) WHERE active = TRUE AND listed_at IS NULL'
    );
    expect(statements).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shop_items_active_listed ON shop_items (active, listed_at DESC, id DESC)'
    );
  });
});
