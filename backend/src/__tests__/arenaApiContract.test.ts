import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const apiSource = readFileSync(resolve(__dirname, '../routes/api.ts'), 'utf8');
const finalContract = readFileSync(resolve(__dirname, '../../../game_docs/19-arena-api-final-contract.md'), 'utf8');

const expectedArenaRoutes = [
  "router.get('/arena/rules/catalog'",
  "router.get('/arena/cards/owned'",
  "router.get('/arena/cosmetics/shop-items'",
  "router.get('/arena/cosmetics/loadout'",
  "router.patch('/arena/cosmetics/loadout'",
  "router.post('/arena/cosmetics/buy'",
  "router.get('/arena/matches/recent'",
  "router.post('/arena/cups/join'",
  "router.post('/arena/cups/queue/join'",
  "router.post('/arena/cups/cancel'",
  "router.post('/arena/cups/queue/cancel'",
  "router.post('/arena/matches/:match_id/share'",
  "router.get('/arena/spectator/share/:token'",
  "router.patch('/admin/arena/restrictions/:type/:id'",
  "router.get('/admin/arena/audit-logs'",
  "router.get('/admin/arena/stats'",
  "router.get('/admin/arena/stats/overview'",
  "router.get('/admin/arena/stats/balance'"
];

const expectedContractLines = [
  'GET /api/arena/rules/catalog',
  'GET /api/arena/cards/owned',
  'GET   /api/arena/cosmetics/shop-items',
  'GET   /api/arena/cosmetics/loadout',
  'PATCH /api/arena/cosmetics/loadout',
  'POST  /api/arena/cosmetics/buy',
  'GET /api/arena/matches/recent',
  'POST /api/arena/cups/join',
  'POST /api/arena/cups/queue/join',
  'POST /api/arena/cups/cancel',
  'POST /api/arena/cups/queue/cancel',
  'POST /api/arena/matches/{match_id}/share',
  'GET /api/arena/spectator/share/{token}',
  'PATCH /api/admin/arena/restrictions/{type}/{id}',
  'GET   /api/admin/arena/audit-logs',
  'GET   /api/admin/arena/stats',
  'GET   /api/admin/arena/stats/overview',
  'GET   /api/admin/arena/stats/balance'
];

describe('arena API contract', () => {
  it('keeps implemented arena routes wired', () => {
    for (const route of expectedArenaRoutes) {
      expect(apiSource).toContain(route);
    }
  });

  it('keeps the final contract document aligned with implemented routes', () => {
    for (const line of expectedContractLines) {
      expect(finalContract).toContain(line);
    }
  });

  it('does not reintroduce removed strategy features into the final contract', () => {
    expect(finalContract).not.toContain('조건부 플랜');
    expect(finalContract).toContain('시즌 로테이션 카드 풀 기능 추가 금지');
  });
});
