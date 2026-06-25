import { systemConfigRepository } from '../repositories';
import { ArenaCardConfig, normalizeArenaCardConfig } from './arenaCatalog';

const ARENA_STREAMER_CARD_STATE_KEY = 'arena_streamer_card_states_v1';
const STATE_CACHE_TTL_MS = Math.max(1_000, Number(process.env.ARENA_STREAMER_CARD_STATE_CACHE_TTL_MS || 15_000));

export interface ArenaStreamerCardState {
  channel_id: string;
  is_enabled: boolean;
  config_status: 'auto_generated' | 'configured';
  updated_at: string | null;
  updated_by: string | null;
  disabled_at: string | null;
  enabled_at: string | null;
  reason: string | null;
  config: ArenaCardConfig | null;
  configured_at: string | null;
}

type StoredArenaStreamerCardState = Partial<ArenaStreamerCardState> & {
  channel_id?: string;
  is_enabled?: boolean;
};

let stateCache: { states: Record<string, StoredArenaStreamerCardState>; expiresAt: number } | null = null;
let stateLoadInFlight: Promise<Record<string, StoredArenaStreamerCardState>> | null = null;

const normalizeReason = (reason: unknown): string | null => {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) return null;
  return text.slice(0, 240);
};

const parseStateMap = (raw: string): Record<string, StoredArenaStreamerCardState> => {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, StoredArenaStreamerCardState>;
  } catch {
    return {};
  }
};

const loadStateMap = async (): Promise<Record<string, StoredArenaStreamerCardState>> => {
  const now = Date.now();
  if (stateCache && stateCache.expiresAt > now) return stateCache.states;
  if (stateLoadInFlight) return stateLoadInFlight;

  stateLoadInFlight = systemConfigRepository.get(ARENA_STREAMER_CARD_STATE_KEY, '{}')
    .then((raw) => {
      const states = parseStateMap(raw);
      stateCache = { states, expiresAt: Date.now() + STATE_CACHE_TTL_MS };
      return states;
    })
    .finally(() => {
      stateLoadInFlight = null;
    });

  return stateLoadInFlight;
};

const saveStateMap = async (states: Record<string, StoredArenaStreamerCardState>) => {
  await systemConfigRepository.set(ARENA_STREAMER_CARD_STATE_KEY, JSON.stringify(states));
  stateCache = { states, expiresAt: Date.now() + STATE_CACHE_TTL_MS };
};

export const clearArenaStreamerCardStateCache = () => {
  stateCache = null;
  stateLoadInFlight = null;
};

export const getArenaStreamerCardState = async (channelId: string): Promise<ArenaStreamerCardState> => {
  const normalizedChannelId = String(channelId || '').trim();
  const states = await loadStateMap();
  const stored = states[normalizedChannelId] || {};
  const isEnabled = stored.is_enabled !== false;

  return {
    channel_id: normalizedChannelId,
    is_enabled: isEnabled,
    config_status: stored.config_status === 'configured' ? 'configured' : 'auto_generated',
    updated_at: stored.updated_at || null,
    updated_by: stored.updated_by || null,
    disabled_at: stored.disabled_at || null,
    enabled_at: stored.enabled_at || null,
    reason: stored.reason || null,
    config: normalizeArenaCardConfig(stored.config) || null,
    configured_at: stored.configured_at || null
  };
};

export const listArenaStreamerCardStates = async (): Promise<Record<string, ArenaStreamerCardState>> => {
  const states = await loadStateMap();
  const result: Record<string, ArenaStreamerCardState> = {};
  for (const [channelId, stored] of Object.entries(states)) {
    const normalizedChannelId = String(channelId || stored.channel_id || '').trim();
    if (!normalizedChannelId) continue;
    result[normalizedChannelId] = {
      channel_id: normalizedChannelId,
      is_enabled: stored.is_enabled !== false,
      config_status: stored.config_status === 'configured' ? 'configured' : 'auto_generated',
      updated_at: stored.updated_at || null,
      updated_by: stored.updated_by || null,
      disabled_at: stored.disabled_at || null,
      enabled_at: stored.enabled_at || null,
      reason: stored.reason || null,
      config: normalizeArenaCardConfig(stored.config) || null,
      configured_at: stored.configured_at || null
    };
  }
  return result;
};

export const listDisabledArenaStreamerIds = async (): Promise<Set<string>> => {
  const states = await loadStateMap();
  const disabledIds = Object.entries(states)
    .filter(([, state]) => state?.is_enabled === false)
    .map(([channelId]) => channelId);
  return new Set(disabledIds);
};

export const setArenaStreamerCardEnabled = async (
  channelId: string,
  actorUserId: string,
  isEnabled: boolean,
  reason?: unknown
): Promise<ArenaStreamerCardState> => {
  const normalizedChannelId = String(channelId || '').trim();
  const states = { ...(await loadStateMap()) };
  const nowIso = new Date().toISOString();
  const previous = states[normalizedChannelId] || {};

  states[normalizedChannelId] = {
    ...previous,
    channel_id: normalizedChannelId,
    is_enabled: isEnabled,
    config_status: previous.config_status === 'configured' ? 'configured' : 'auto_generated',
    updated_at: nowIso,
    updated_by: actorUserId,
    disabled_at: isEnabled ? previous.disabled_at || null : nowIso,
    enabled_at: isEnabled ? nowIso : previous.enabled_at || null,
    reason: normalizeReason(reason),
    config: normalizeArenaCardConfig(previous.config) || null,
    configured_at: previous.configured_at || null
  };

  await saveStateMap(states);
  return getArenaStreamerCardState(normalizedChannelId);
};

export const setArenaStreamerCardConfig = async (
  channelId: string,
  actorUserId: string,
  rawConfig: unknown,
  isEnabled?: boolean,
  reason?: unknown
): Promise<ArenaStreamerCardState> => {
  const normalizedChannelId = String(channelId || '').trim();
  const states = { ...(await loadStateMap()) };
  const nowIso = new Date().toISOString();
  const previous = states[normalizedChannelId] || {};
  const config = normalizeArenaCardConfig(rawConfig);
  const nextEnabled = typeof isEnabled === 'boolean' ? isEnabled : previous.is_enabled !== false;

  states[normalizedChannelId] = {
    ...previous,
    channel_id: normalizedChannelId,
    is_enabled: nextEnabled,
    config_status: config ? 'configured' : 'auto_generated',
    updated_at: nowIso,
    updated_by: actorUserId,
    disabled_at: nextEnabled ? previous.disabled_at || null : nowIso,
    enabled_at: nextEnabled ? nowIso : previous.enabled_at || null,
    reason: normalizeReason(reason),
    config,
    configured_at: config ? nowIso : null
  };

  await saveStateMap(states);
  return getArenaStreamerCardState(normalizedChannelId);
};
