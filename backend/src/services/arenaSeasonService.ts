import { systemConfigRepository } from '../repositories';

export type ArenaSeasonPhase = 'setup' | 'active' | 'closed';
export type ArenaSeasonKind = 'preseason' | 'season';

export type ArenaSeasonConfig = {
  id: string;
  name: string;
  kind: ArenaSeasonKind;
  season_no: number;
  phase: ArenaSeasonPhase;
  opened_at: string | null;
  closed_at: string | null;
  updated_at: string;
  source: 'env_default' | 'system_config';
};

const CONFIG_KEY = 'arena_current_season_v1';
const CACHE_TTL_MS = Math.max(5_000, Number(process.env.ARENA_SEASON_CONFIG_CACHE_TTL_MS || 30_000));
const SEASON_ID_PATTERN = /^arena-(?:preseason|season)-\d{1,4}$/;

const sanitizeSeasonNo = (value: unknown, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(9999, parsed)) : fallback;
};

const buildSeasonId = (kind: ArenaSeasonKind, seasonNo: number) => `arena-${kind}-${seasonNo}`;
const buildSeasonName = (kind: ArenaSeasonKind, seasonNo: number) => (
  kind === 'preseason' ? `프리시즌 ${seasonNo}` : `시즌 ${seasonNo}`
);

const envDefaultSeason = (): ArenaSeasonConfig => {
  const kind = process.env.ARENA_SEASON_KIND === 'season' ? 'season' : 'preseason';
  const seasonNo = sanitizeSeasonNo(process.env.ARENA_SEASON_NO, 0);
  const id = process.env.ARENA_SEASON_ID && SEASON_ID_PATTERN.test(process.env.ARENA_SEASON_ID)
    ? process.env.ARENA_SEASON_ID
    : buildSeasonId(kind, seasonNo);
  const now = new Date().toISOString();
  return {
    id,
    name: process.env.ARENA_SEASON_NAME || (kind === 'preseason' && seasonNo === 0 ? '프리시즌 준비' : buildSeasonName(kind, seasonNo)),
    kind,
    season_no: seasonNo,
    phase: process.env.ARENA_SEASON_PHASE === 'active' || process.env.ARENA_SEASON_PHASE === 'closed' ? process.env.ARENA_SEASON_PHASE : 'setup',
    opened_at: null,
    closed_at: null,
    updated_at: now,
    source: 'env_default'
  };
};

const normalizeSeasonConfig = (raw: any): ArenaSeasonConfig => {
  const defaults = envDefaultSeason();
  const kind: ArenaSeasonKind = raw?.kind === 'season' ? 'season' : raw?.kind === 'preseason' ? 'preseason' : defaults.kind;
  const seasonNo = sanitizeSeasonNo(raw?.season_no, defaults.season_no);
  const id = typeof raw?.id === 'string' && SEASON_ID_PATTERN.test(raw.id) ? raw.id : buildSeasonId(kind, seasonNo);
  const phase: ArenaSeasonPhase = raw?.phase === 'active' || raw?.phase === 'closed' || raw?.phase === 'setup' ? raw.phase : defaults.phase;
  return {
    id,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : buildSeasonName(kind, seasonNo),
    kind,
    season_no: seasonNo,
    phase,
    opened_at: typeof raw?.opened_at === 'string' ? raw.opened_at : defaults.opened_at,
    closed_at: typeof raw?.closed_at === 'string' ? raw.closed_at : defaults.closed_at,
    updated_at: typeof raw?.updated_at === 'string' ? raw.updated_at : defaults.updated_at,
    source: raw ? 'system_config' : defaults.source
  };
};

let cache: { config: ArenaSeasonConfig; expiresAt: number } | null = null;
let inFlight: Promise<ArenaSeasonConfig> | null = null;

export const getArenaSeasonConfigSync = () => cache?.config || envDefaultSeason();
export const getArenaCurrentSeasonId = () => getArenaSeasonConfigSync().id;
export const isArenaSeasonOpen = () => getArenaSeasonConfigSync().phase === 'active';

export const loadArenaSeasonConfig = async (force = false): Promise<ArenaSeasonConfig> => {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.config;
  if (!force && inFlight) return inFlight;

  inFlight = systemConfigRepository.get(CONFIG_KEY, '')
    .then((raw) => {
      const parsed = raw ? JSON.parse(raw) : null;
      const config = normalizeSeasonConfig(parsed);
      cache = { config, expiresAt: Date.now() + CACHE_TTL_MS };
      return config;
    })
    .catch(() => {
      const config = envDefaultSeason();
      cache = { config, expiresAt: Date.now() + Math.min(CACHE_TTL_MS, 10_000) };
      return config;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};

export const setArenaSeasonConfig = async (input: {
  kind?: ArenaSeasonKind;
  season_no?: number;
  name?: string;
  phase?: ArenaSeasonPhase;
}): Promise<ArenaSeasonConfig> => {
  const current = await loadArenaSeasonConfig(true);
  const kind = input.kind || current.kind;
  const seasonNo = sanitizeSeasonNo(input.season_no, current.season_no);
  const phase = input.phase || current.phase;
  const now = new Date().toISOString();
  const next = normalizeSeasonConfig({
    id: buildSeasonId(kind, seasonNo),
    name: input.name && input.name.trim() ? input.name.trim().slice(0, 80) : buildSeasonName(kind, seasonNo),
    kind,
    season_no: seasonNo,
    phase,
    opened_at: phase === 'active' ? (current.id === buildSeasonId(kind, seasonNo) ? current.opened_at || now : now) : current.opened_at,
    closed_at: phase === 'closed' ? now : null,
    updated_at: now
  });
  await systemConfigRepository.set(CONFIG_KEY, JSON.stringify(next));
  cache = { config: next, expiresAt: Date.now() + CACHE_TTL_MS };
  return next;
};
