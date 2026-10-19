import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(__dirname, '../../..');
const readSchema = (filename: string) => fs.readFileSync(path.join(repositoryRoot, filename), 'utf8');

describe('minigame reward schema contract', () => {
  it('seeds one atomic default reward pair for every supported database', () => {
    for (const filename of ['init-db.sql', 'init-db-mysql.sql', 'init-db-postgres.sql']) {
      const schema = readSchema(filename);
      expect(schema).toContain('minigame_reward_config');
      expect(schema).toContain('{"success_points":1000,"bonus_points":200}');
    }
  });

  it('validates PostgreSQL settlement against the session snapshot instead of a fixed allowlist', () => {
    const schema = readSchema('init-db-postgres.sql');
    const functionStart = schema.indexOf('CREATE OR REPLACE FUNCTION complete_minigame_session_authoritative_atomic');
    const functionEnd = schema.indexOf('$$ LANGUAGE plpgsql SECURITY INVOKER;', functionStart);
    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);
    const body = schema.slice(functionStart, functionEnd);

    expect(body).toContain("target_json -> 'reward_config'");
    expect(body).toContain('success_reward_points + bonus_reward_points');
    expect(body).toContain("'INVALID_REWARD_POLICY'");
    expect(body).not.toMatch(/p_earned_points\s+NOT\s+IN\s*\(\s*0\s*,\s*1000\s*,\s*1200\s*\)/i);
  });
});
