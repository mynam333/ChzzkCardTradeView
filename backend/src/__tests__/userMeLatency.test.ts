import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'session-owner', username: 'stored profile', avatar_url: '/stored.png', point: 1000, role: 'USER' },
  findById: vi.fn(), syncTickets: vi.fn(), subscriptionSync: vi.fn(), getToken: vi.fn(), achievement: vi.fn()
}));
vi.mock('../repositories', () => ({
  userRepository: { findById: mocks.findById, syncFreeDrawTickets: mocks.syncTickets, findDeletedAccount: async () => null },
  systemConfigRepository: { get: async (_key: string, fallback: string) => fallback },
  titleRepository: { findByUserId: async () => [{ id: 1, is_equipped: true, name: 'stored title' }] }
}));
vi.mock('../services/chzzkService', () => ({ getValidUserAccessToken: mocks.getToken }));
vi.mock('../services/subscriptionTitleService', () => ({ syncUserSubscriptionTitles: mocks.subscriptionSync }));
vi.mock('../services/achievementService', () => ({ recordAchievementEvent: mocks.achievement }));
vi.mock('../controllers/tradeController', () => ({}));

import { getUserMe } from '../controllers/playController';

describe('session response latency', () => {
  it('returns stored identity and current tickets while external lookups are still pending', async () => {
    let releaseToken!: (value: undefined) => void;
    let releaseTitles!: () => void;
    mocks.getToken.mockReturnValue(new Promise(resolve => { releaseToken = resolve; }));
    mocks.subscriptionSync.mockReturnValue(new Promise<void>(resolve => { releaseTitles = resolve; }));
    mocks.findById.mockResolvedValue({ ...mocks.user });
    mocks.syncTickets.mockResolvedValue({ ...mocks.user, free_draw_tickets: 2, bonus_free_draw_tickets: 3 });
    mocks.achievement.mockResolvedValue(undefined);
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };
    try {
      await getUserMe({ user: { id: mocks.user.id } } as any, response as any);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({
        username: 'stored profile', avatarUrl: '/stored.png', point: 1000,
        freeDrawTickets: 2, bonusFreeDrawTickets: 3,
        ownedTitles: [{ id: 1, is_equipped: true, name: 'stored title' }]
      }));
      expect(mocks.getToken).toHaveBeenCalledOnce();
      expect(mocks.subscriptionSync).toHaveBeenCalledOnce();
      expect(mocks.findById).toHaveBeenCalledOnce();
    } finally {
      releaseToken(undefined);
      releaseTitles();
      for (let i = 0; i < 15; i++) await Promise.resolve();
    }
  });

  it('keeps the concurrency slot until a slow profile settles even if title synchronization fails', async () => {
    vi.clearAllMocks();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const releases: Array<(value: undefined) => void> = [];
    mocks.getToken.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
    mocks.subscriptionSync.mockRejectedValue(new Error('temporary title database error'));
    mocks.findById.mockImplementation(async (id) => ({ ...mocks.user, id }));
    mocks.syncTickets.mockResolvedValue({ ...mocks.user });
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    try {
      await Promise.all(['slow-a', 'slow-b', 'slow-c'].map(id =>
        getUserMe({ user: { id } } as any, response as any)));
      expect(mocks.getToken).toHaveBeenCalledTimes(2);
      releases[0](undefined);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(mocks.getToken).toHaveBeenCalledTimes(3);
    } finally {
      releases.forEach(release => release(undefined));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      warning.mockRestore();
    }
  });
});
