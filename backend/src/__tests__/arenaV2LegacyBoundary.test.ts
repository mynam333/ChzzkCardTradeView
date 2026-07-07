import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const v2Files = [
  '../services/arenaV2Engine.ts',
  '../services/arenaV2SchemaMigration.ts',
  '../services/arenaV2Service.ts',
  '../controllers/arenaV2Controller.ts'
];

const forbiddenSnippets = [
  '../services/arenaRules',
  '../services/arenaBattleSimulator',
  '../services/arenaMatchService',
  '../services/arenaDeckService',
  '../services/arenaMatchmakingService',
  '../services/arenaCupService',
  'best_of_five',
  'round_plans',
  'ARENA_TACTIC_CHIPS',
  'ARENA_ROUNDS_TO_WIN',
  'ARENA_MATCH_FORMAT'
];

describe('arena v2 legacy boundary', () => {
  it('keeps v2 implementation independent from legacy arena services and concepts', () => {
    for (const file of v2Files) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      for (const forbidden of forbiddenSnippets) {
        expect(source, `${file} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
