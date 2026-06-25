import { systemConfigRepository } from '../repositories';

export type ArenaOpsFlag =
  | 'quick_match_enabled'
  | 'cup_enabled'
  | 'ranked_rating_writes'
  | 'replay_writes'
  | 'spectator_public_enabled';

export type ArenaOpsConfig = Record<ArenaOpsFlag, boolean> & {
  loaded_at: string;
  source: 'env_default' | 'system_config';
};

const CONFIG_KEY = 'arena_ops_config_v1';
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.ARENA_OPS_CONFIG_CACHE_TTL_MS || 30_000));

const envDefaultConfig = (): ArenaOpsConfig => ({
  quick_match_enabled: process.env.ARENA_QUICK_MATCH_ENABLED === 'true',
  cup_enabled: process.env.ARENA_8_PLAYER_CUP_ENABLED === 'true',
  ranked_rating_writes: process.env.ARENA_DISABLE_RANKED_RATING_WRITES !== 'true',
  replay_writes: process.env.ARENA_DISABLE_REPLAY_WRITES !== 'true',
  spectator_public_enabled: process.env.ARENA_DISABLE_SPECTATOR_PUBLIC !== 'true',
  loaded_at: new Date().toISOString(),
  source: 'env_default'
});

let cache: { config: ArenaOpsConfig; expiresAt: number } | null = null;
let inFlight: Promise<ArenaOpsConfig> | null = null;

const normalizeConfig = (raw: any): ArenaOpsConfig => {
  const defaults = envDefaultConfig();
  return {
    quick_match_enabled: typeof raw?.quick_match_enabled === 'boolean' ? raw.quick_match_enabled : defaults.quick_match_enabled,
    cup_enabled: typeof raw?.cup_enabled === 'boolean' ? raw.cup_enabled : defaults.cup_enabled,
    ranked_rating_writes: typeof raw?.ranked_rating_writes === 'boolean' ? raw.ranked_rating_writes : defaults.ranked_rating_writes,
    replay_writes: typeof raw?.replay_writes === 'boolean' ? raw.replay_writes : defaults.replay_writes,
    spectator_public_enabled: typeof raw?.spectator_public_enabled === 'boolean' ? raw.spectator_public_enabled : defaults.spectator_public_enabled,
    loaded_at: String(raw?.loaded_at || defaults.loaded_at),
    source: raw ? 'system_config' : defaults.source
  };
};

export const getArenaOpsConfigSync = (): ArenaOpsConfig => cache?.config || envDefaultConfig();

export const loadArenaOpsConfig = async (force = false): Promise<ArenaOpsConfig> => {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.config;
  if (!force && inFlight) return inFlight;

  inFlight = systemConfigRepository.get(CONFIG_KEY, '')
    .then((raw) => {
      const parsed = raw ? JSON.parse(raw) : null;
      const config = normalizeConfig(parsed);
      cache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
      return config;
    })
    .catch(() => {
      const config = envDefaultConfig();
      cache = { config, expiresAt: Date.now() + Math.min(CACHE_TTL_MS, 10_000) };
      return config;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

export const setArenaOpsFlag = async (flag: ArenaOpsFlag, enabled: boolean): Promise<ArenaOpsConfig> => {
  const current = await loadArenaOpsConfig(true);
  const next: ArenaOpsConfig = {
    ...current,
    [flag]: enabled,
    loaded_at: new Date().toISOString(),
    source: 'system_config'
  };
  await systemConfigRepository.set(CONFIG_KEY, JSON.stringify(next));
  cache = { config: next, expiresAt: Date.now() + CACHE_TTL_MS };
  return next;
};
