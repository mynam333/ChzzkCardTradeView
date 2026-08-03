import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ensureMysqlLongTextColumn } from '../services/db';

const migrationResult = {
  changes: 0,
  affectedRows: 0,
  insertId: 0,
  lastInsertRowid: 0
};

describe('shop item style storage capacity', () => {
  it('defines MySQL style_json as LONGTEXT for new installations', () => {
    const repositoryRoot = path.resolve(__dirname, '../../..');
    const schema = fs.readFileSync(path.join(repositoryRoot, 'init-db-mysql.sql'), 'utf8');

    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS shop_items[\s\S]*?style_json\s+LONGTEXT/i);
  });

  it('upgrades an existing smaller MySQL text column once', async () => {
    const get = vi.fn().mockResolvedValue({ data_type: 'mediumtext' });
    const run = vi.fn().mockResolvedValue(migrationResult);

    await ensureMysqlLongTextColumn({ get, run } as any, 'shop_items', 'style_json');

    expect(run).toHaveBeenCalledTimes(1);
    expect(String(run.mock.calls[0][0]).replace(/\s+/g, ' ').trim()).toBe(
      'ALTER TABLE shop_items MODIFY COLUMN style_json LONGTEXT NULL'
    );
  });

  it('leaves an existing LONGTEXT column untouched', async () => {
    const get = vi.fn().mockResolvedValue({ data_type: 'LONGTEXT' });
    const run = vi.fn().mockResolvedValue(migrationResult);

    await ensureMysqlLongTextColumn({ get, run } as any, 'shop_items', 'style_json');

    expect(run).not.toHaveBeenCalled();
  });
});
