import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getWeeklyMissions: vi.fn(),
  claimWeeklyMission: vi.fn()
}));

vi.mock('../services/weeklyMissionService', () => mocks);

const response = () => ({
  statusCode: 200,
  body: undefined as any,
  headers: {} as Record<string, string>,
  status(code: number) { this.statusCode = code; return this; },
  set(name: string, value: string) { this.headers[name] = value; return this; },
  json(body: unknown) { this.body = body; return this; }
});

const payload = {
  week_key: '2026-11-16',
  starts_at: '2026-11-15T15:00:00.000Z',
  ends_at: '2026-11-22T15:00:00.000Z',
  server_now: '2026-11-18T03:00:00.000Z',
  missions: [],
  summary: { completed: 0, claimed: 0, total: 5 }
};

describe('weekly mission controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires authentication before loading assignments', async () => {
    const { getMyWeeklyMissions } = await import('../controllers/weeklyMissionController');
    const res = response();
    await getMyWeeklyMissions({} as any, res as any);
    expect(res.statusCode).toBe(401);
    expect(mocks.getWeeklyMissions).not.toHaveBeenCalled();
  });

  it('returns private no-store mission state', async () => {
    mocks.getWeeklyMissions.mockResolvedValue(payload);
    const { getMyWeeklyMissions } = await import('../controllers/weeklyMissionController');
    const res = response();
    await getMyWeeklyMissions({ user: { id: 'user' } } as any, res as any);
    expect(mocks.getWeeklyMissions).toHaveBeenCalledWith('user');
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.body).toEqual(payload);
  });

  it('validates the assignment id and authoritative week key', async () => {
    const { claimMyWeeklyMission } = await import('../controllers/weeklyMissionController');
    const res = response();
    await claimMyWeeklyMission({ user: { id: 'user' }, params: { id: '0' }, body: { week_key: 'bad' } } as any, res as any);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
    expect(mocks.claimWeeklyMission).not.toHaveBeenCalled();
  });

  it.each([
    ['WEEK_CHANGED', 409],
    ['NOT_COMPLETED', 409],
    ['NOT_FOUND', 404]
  ] as const)('maps %s claim failures without leaking state', async (reason, status) => {
    mocks.claimWeeklyMission.mockResolvedValue({ ok: false, reason });
    const { claimMyWeeklyMission } = await import('../controllers/weeklyMissionController');
    const res = response();
    await claimMyWeeklyMission({ user: { id: 'user' }, params: { id: '12' }, body: { week_key: '2026-11-16' } } as any, res as any);
    expect(res.statusCode).toBe(status);
    expect(res.body).toMatchObject({ error: 'WeeklyMissionNotClaimable', code: reason });
  });

  it('returns the full fresh payload for an idempotent successful claim', async () => {
    mocks.claimWeeklyMission.mockResolvedValue({ ok: true, payload: { ...payload, claim_result: { mission_id: 12, already_claimed: true, awarded: { points: 0, minigame_tickets: 0, free_draw_tickets: 0 }, new_points: 10000 } } });
    const { claimMyWeeklyMission } = await import('../controllers/weeklyMissionController');
    const res = response();
    await claimMyWeeklyMission({ user: { id: 'user' }, params: { id: '12' }, body: { week_key: '2026-11-16' } } as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(res.body.claim_result).toMatchObject({ already_claimed: true, awarded: { points: 0 } });
  });
});
