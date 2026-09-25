import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { __setSqliteDbForTest } from '../services/db';
import { initRepositories, minigameRepository } from '../repositories';
import { getDailyMinigame, markMinigameRequestTime, playMinigameAction, startMinigame, submitMinigameResult } from '../controllers/minigameController';
import { ACTION_GAMES, ActionGameType, ActionInput, ActionTarget, initialActionState, readActionState } from '../services/actionMinigames';
import { AuthenticatedRequest } from '../middlewares/admin';
import { Response } from 'express';

vi.mock('../services/achievementService', () => ({ recordAchievementEvent: vi.fn(async () => undefined) }));
let db: Database.Database;
const request = (body: unknown, userId = 'player') => ({ user: { id: userId }, body }) as AuthenticatedRequest;
const response = () => {
  const res = { locals: {} as Record<string, unknown>, statusCode: 0, body: undefined as any, status(code: number) { this.statusCode = code; return this; }, json(value: unknown) { this.body = value; return this; } };
  return res;
};
const asResponse = (res: ReturnType<typeof response>) => res as unknown as Response;
const setDay = (type: ActionGameType) => {
  const date = Array.from({ length: 60 }, (_, day) => Date.UTC(2026, 8, 1 + day)).find(time => getDailyMinigame(time).game_type === type)!;
  vi.setSystemTime(date);
};
async function start(type: ActionGameType, practice = false) {
  setDay(type);
  const res = response();
  await startMinigame(request({ game_type: type, practice_mode: practice }), asResponse(res));
  expect(res.statusCode).toBe(200);
  return res.body as { session_id: string; game_data: ReturnType<typeof import('../services/actionMinigames').publicActionGame> };
}
async function action(sessionId: string, input: ActionInput, requestId = crypto.randomUUID(), revision?: number, userId = 'player') {
  const session = await minigameRepository.findSessionById(sessionId);
  const res = response();
  await playMinigameAction(request({ session_id: sessionId, revision: revision ?? session!.progress_revision, request_id: requestId, action: input }, userId), asResponse(res));
  return res;
}
async function submit(sessionId: string, payload: unknown = {}) {
  const res = response();
  await submitMinigameResult(request({ session_id: sessionId, payload }), asResponse(res));
  return res;
}
async function fixedCatchFrames(sessionId: string) {
  const session = await minigameRepository.findSessionById(sessionId);
  const target = JSON.parse(session!.target_data);
  target.frames = [
    { start: 0, duration: 1000, cells: [{ cell: 0, card: 0 }] },
    { start: 100, duration: 1100, cells: [{ cell: 1, card: 1 }] }
  ];
  db.prepare('UPDATE minigame_sessions SET target_data = ? WHERE id = ?').run(JSON.stringify(target), sessionId);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 8, 1));
  db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '../../../init-db.sql'), 'utf8'));
  db.exec('CREATE TABLE IF NOT EXISTS user_image_blinds (user_id TEXT, image_key TEXT, image_url TEXT, created_at TEXT)');
  __setSqliteDbForTest(db);
  initRepositories();
  db.prepare("INSERT INTO users (id, username, role, point) VALUES ('player', '테스트', 'USER', 5000)").run();
  for (let i = 0; i < 8; i++) {
    db.prepare('INSERT INTO streamers (channel_id, name, logo_url, follower_count, base_value, is_active) VALUES (?, ?, ?, 1000, 1000, 1)')
      .run(`streamer-${i}`, `스트리머 ${i}`, `https://example.com/${i}.png`);
  }
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('new minigame API and SQLite settlement', () => {
  it('merges a final sort flush with a slow earlier batch and deduplicates it after settlement', async () => {
    const { session_id } = await start('fan_meeting');
    const armed = await action(session_id, { kind: 'ready', quick_start: true });
    const target = JSON.parse((await minigameRepository.findSessionById(session_id))!.target_data) as ActionTarget;
    vi.setSystemTime(armed.body.game_data.state.ends_at + 100);
    const short: ActionInput = { kind: 'sort', offset: 0, values: target.deck.slice(0, 12) };
    const full: ActionInput = { kind: 'sort', offset: 0, values: target.deck.slice(0, 25) };
    const responses = await Promise.all([action(session_id, full, crypto.randomUUID(), 1), action(session_id, short, crypto.randomUUID(), 1)]);
    expect(responses.every(res => res.statusCode === 200)).toBe(true);
    expect(readActionState((await minigameRepository.findSessionById(session_id))!.progress_data)).toMatchObject({ correct: 25, index: 25 });
    vi.setSystemTime(armed.body.game_data.state.ends_at + 1000);
    expect((await submit(session_id)).body.earned_points).toBe(1200);
    const retry = await action(session_id, short, crypto.randomUUID(), 1);
    expect(retry.statusCode).toBe(200);
    expect(retry.body.game_data.state.correct).toBe(25);
    expect((await action(session_id, { ...short, values: [1 - target.deck[0]] }, crypto.randomUUID(), 1)).statusCode).toBe(409);
  });
  it('saves rapid batches exactly once across lost responses, overlapping prefixes and settlement', async () => {
    const { session_id } = await start('fan_meeting');
    const armed = await action(session_id, { kind: 'ready', quick_start: true });
    expect(armed.body.game_data.state.starts_at).toBe(Date.now());
    const target = JSON.parse((await minigameRepository.findSessionById(session_id))!.target_data) as ActionTarget;
    const requestId = crypto.randomUUID();
    const input: ActionInput = { kind: 'sort', offset: 0, values: target.deck.slice(0, 12) };
    const first = await action(session_id, input, requestId, 1);
    const retry = await action(session_id, input, requestId, 1);
    expect(first.statusCode).toBe(200);
    expect(retry.body.game_data).toMatchObject({ revision: 2, state: { correct: 12, input_count: 12 } });
    expect((await action(session_id, { ...input, values: [1 - target.deck[0]] }, requestId, 1)).statusCode).toBe(409);
    const next = await action(session_id, { kind: 'sort', offset: 8, values: target.deck.slice(8, 25) });
    expect(next.body.game_data.state).toMatchObject({ correct: 25, input_count: 25 });
    expect((await action(session_id, { kind: 'sort', offset: 27, values: [0] })).statusCode).toBe(400);
    vi.setSystemTime(armed.body.game_data.state.ends_at + 1000);
    expect((await submit(session_id)).body).toMatchObject({ earned_points: 1200 });
    expect((await submit(session_id)).body).toMatchObject({ earned_points: 1200 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM point_ledger_entries WHERE source_type = 'minigame' AND source_id = ?").get(session_id)).toEqual({ count: 1 });
  });

  it('accepts rapid relay inputs through all five stages without a per-card network turn', async () => {
    const { session_id } = await start('sequence_relay');
    let view = (await action(session_id, { kind: 'ready', quick_start: true })).body.game_data;
    for (let stage = 0; stage < 5; stage++) {
      vi.setSystemTime(view.state.input_at);
      const next = await action(session_id, { kind: 'sequence', offset: view.state.input_count, values: view.sequence });
      expect(next.statusCode).toBe(200);
      view = next.body.game_data;
      expect(view.state.cleared).toBe(stage + 1);
    }
    expect(view.state.input_count).toBe(30);
    expect((await submit(session_id)).body).toMatchObject({ earned_points: 1200 });
  });
  it.each(ACTION_GAMES)('starts %s without a timer, resumes without another ticket and arms after images are ready', async type => {
    const issued = await start(type);
    expect(issued.game_data.state.starts_at).toBeNull();
    const resumed = await start(type);
    expect(resumed.session_id).toBe(issued.session_id);
    expect((await minigameRepository.getTicketStatus('player')).current_tickets).toBe(4);
    vi.setSystemTime(Date.now() + 45_000);
    const armed = await action(issued.session_id, { kind: 'ready' });
    expect(armed.statusCode).toBe(200);
    expect(armed.body.game_data.state.starts_at).toBe(Date.now() + 3000);
    const session = await minigameRepository.findSessionById(issued.session_id);
    expect(new Date(session!.expires_at!).getTime()).toBe(armed.body.game_data.state.ends_at + 60_000);
    const replay = await action(issued.session_id, { kind: 'ready' });
    expect(replay.body.game_data.state.starts_at).toBe(armed.body.game_data.state.starts_at);
  });

  it('serializes concurrent actions, supports identical retries and rejects replayed or foreign actions', async () => {
    const { session_id } = await start('fan_meeting');
    const id = crypto.randomUUID();
    const first = await action(session_id, { kind: 'ready' }, id);
    const replay = await action(session_id, { kind: 'ready' }, id, 0);
    expect(replay.statusCode).toBe(200);
    expect(replay.body.game_data.revision).toBe(1);
    expect((await action(session_id, { kind: 'sort', value: 0 }, id)).statusCode).toBe(409);
    expect((await action(session_id, { kind: 'ready' }, crypto.randomUUID(), 1, 'other')).statusCode).toBe(403);
    vi.setSystemTime(first.body.game_data.state.starts_at + 100);
    const target = JSON.parse((await minigameRepository.findSessionById(session_id))!.target_data) as ActionTarget;
    const results = await Promise.all([
      action(session_id, { kind: 'sort', value: target.deck[0] }, crypto.randomUUID(), 1),
      action(session_id, { kind: 'sort', value: target.deck[0] }, crypto.randomUUID(), 1)
    ]);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
    const session = await minigameRepository.findSessionById(session_id);
    expect(readActionState(session!.progress_data).correct).toBe(1);
    const stale = await action(session_id, { kind: 'sort', value: 0 }, crypto.randomUUID(), 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.body.game_data.revision).toBe(2);
  });

  it('settles a perfect fan game exactly once and ignores forged result payloads', async () => {
    const { session_id } = await start('fan_meeting');
    const armed = await action(session_id, { kind: 'ready' });
    const state = armed.body.game_data.state;
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(state.starts_at + i * 500);
      const session = await minigameRepository.findSessionById(session_id);
      const target = JSON.parse(session!.target_data) as ActionTarget;
      expect((await action(session_id, { kind: 'sort', value: target.deck[i] })).statusCode).toBe(200);
    }
    expect((await submit(session_id, { success: true, points: 1200 })).statusCode).toBe(409);
    vi.setSystemTime(state.ends_at + 300);
    const results = await Promise.all([submit(session_id, { correct: 0 }), submit(session_id, { earned_points: 99999 })]);
    expect(results.some(result => result.statusCode === 200 && result.body.earned_points === 1200)).toBe(true);
    const retry = await submit(session_id, { success: false });
    expect(retry.body).toMatchObject({ correct: true, earned_points: 1200, new_balance: 6200 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM point_ledger_entries WHERE source_type = 'minigame' AND source_id = ?").get(session_id)).toEqual({ count: 1 });
    const saved = await minigameRepository.findSessionById(session_id);
    expect(await minigameRepository.saveActionProgress(session_id, 'player', saved!.progress_revision!, '{}')).toBe(false);
  });

  it('keeps the catch bonus for all twelve accepted target clicks', async () => {
    const { session_id } = await start('streamer_catch');
    const armed = await action(session_id, { kind: 'ready' });
    const { frames, state } = armed.body.game_data;
    expect(armed.body.game_data.target_count).toBe(12);
    for (const [frame, value] of frames.entries()) {
      const target = value.cells.find((cell: { card: number }) => cell.card === 0);
      if (!target) continue;
      vi.setSystemTime(state.starts_at + value.start + 100);
      expect((await action(session_id, { kind: 'catch', frame, value: target.cell })).statusCode).toBe(200);
    }
    vi.setSystemTime(state.ends_at + 300);
    expect((await submit(session_id)).body).toMatchObject({ correct: true, earned_points: 1200 });
  });

  it('judges a catch when the request arrives, even if the session lookup is slow', async () => {
    const { session_id } = await start('streamer_catch');
    const armed = await action(session_id, { kind: 'ready' });
    const { frames, state, revision } = armed.body.game_data;
    const frame = frames.findIndex((item: any) => item.cells.some((cell: any) => cell.card === 0));
    const cell = frames[frame].cells.find((item: any) => item.card === 0).cell;
    const receivedAt = state.starts_at + frames[frame].start + frames[frame].duration - 50;
    vi.setSystemTime(receivedAt);
    const find = minigameRepository.findSessionById.bind(minigameRepository);
    vi.spyOn(minigameRepository, 'findSessionById').mockImplementationOnce(async id => {
      vi.setSystemTime(receivedAt + 900);
      return find(id);
    });
    const res = response();
    await playMinigameAction(request({ session_id, revision, request_id: crypto.randomUUID(), action: { kind: 'catch', frame, value: cell } }), asResponse(res));
    expect(res.statusCode).toBe(200);
    expect(res.body.game_data.state.correct).toBe(1);
    expect(res.body.game_data.server_received_at).toBe(receivedAt);
    expect(res.body.game_data.server_now).toBe(Date.now());
  });

  it('accepts overlapping catch requests and keeps retried cells idempotent after later inputs', async () => {
    const { session_id } = await start('streamer_catch');
    await fixedCatchFrames(session_id);
    const armed = await action(session_id, { kind: 'ready' });
    const { frames, state, revision } = armed.body.game_data;
    const frame = frames.findIndex((item: any) => item.cells.some((cell: any) => cell.card === 0));
    const target = frames[frame].cells.find((item: any) => item.card === 0).cell;
    const other = frames[1].cells[0].cell;
    vi.setSystemTime(state.starts_at + frames[frame].start + 200);
    const id = crypto.randomUUID();
    const results = await Promise.all([
      action(session_id, { kind: 'catch', frame, value: target }, id, revision),
      action(session_id, { kind: 'catch', frame: 1, value: other }, crypto.randomUUID(), revision)
    ]);
    expect(results.map(result => result.statusCode)).toEqual([200, 200]);
    expect(readActionState((await minigameRepository.findSessionById(session_id))!.progress_data)).toMatchObject({ correct: 1, mistakes: 1 });
    vi.setSystemTime(state.starts_at + frames[frame].start + frames[frame].duration + 2000);
    const retry = await action(session_id, { kind: 'catch', frame, value: target }, id, revision);
    expect(retry.statusCode).toBe(200);
    expect(retry.body.game_data.state).toMatchObject({ correct: 1, mistakes: 1 });
    expect(retry.body.game_data.revision).toBe(revision + 2);
  });

  it('uses the receipt before middleware delay and never trusts a timestamp from the client', async () => {
    const { session_id } = await start('streamer_catch');
    await fixedCatchFrames(session_id);
    const armed = await action(session_id, { kind: 'ready' });
    const { frames, state, revision } = armed.body.game_data;
    const frame = frames.findIndex((item: any) => item.cells.some((cell: any) => cell.card === 0));
    const value = frames[frame].cells.find((item: any) => item.card === 0).cell;
    const at = state.starts_at + frames[frame].start;
    vi.setSystemTime(at + 100);
    const req = request({ session_id, revision, request_id: crypto.randomUUID(), received_at: 0, action: { kind: 'catch', frame, value, clicked_at: 0 } });
    const res = response();
    markMinigameRequestTime(req, asResponse(res), vi.fn());
    vi.setSystemTime(at + 2000);
    await playMinigameAction(req, asResponse(res));
    expect(res.statusCode).toBe(200);
    expect(res.body.game_data).toMatchObject({ server_received_at: at + 100, state: { correct: 1 } });
    const unclicked = frames[1].cells[0].cell;
    const expired = response();
    await playMinigameAction(request({ session_id, revision: revision + 1, request_id: crypto.randomUUID(), received_at: at + 100, action: { kind: 'catch', frame: 1, value: unclicked, clicked_at: at + 100 } }), asResponse(expired));
    expect(expired.statusCode).toBe(400);
    expect(expired.body.game_data.state).toMatchObject({ correct: 1, mistakes: 0 });
  });

  it('counts simultaneous duplicate catches only once and rejects a future revision', async () => {
    const { session_id } = await start('streamer_catch');
    const armed = await action(session_id, { kind: 'ready' });
    const { frames, state, revision } = armed.body.game_data;
    const frame = frames.findIndex((item: any) => item.cells.some((cell: any) => cell.card === 0));
    const value = frames[frame].cells.find((item: any) => item.card === 0).cell;
    vi.setSystemTime(state.starts_at + frames[frame].start + 100);
    const input = { kind: 'catch' as const, frame, value };
    expect((await action(session_id, input, crypto.randomUUID(), revision + 10)).statusCode).toBe(409);
    const results = await Promise.all([action(session_id, input), action(session_id, input)]);
    for (const res of results) {
      expect(res.statusCode).toBe(200);
      expect(res.body.game_data.state.correct).toBe(1);
      expect(res.body.game_data.revision).toBe(revision + 1);
    }
  });

  it.each(ACTION_GAMES)('%s cannot award points from a forged success or practice payload', async type => {
    const { session_id } = await start(type, true);
    expect(db.prepare('SELECT * FROM user_minigame_tickets').all()).toEqual([]);
    const armed = await action(session_id, { kind: 'ready' });
    vi.setSystemTime(armed.body.game_data.state.ends_at + 300);
    const result = await submit(session_id, { success: true, correct: 100, cleared: 5, earned_points: 1200, practice_mode: false });
    expect(result.body).toMatchObject({ correct: false, practice_mode: true, earned_points: 0 });
    expect(db.prepare("SELECT point FROM users WHERE id = 'player'").get()).toEqual({ point: 5000 });
  });

  it('keeps the full relay window after delayed preparation and preserves the stage-four reward', async () => {
    const { session_id } = await start('sequence_relay');
    vi.setSystemTime(Date.now() + 120_000);
    const armed = await action(session_id, { kind: 'ready' });
    const target = JSON.parse((await minigameRepository.findSessionById(session_id))!.target_data) as ActionTarget;
    let view = armed.body.game_data;
    for (let stage = 0; stage < 4; stage++) {
      for (const [i, value] of target.sequences[stage].entries()) {
        vi.setSystemTime(view.state.input_at + 100 + i * 200);
        const next = await action(session_id, { kind: 'sequence', value });
        expect(next.statusCode).toBe(200);
        view = next.body.game_data;
      }
    }
    vi.setSystemTime(armed.body.game_data.state.starts_at + 60_000);
    await minigameRepository.expireSessions(3);
    expect((await minigameRepository.findSessionById(session_id))!.status).toBe('STARTED');
    for (let mistake = 0; mistake < 2; mistake++) {
      vi.setSystemTime(Math.max(Date.now(), view.state.input_at) + 100);
      view = (await action(session_id, { kind: 'sequence', value: (target.sequences[4][0] + 1) % 4 })).body.game_data;
    }
    expect((await submit(session_id)).body).toMatchObject({ correct: true, earned_points: 1000 });
  });

  it('does not let stale revisions, expired sessions or a foreign user overwrite progress', async () => {
    const { session_id } = await start('fan_meeting');
    const data = JSON.stringify({ action: initialActionState() });
    expect(await minigameRepository.saveActionProgress(session_id, 'other', 0, data)).toBe(false);
    expect(await minigameRepository.saveActionProgress(session_id, 'player', 5, data)).toBe(false);
    const stored = await minigameRepository.findSessionById(session_id);
    vi.setSystemTime(new Date(stored!.expires_at!).getTime() + 1000);
    expect(await minigameRepository.saveActionProgress(session_id, 'player', 0, data)).toBe(false);
    await minigameRepository.expireSessions(3);
    expect((await minigameRepository.findSessionById(session_id))!.status).toBe('EXPIRED');
  });
});
