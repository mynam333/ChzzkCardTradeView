import { Request, Response } from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getResetInfo, resetData } from '../controllers/adminMaintenanceController';
import { initRepositories, minigameRepository } from '../repositories';
import { __setSqliteDbForTest } from '../services/db';

const createResponse = () => {
  const response = {
    status: vi.fn(),
    json: vi.fn()
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response;
};

const getJsonBody = (response: Response) =>
  vi.mocked(response.json).mock.calls[0]?.[0];

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '../../../init-db.sql'), 'utf8'));
  __setSqliteDbForTest(db);
  initRepositories();

  db.prepare("INSERT INTO users (id, username, role, point) VALUES ('u1', 'user1', 'USER', 1000)").run();
  db.prepare(`
    INSERT INTO user_minigame_tickets
      (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
    VALUES ('u1', 2, 7, datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT INTO minigame_sessions
      (id, user_id, game_type, status, target_data, earned_points)
    VALUES ('session-1', 'u1', 'HIGHER_LOWER', 'COMPLETED', '{}', 300)
  `).run();
});

describe('admin maintenance minigame reset', () => {
  it('reports the combined ticket and session record count', async () => {
    const response = createResponse();

    await getResetInfo({} as Request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    const categories = getJsonBody(response) as Array<{ id: string; count: number }>;
    expect(categories.find((category) => category.id === 'minigames')).toEqual(
      expect.objectContaining({ count: 2 })
    );
  });

  it('deletes all minigame sessions and ticket state without deleting users', async () => {
    const response = createResponse();
    const request = {
      body: {
        categories: ['minigames'],
        confirmation: 'RESET'
      }
    } as Request;

    await resetData(request, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM minigame_sessions').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM user_minigame_tickets').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT point FROM users WHERE id = ?').get('u1')).toEqual({ point: 1000 });

    const recreated = await minigameRepository.getTicketStatus('u1');
    expect(recreated.current_tickets).toBe(5);
    expect(recreated.bonus_tickets).toBe(0);
  });
});
