import type { Streamer } from '../repositories/interfaces';
import { streamerRepository } from '../repositories';
import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';

const PROFILE_CACHE_TTL_MS = 10_000;
const PROFILE_CACHE_MAX_USERS = 500;
const SUPABASE_PAGE_SIZE = 1_000;
const SUPABASE_STREAMER_BATCH_SIZE = 100;
const SQL_STREAMER_BATCH_SIZE = 900;

type ProfileLoader = (userId: string) => Promise<Streamer[]>;

export const createOwnedStreamerProfilesLoader = (
  loadProfiles: ProfileLoader,
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}
) => {
  const ttlMs = options.ttlMs ?? PROFILE_CACHE_TTL_MS;
  const maxEntries = Math.max(1, options.maxEntries ?? PROFILE_CACHE_MAX_USERS);
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; profiles: Streamer[] }>();
  const inFlight = new Map<string, Promise<Streamer[]>>();

  const load = async (userId: string): Promise<Streamer[]> => {
    const cached = cache.get(userId);
    if (cached && cached.expiresAt > now()) return cached.profiles;
    if (cached) cache.delete(userId);

    const running = inFlight.get(userId);
    if (running) return running;

    const request = loadProfiles(userId)
      .then((profiles) => {
        const currentTime = now();
        for (const [key, entry] of cache) {
          if (entry.expiresAt <= currentTime) cache.delete(key);
        }
        while (cache.size >= maxEntries) {
          const oldestKey = cache.keys().next().value as string | undefined;
          if (!oldestKey) break;
          cache.delete(oldestKey);
        }
        cache.set(userId, { expiresAt: currentTime + ttlMs, profiles });
        return profiles;
      })
      .finally(() => {
        if (inFlight.get(userId) === request) inFlight.delete(userId);
      });
    inFlight.set(userId, request);
    return request;
  };

  return {
    load,
    clear: (userId?: string) => userId ? cache.delete(userId) : cache.clear()
  };
};

const loadOwnedChannelIds = async (userId: string): Promise<string[]> => {
  if (getDbMode() === 'SUPABASE') {
    const channelIds = new Set<string>();
    for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
      const { data, error } = await getSupabaseClient()
        .from('user_cards')
        .select('channel_id')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, from + SUPABASE_PAGE_SIZE - 1);
      if (error) throw error;
      const page = data || [];
      for (const row of page) {
        const channelId = String(row.channel_id || '').trim();
        if (channelId) channelIds.add(channelId);
      }
      if (page.length < SUPABASE_PAGE_SIZE) break;
    }
    return Array.from(channelIds);
  }

  const rows = getDbMode() === 'MYSQL'
    ? await getMysqlDb().all<{ channel_id: string }>(
        'SELECT DISTINCT channel_id FROM user_cards WHERE user_id = ?',
        userId
      )
    : getSqliteDb().prepare(
        'SELECT DISTINCT channel_id FROM user_cards WHERE user_id = ?'
      ).all(userId) as Array<{ channel_id: string }>;
  return rows.map((row) => String(row.channel_id || '').trim()).filter(Boolean);
};

const loadOwnedStreamerProfilesUncached = async (userId: string): Promise<Streamer[]> => {
  const channelIds = await loadOwnedChannelIds(userId);
  const batchSize = getDbMode() === 'SUPABASE' ? SUPABASE_STREAMER_BATCH_SIZE : SQL_STREAMER_BATCH_SIZE;
  const profiles: Streamer[] = [];
  for (let offset = 0; offset < channelIds.length; offset += batchSize) {
    profiles.push(...await streamerRepository.findByIds(channelIds.slice(offset, offset + batchSize)));
  }
  return profiles;
};

const ownedStreamerProfilesLoader = createOwnedStreamerProfilesLoader(loadOwnedStreamerProfilesUncached);

export const getOwnedStreamerProfiles = (userId: string) => ownedStreamerProfilesLoader.load(userId);

