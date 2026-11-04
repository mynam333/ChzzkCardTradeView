import { describe, expect, it, vi } from 'vitest';
import { createOwnedStreamerProfilesLoader } from '../services/ownedStreamerProfilesService';

const profile = (channelId: string) => ({ channel_id: channelId, name: channelId }) as any;

describe('owned streamer profile cache', () => {
  it('coalesces concurrent requests for the same user without sharing across users', async () => {
    const resolvers = new Map<string, (value: any[]) => void>();
    const loadProfiles = vi.fn((userId: string) => new Promise<any[]>((resolve) => {
      resolvers.set(userId, resolve);
    }));
    const loader = createOwnedStreamerProfilesLoader(loadProfiles);

    const first = loader.load('user-a');
    const concurrent = loader.load('user-a');
    const otherUser = loader.load('user-b');
    expect(loadProfiles).toHaveBeenCalledTimes(2);

    resolvers.get('user-a')?.([profile('channel-a')]);
    resolvers.get('user-b')?.([profile('channel-b')]);
    await expect(first).resolves.toEqual([profile('channel-a')]);
    await expect(concurrent).resolves.toEqual([profile('channel-a')]);
    await expect(otherUser).resolves.toEqual([profile('channel-b')]);
  });

  it('keeps a user-bound result for ten seconds and refreshes after expiry', async () => {
    let now = 1_000;
    const loadProfiles = vi.fn(async (userId: string) => [profile(`${userId}-${loadProfiles.mock.calls.length}`)]);
    const loader = createOwnedStreamerProfilesLoader(loadProfiles, { now: () => now, ttlMs: 10_000 });

    await expect(loader.load('user-a')).resolves.toEqual([profile('user-a-1')]);
    now = 10_999;
    await expect(loader.load('user-a')).resolves.toEqual([profile('user-a-1')]);
    expect(loadProfiles).toHaveBeenCalledTimes(1);

    now = 11_000;
    await expect(loader.load('user-a')).resolves.toEqual([profile('user-a-2')]);
    expect(loadProfiles).toHaveBeenCalledTimes(2);
  });

  it('bounds cached user entries and evicts the oldest result', async () => {
    const loadProfiles = vi.fn(async (userId: string) => [profile(userId)]);
    const loader = createOwnedStreamerProfilesLoader(loadProfiles, { maxEntries: 2 });

    await loader.load('user-a');
    await loader.load('user-b');
    await loader.load('user-c');
    await loader.load('user-a');

    expect(loadProfiles).toHaveBeenCalledTimes(4);
  });
});

