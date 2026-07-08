import crypto from 'crypto';
import type {
  ArenaV2CardClassDto,
  ArenaV2CardVersionDto,
  ArenaV2TurnActionDto,
  ArenaV2ValidationResultDto
} from '@chikapo/arena-contract';
import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import {
  createArenaV2BotTurnActions,
  getArenaV2AvailableCost,
  resolveArenaV2Turn,
  validateArenaV2CardVersionDefinition,
  validateArenaV2Deck,
  validateArenaV2TurnAction,
  type ArenaV2RuntimeCardInstance,
  type ArenaV2RuntimePlayer,
  type ArenaV2TurnResolutionResult
} from './arenaV2Engine';

type SqlExecutor = {
  all<T = any>(sql: string, ...args: any[]): Promise<T[]> | T[];
  get<T = any>(sql: string, ...args: any[]): Promise<T | undefined> | T | undefined;
  run(sql: string, ...args: any[]): Promise<any> | any;
};

let testExecutor: SqlExecutor | null = null;

export interface ArenaV2SeasonRow {
  id: string;
  season_key: string;
  name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  modes_enabled: string;
  card_pool_version: string;
  balance_version: string;
  reward_table: string;
  mmr_tier_table: string;
  replay_retention_days: number;
}

export interface ArenaV2ReportInput {
  reporterUserId: string;
  targetType: 'card' | 'match' | 'replay' | 'user' | 'battle_royale';
  targetId: string;
  reason: string;
}

export interface ArenaV2StreamerRightRequestInput {
  requesterUserId: string;
  streamerId: string;
  requestType: 'opt_out' | 'image_change' | 'text_change' | 'card_config' | 'disable_version';
  payload: unknown;
}

export interface ArenaV2StreamerCardConfigInput {
  requesterUserId: string;
  displayName?: string;
  cardClass: string;
  cost: number;
  attack: number;
  health: number;
  keywords: unknown[];
  artAssetId?: string | null;
}

export interface ArenaV2AdminSeasonInput {
  seasonKey: string;
  name: string;
  startsAt: string;
  endsAt: string;
  modesEnabled: Record<string, boolean>;
  cardPoolVersion: string;
  balanceVersion: string;
  mmrTierTable: unknown[];
  rewardTable: unknown[];
}

export interface ArenaV2CardListFilters {
  seasonId?: string;
  class?: string;
  costMin?: number;
  costMax?: number;
  keyword?: string;
  streamerName?: string;
  limit?: number;
}

export interface ArenaV2SaveDeckInput {
  userId: string;
  deckId?: string;
  seasonId: string;
  name: string;
  modeScope: 'all' | 'quick' | 'battle_royale_8' | 'bot';
  cardVersionIds: string[];
}

interface ArenaV2RewardRule {
  tier?: string;
  tiers?: string[];
  rankMin?: number;
  rankMax?: number;
  minRank?: number;
  maxRank?: number;
  items?: unknown[];
  rewards?: unknown[];
  rewardItems?: unknown[];
}

export interface ArenaV2CreateMatchInput {
  userId: string;
  mode: 'bot' | 'quick' | 'battle_royale_8';
  seasonId?: string;
  deckId: string;
  botDifficulty?: 'beginner' | 'easy' | 'normal' | 'hard' | 'expert';
}

export interface ArenaV2SubmitTurnInput {
  userId: string;
  matchId: string;
  turnNo: number;
  revision: number;
  isFinal: boolean;
  actions: ArenaV2TurnActionDto[];
}

export interface ArenaV2SubmitMulliganInput {
  userId: string;
  matchId: string;
  replaceCardInstanceIds: string[];
}

export interface ArenaV2JoinQueueInput {
  userId: string;
  deckId: string;
  seasonId?: string;
}

const jsonParse = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

const stableHash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

const stableShuffle = <T extends { id: string }>(items: T[], seed: string): T[] =>
  [...items].sort((a, b) => stableHash(`${seed}:${a.id}`).localeCompare(stableHash(`${seed}:${b.id}`)));

const ARENA_V2_CARD_CLASSES: ArenaV2CardClassDto[] = ['charge', 'guardian', 'sniper', 'support', 'trick', 'specter', 'tech'];

const defaultClassKeywords: Record<string, Array<{ type: string; value?: number; limit?: string }>> = {
  charge: [{ type: 'pierce', value: 1 }],
  guardian: [{ type: 'shield', value: 1 }],
  sniper: [{ type: 'aim' }],
  support: [{ type: 'guard_support', value: 1 }],
  trick: [{ type: 'weaken', value: 1 }],
  specter: [{ type: 'remnant', value: 1 }],
  tech: [{ type: 'battle_draw', value: 1 }]
};

const normalizeArenaV2KeywordList = (value: unknown): Array<{ type: string; value?: number; limit?: string }> => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 3)
    .map((item) => {
      if (typeof item === 'string') return { type: item.trim() };
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const type = String(raw.type || '').trim();
      if (!type) return null;
      const keyword: { type: string; value?: number; limit?: string } = { type };
      const valueNumber = Number(raw.value);
      if (Number.isInteger(valueNumber)) keyword.value = valueNumber;
      if (typeof raw.limit === 'string' && raw.limit.trim()) keyword.limit = raw.limit.trim();
      return keyword;
    })
    .filter((item): item is { type: string; value?: number; limit?: string } => Boolean(item));
};

const sanitizeCardDisplayName = (value: unknown, fallback: string): string => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 40);
};

const normalizeArenaV2CardClass = (value: unknown, fallback: ArenaV2CardClassDto = 'charge'): ArenaV2CardClassDto => {
  const normalized = String(value || '').trim().toLowerCase();
  return ARENA_V2_CARD_CLASSES.includes(normalized as ArenaV2CardClassDto) ? normalized as ArenaV2CardClassDto : fallback;
};

const defaultArenaV2CardClassForStreamer = (streamerId: string): ArenaV2CardClassDto => {
  const hash = crypto.createHash('sha256').update(`arena-v2-class:${streamerId}`).digest();
  return ARENA_V2_CARD_CLASSES[hash[0] % ARENA_V2_CARD_CLASSES.length];
};

const defaultArenaV2CardStatsForStreamer = (streamer: any) => {
  const baseValue = Math.max(0, Number(streamer.base_value || 0));
  const followerCount = Math.max(0, Number(streamer.follower_count || 0));
  const signal = baseValue + Math.floor(followerCount / 250);
  const cost = Math.max(1, Math.min(9, 1 + Math.floor(Math.log10(Math.max(10, signal)) * 2)));
  const attack = Math.max(0, Math.min(cost, Math.ceil(cost * 0.55)));
  const health = Math.max(1, Math.min(cost * 2 + 2, cost + 2));
  return { cost, attack, health };
};

const defaultArenaV2ArtAssetForStreamer = (streamer: any): string | null => {
  const candidates = [
    streamer.custom_image_url,
    streamer.custom_image_url_1,
    streamer.custom_image_url_2,
    streamer.custom_image_url_3,
    streamer.custom_image_url_4,
    streamer.custom_image_url_5,
    streamer.logo_url
  ].filter(Boolean);
  return candidates.length ? String(candidates[0]) : null;
};

const serializeArenaV2CardVersionRow = (row: any) => ({
  id: row.id,
  streamerId: row.streamer_id,
  displayName: row.display_name,
  seasonId: row.season_id,
  version: Number(row.version),
  cardClass: row.card_class,
  cost: Number(row.cost),
  attack: Number(row.attack),
  health: Number(row.health),
  keywords: jsonParse(row.keywords, []),
  balanceScore: Number(row.balance_score || 0),
  validationResult: jsonParse<ArenaV2ValidationResultDto | null>(row.validation_result, null),
  artAssetId: row.art_asset_id || row.streamer_custom_image || row.streamer_logo || null,
  status: row.status,
  streamer: row.streamer_name ? {
    channelId: row.streamer_id,
    name: row.streamer_name,
    logoUrl: row.streamer_logo || null,
    customImageUrl: row.streamer_custom_image || null,
    isImageBanned: Boolean(Number(row.streamer_is_image_banned || 0))
  } : undefined
});

const getExecutor = (): SqlExecutor | null => {
  if (testExecutor) return testExecutor;
  const mode = getDbMode();
  if (mode === 'LOCAL_SQL') {
    const sqlite = getSqliteDb();
    return {
      all: <T = any>(sql: string, params: any[] = []) => sqlite.prepare(sql).all(...params) as T[],
      get: <T = any>(sql: string, params: any[] = []) => sqlite.prepare(sql).get(...params) as T | undefined,
      run: (sql: string, params: any[] = []) => sqlite.prepare(sql).run(...params)
    };
  }
  if (mode === 'MYSQL') return getMysqlDb();
  return null;
};

export const __setArenaV2ExecutorForTest = (executor: SqlExecutor | null) => {
  testExecutor = executor;
};

const queryAll = async <T>(db: SqlExecutor, sql: string, params: any[] = []): Promise<T[]> => {
  const result = db.all<T>(sql, params);
  return Array.isArray(result) ? result : await result;
};

const queryGet = async <T>(db: SqlExecutor, sql: string, params: any[] = []): Promise<T | undefined> => {
  const result = db.get<T>(sql, params);
  return result instanceof Promise ? await result : result;
};

const runSql = async (db: SqlExecutor, sql: string, params: any[] = []) => {
  const result = db.run(sql, params);
  return result instanceof Promise ? await result : result;
};

export const serializeArenaV2Season = (row: ArenaV2SeasonRow | null | undefined) => {
  if (!row) return null;
  return {
    id: row.id,
    seasonKey: row.season_key,
    name: row.name,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    modesEnabled: jsonParse<Record<string, boolean>>(row.modes_enabled, {}),
    cardPoolVersion: row.card_pool_version,
    balanceVersion: row.balance_version,
    rewardTable: jsonParse<unknown[]>(row.reward_table, []),
    mmrTierTable: jsonParse<unknown[]>(row.mmr_tier_table, []),
    replayRetentionDays: Number(row.replay_retention_days || 7)
  };
};

export const getArenaV2CurrentSeason = async () => {
  const db = getExecutor();
  if (!db) return null;
  const row = await queryGet<ArenaV2SeasonRow>(
    db,
    `
      SELECT *
        FROM arena_v2_seasons
       WHERE status = 'active'
       ORDER BY starts_at DESC
       LIMIT 1
    `
  );
  return serializeArenaV2Season(row);
};

export const createArenaV2SeasonAdmin = async (input: ArenaV2AdminSeasonInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const id = makeId('arena_v2_season');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_seasons
        (id, season_key, name, status, starts_at, ends_at, modes_enabled, card_pool_version, balance_version, reward_table, mmr_tier_table, replay_retention_days)
      VALUES
        (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 7)
    `,
    [
      id,
      input.seasonKey,
      input.name,
      input.startsAt,
      input.endsAt,
      JSON.stringify(input.modesEnabled || {}),
      input.cardPoolVersion,
      input.balanceVersion,
      JSON.stringify(input.rewardTable || []),
      JSON.stringify(input.mmrTierTable || [])
    ]
  );
  return getArenaV2SeasonById(id);
};

export const getArenaV2SeasonById = async (seasonId: string) => {
  const db = getExecutor();
  if (!db) return null;
  const row = await queryGet<ArenaV2SeasonRow>(db, 'SELECT * FROM arena_v2_seasons WHERE id = ? LIMIT 1', [seasonId]);
  return serializeArenaV2Season(row);
};

export const updateArenaV2SeasonAdmin = async (seasonId: string, patch: Partial<ArenaV2AdminSeasonInput> & { status?: string }) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await getArenaV2SeasonById(seasonId);
  if (!existing) throw new Error('ArenaV2SeasonNotFound');
  if (['locked', 'settling', 'closed', 'cancelled'].includes(existing.status) && patch.status !== existing.status) {
    throw new Error('ArenaV2SeasonLocked');
  }
  await runSql(
    db,
    `
      UPDATE arena_v2_seasons
         SET season_key = ?,
             name = ?,
             starts_at = ?,
             ends_at = ?,
             modes_enabled = ?,
             card_pool_version = ?,
             balance_version = ?,
             reward_table = ?,
             mmr_tier_table = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [
      patch.seasonKey ?? existing.seasonKey,
      patch.name ?? existing.name,
      patch.startsAt ?? existing.startsAt,
      patch.endsAt ?? existing.endsAt,
      JSON.stringify(patch.modesEnabled ?? existing.modesEnabled),
      patch.cardPoolVersion ?? existing.cardPoolVersion,
      patch.balanceVersion ?? existing.balanceVersion,
      JSON.stringify(patch.rewardTable ?? existing.rewardTable),
      JSON.stringify(patch.mmrTierTable ?? existing.mmrTierTable),
      seasonId
    ]
  );
  return getArenaV2SeasonById(seasonId);
};

export const transitionArenaV2SeasonAdmin = async (seasonId: string, toStatus: string, reason: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await getArenaV2SeasonById(seasonId);
  if (!existing) throw new Error('ArenaV2SeasonNotFound');
  const allowed: Record<string, string[]> = {
    draft: ['scheduled', 'cancelled'],
    scheduled: ['active', 'cancelled'],
    active: ['locked'],
    locked: ['settling'],
    settling: ['closed']
  };
  if (!allowed[existing.status]?.includes(toStatus)) throw new Error('ArenaV2SeasonTransitionInvalid');
  await runSql(
    db,
    `
      UPDATE arena_v2_seasons
         SET status = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [toStatus, seasonId]
  );
  return { season: await getArenaV2SeasonById(seasonId), transition: { fromStatus: existing.status, toStatus, reason } };
};

export const validateArenaV2DeckForSeason = async (seasonId: string, cardVersionIds: string[]) => {
  const db = getExecutor();
  if (!db) {
    return validateArenaV2Deck({ seasonId, cardVersionIds, cardsByVersionId: {} });
  }
  if (cardVersionIds.length === 0) {
    return validateArenaV2Deck({ seasonId, cardVersionIds, cardsByVersionId: {} });
  }

  const placeholders = cardVersionIds.map(() => '?').join(', ');
  const rows = await queryAll<any>(
    db,
    `
      SELECT id, streamer_id, season_id, status
             , card_class, cost, attack, health, keywords, validation_result
        FROM arena_v2_card_versions
       WHERE id IN (${placeholders})
    `,
    cardVersionIds
  );
  const cardsByVersionId: Parameters<typeof validateArenaV2Deck>[0]['cardsByVersionId'] = {};
  for (const row of rows) {
    cardsByVersionId[row.id] = {
      id: row.id,
      streamerId: row.streamer_id,
      seasonId: row.season_id,
      status: row.status,
      cardClass: row.card_class,
      cost: Number(row.cost),
      attack: Number(row.attack),
      health: Number(row.health),
      keywords: jsonParse(row.keywords, []),
      validationResult: jsonParse(row.validation_result, null)
    };
  }

  return validateArenaV2Deck({ seasonId, cardVersionIds, cardsByVersionId });
};

const buildDefaultArenaV2CardVersionForStreamer = (seasonId: string, streamer: any) => {
  const streamerId = String(streamer.channel_id || '').trim();
  const cardClass = defaultArenaV2CardClassForStreamer(streamerId);
  const stats = defaultArenaV2CardStatsForStreamer(streamer);
  const keywords = stats.cost <= 1 ? [] : defaultClassKeywords[cardClass] || [];
  const candidate = {
    id: `arena_v2_card_${seasonId}_${streamerId}`,
    streamerId,
    seasonId,
    status: 'active' as const,
    cardClass,
    cost: stats.cost,
    attack: stats.attack,
    health: stats.health,
    keywords,
    validationResult: null
  };
  const validation = validateArenaV2CardVersionDefinition(candidate);
  if (!validation.valid) {
    const fallback = {
      ...candidate,
      cardClass: 'charge' as ArenaV2CardClassDto,
      cost: 2,
      attack: 1,
      health: 4,
      keywords: [] as Array<{ type: string; value?: number; limit?: string }>
    };
    const fallbackValidation = validateArenaV2CardVersionDefinition(fallback);
    return {
      ...fallback,
      displayName: sanitizeCardDisplayName(streamer.name, streamerId),
      validation: fallbackValidation,
      balanceScore: fallback.attack * 3 + fallback.health,
      artAssetId: defaultArenaV2ArtAssetForStreamer(streamer)
    };
  }
  return {
    ...candidate,
    displayName: sanitizeCardDisplayName(streamer.name, streamerId),
    validation,
    balanceScore: stats.attack * 3 + stats.health + keywords.length,
    artAssetId: defaultArenaV2ArtAssetForStreamer(streamer)
  };
};

export const syncArenaV2CardsFromRegisteredStreamers = async (seasonId?: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const activeSeason = seasonId ? await getArenaV2SeasonById(seasonId) : await getArenaV2CurrentSeason();
  if (!activeSeason?.id) throw new Error('ArenaV2SeasonNotFound');
  const streamers = await queryAll<any>(
    db,
    `
      SELECT channel_id, name, logo_url, custom_image_url, custom_image_url_1, custom_image_url_2,
             custom_image_url_3, custom_image_url_4, custom_image_url_5,
             follower_count, base_value, is_active, is_image_banned
        FROM streamers
       WHERE COALESCE(is_image_banned, 0) = 0
       ORDER BY base_value DESC, channel_id ASC
       LIMIT 5000
    `
  );

  let created = 0;
  let skipped = 0;
  for (const streamer of streamers) {
    const streamerId = String(streamer.channel_id || '').trim();
    if (!streamerId) {
      skipped += 1;
      continue;
    }
    const existing = await queryGet<{ id: string }>(
      db,
      `
        SELECT id
          FROM arena_v2_card_versions
         WHERE season_id = ? AND streamer_id = ? AND status = 'active'
         LIMIT 1
      `,
      [activeSeason.id, streamerId]
    );
    if (existing) {
      skipped += 1;
      continue;
    }
    const card = buildDefaultArenaV2CardVersionForStreamer(activeSeason.id, streamer);
    await runSql(
      db,
      `
        INSERT INTO arena_v2_card_versions
          (id, streamer_id, display_name, season_id, version, card_class, cost, attack, health, keywords, balance_score, validation_result, art_asset_id, status)
        VALUES
          (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `,
      [
        card.id,
        streamerId,
        card.displayName,
        activeSeason.id,
        card.cardClass,
        card.cost,
        card.attack,
        card.health,
        JSON.stringify(card.keywords),
        card.balanceScore,
        JSON.stringify(card.validation),
        card.artAssetId
      ]
    );
    created += 1;
  }

  return { seasonId: activeSeason.id, scanned: streamers.length, created, skipped };
};

const ensureArenaV2CardsForSeason = async (db: SqlExecutor, seasonId: string) => {
  const existing = await queryGet<{ count: number }>(
    db,
    'SELECT COUNT(*) AS count FROM arena_v2_card_versions WHERE season_id = ? AND status = ?',
    [seasonId, 'active']
  );
  if (Number(existing?.count || 0) > 0) return;
  await syncArenaV2CardsFromRegisteredStreamers(seasonId);
};

export const listArenaV2Cards = async (filters: ArenaV2CardListFilters = {}) => {
  const db = getExecutor();
  if (!db) return [];
  const activeSeason = filters.seasonId ? null : await getArenaV2CurrentSeason();
  const seasonId = filters.seasonId || activeSeason?.id;
  if (!seasonId) return [];
  await ensureArenaV2CardsForSeason(db, seasonId);

  const where = ['cv.season_id = ?', "cv.status = 'active'"];
  const params: any[] = [seasonId];
  if (filters.class) {
    where.push('cv.card_class = ?');
    params.push(filters.class);
  }
  if (Number.isFinite(filters.costMin)) {
    where.push('cv.cost >= ?');
    params.push(filters.costMin);
  }
  if (Number.isFinite(filters.costMax)) {
    where.push('cv.cost <= ?');
    params.push(filters.costMax);
  }
  if (filters.keyword) {
    where.push('cv.keywords LIKE ?');
    params.push(`%${filters.keyword}%`);
  }
  if (filters.streamerName) {
    where.push('(display_name LIKE ? OR s.name LIKE ? OR streamer_id LIKE ?)');
    params.push(`%${filters.streamerName}%`);
    params.push(`%${filters.streamerName}%`);
    params.push(`%${filters.streamerName}%`);
  }
  params.push(Math.min(Math.max(Number(filters.limit || 40), 1), 100));

  const rows = await queryAll<any>(
    db,
    `
      SELECT cv.id, cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost,
             cv.attack, cv.health, cv.keywords, cv.balance_score, cv.validation_result,
             COALESCE(cv.art_asset_id, s.custom_image_url, s.logo_url) AS art_asset_id,
             cv.status,
             s.name AS streamer_name,
             s.logo_url AS streamer_logo,
             s.custom_image_url AS streamer_custom_image,
             s.is_image_banned AS streamer_is_image_banned
        FROM arena_v2_card_versions cv
        LEFT JOIN streamers s ON s.channel_id = cv.streamer_id
       WHERE ${where.join(' AND ')}
       ORDER BY cv.cost ASC, cv.display_name ASC, cv.id ASC
       LIMIT ?
    `,
    params
  );

  return rows.map(serializeArenaV2CardVersionRow);
};

export const getArenaV2CardVersion = async (cardVersionId: string) => {
  const db = getExecutor();
  if (!db) return null;
  const row = await queryGet<any>(
    db,
    `
      SELECT cv.id, cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost,
             cv.attack, cv.health, cv.keywords, cv.balance_score, cv.validation_result,
             COALESCE(cv.art_asset_id, s.custom_image_url, s.logo_url) AS art_asset_id,
             cv.status,
             s.name AS streamer_name,
             s.logo_url AS streamer_logo,
             s.custom_image_url AS streamer_custom_image,
             s.is_image_banned AS streamer_is_image_banned
        FROM arena_v2_card_versions cv
        LEFT JOIN streamers s ON s.channel_id = cv.streamer_id
       WHERE cv.id = ?
       LIMIT 1
    `,
    [cardVersionId]
  );
  if (!row) return null;
  return serializeArenaV2CardVersionRow(row);
};

const findArenaV2OwnedStreamer = async (db: SqlExecutor, userId: string) => queryGet<any>(
  db,
  `
    SELECT channel_id, name, logo_url, custom_image_url, custom_image_url_1, custom_image_url_2,
           custom_image_url_3, custom_image_url_4, custom_image_url_5,
           follower_count, base_value, is_active, is_image_banned, registered_by
      FROM streamers
     WHERE channel_id = ? OR registered_by = ?
     ORDER BY CASE WHEN channel_id = ? THEN 0 ELSE 1 END
     LIMIT 1
  `,
  [userId, userId, userId]
);

const getLatestArenaV2StreamerCardRow = async (db: SqlExecutor, seasonId: string, streamerId: string, includeDisabled = false) => queryGet<any>(
  db,
  `
    SELECT cv.id, cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost,
           cv.attack, cv.health, cv.keywords, cv.balance_score, cv.validation_result,
           COALESCE(cv.art_asset_id, s.custom_image_url, s.logo_url) AS art_asset_id,
           cv.status,
           s.name AS streamer_name,
           s.logo_url AS streamer_logo,
           s.custom_image_url AS streamer_custom_image,
           s.is_image_banned AS streamer_is_image_banned
      FROM arena_v2_card_versions cv
      LEFT JOIN streamers s ON s.channel_id = cv.streamer_id
     WHERE cv.season_id = ? AND cv.streamer_id = ?
       ${includeDisabled ? '' : "AND cv.status = 'active'"}
     ORDER BY cv.version DESC, cv.updated_at DESC
     LIMIT 1
  `,
  [seasonId, streamerId]
);

export const getMyArenaV2StreamerCard = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const season = seasonId ? await getArenaV2SeasonById(seasonId) : await getArenaV2CurrentSeason();
  if (!season?.id) throw new Error('ArenaV2SeasonNotFound');
  const streamer = await findArenaV2OwnedStreamer(db, userId);
  if (!streamer) throw new Error('ArenaStreamerRightForbidden');

  let row = await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id, true);
  if (!row) {
    await syncArenaV2CardsFromRegisteredStreamers(season.id);
    row = await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id, true);
  }
  return {
    seasonId: season.id,
    streamer: {
      channelId: streamer.channel_id,
      name: streamer.name,
      logoUrl: streamer.logo_url,
      customImageUrl: streamer.custom_image_url,
      isImageBanned: Boolean(Number(streamer.is_image_banned || 0))
    },
    card: row ? serializeArenaV2CardVersionRow(row) : null,
    canEdit: season.status === 'active' || season.status === 'scheduled' || season.status === 'draft'
  };
};

export const updateMyArenaV2StreamerCard = async (input: ArenaV2StreamerCardConfigInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const season = await getArenaV2CurrentSeason();
  if (!season?.id) throw new Error('ArenaV2SeasonNotFound');
  const streamer = await findArenaV2OwnedStreamer(db, input.requesterUserId);
  if (!streamer) throw new Error('ArenaStreamerRightForbidden');
  if (Boolean(Number(streamer.is_image_banned || 0))) throw new Error('ArenaV2StreamerCardImageBanned');

  const cardClass = normalizeArenaV2CardClass(input.cardClass);
  const cost = Math.max(1, Math.min(9, Math.floor(Number(input.cost || 1))));
  const attack = Math.max(0, Math.floor(Number(input.attack || 0)));
  const health = Math.max(1, Math.floor(Number(input.health || 1)));
  const keywords = normalizeArenaV2KeywordList(input.keywords);
  const candidate = {
    id: 'pending',
    streamerId: streamer.channel_id,
    seasonId: season.id,
    status: 'active' as const,
    cardClass,
    cost,
    attack,
    health,
    keywords,
    validationResult: null
  };
  const validation = validateArenaV2CardVersionDefinition(candidate);
  if (!validation.valid) {
    return { accepted: false as const, validation, card: null };
  }

  const versionRow = await queryGet<{ max_version: number }>(
    db,
    'SELECT COALESCE(MAX(version), 0) AS max_version FROM arena_v2_card_versions WHERE season_id = ? AND streamer_id = ?',
    [season.id, streamer.channel_id]
  );
  const nextVersion = Number(versionRow?.max_version || 0) + 1;
  const cardId = makeId('arena_v2_card');
  const displayName = sanitizeCardDisplayName(input.displayName, streamer.name || streamer.channel_id);
  const artAssetId = input.artAssetId === undefined ? defaultArenaV2ArtAssetForStreamer(streamer) : input.artAssetId;
  const balanceScore = attack * 3 + health + keywords.length;

  await runSql(
    db,
    `
      UPDATE arena_v2_card_versions
         SET status = 'disabled',
             updated_at = CURRENT_TIMESTAMP
       WHERE season_id = ? AND streamer_id = ? AND status = 'active'
    `,
    [season.id, streamer.channel_id]
  );
  await runSql(
    db,
    `
      INSERT INTO arena_v2_card_versions
        (id, streamer_id, display_name, season_id, version, card_class, cost, attack, health, keywords, balance_score, validation_result, art_asset_id, status)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `,
    [
      cardId,
      streamer.channel_id,
      displayName,
      season.id,
      nextVersion,
      cardClass,
      cost,
      attack,
      health,
      JSON.stringify(keywords),
      balanceScore,
      JSON.stringify(validation),
      artAssetId || null
    ]
  );

  return {
    accepted: true as const,
    validation,
    card: await getArenaV2CardVersion(cardId)
  };
};

export const disableMyArenaV2StreamerCard = async (userId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const season = await getArenaV2CurrentSeason();
  if (!season?.id) throw new Error('ArenaV2SeasonNotFound');
  const streamer = await findArenaV2OwnedStreamer(db, userId);
  if (!streamer) throw new Error('ArenaStreamerRightForbidden');
  await runSql(
    db,
    `
      UPDATE arena_v2_card_versions
         SET status = 'disabled',
             updated_at = CURRENT_TIMESTAMP
       WHERE season_id = ? AND streamer_id = ? AND status = 'active'
    `,
    [season.id, streamer.channel_id]
  );
  return { disabled: true, seasonId: season.id, streamerId: streamer.channel_id };
};

export const enableMyArenaV2StreamerCard = async (userId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const season = await getArenaV2CurrentSeason();
  if (!season?.id) throw new Error('ArenaV2SeasonNotFound');
  const streamer = await findArenaV2OwnedStreamer(db, userId);
  if (!streamer) throw new Error('ArenaStreamerRightForbidden');
  const active = await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id);
  if (active) return { enabled: true, card: serializeArenaV2CardVersionRow(active) };
  const latest = await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id, true);
  if (latest) {
    await runSql(
      db,
      `
        UPDATE arena_v2_card_versions
           SET status = 'active',
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [latest.id]
    );
    return { enabled: true, card: await getArenaV2CardVersion(latest.id) };
  }
  await syncArenaV2CardsFromRegisteredStreamers(season.id);
  return { enabled: true, card: await getLatestArenaV2StreamerCardRow(db, season.id, streamer.channel_id).then((row) => row ? serializeArenaV2CardVersionRow(row) : null) };
};

export const listArenaV2DecksForUser = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return [];
  const where = ['user_id = ?'];
  const params: any[] = [userId];
  if (seasonId) {
    where.push('season_id = ?');
    params.push(seasonId);
  }

  const rows = await queryAll<any>(
    db,
    `
      SELECT id, user_id, season_id, name, mode_scope, card_version_ids, validation_hash, is_valid, validation_result, created_at, updated_at
        FROM arena_v2_decks
       WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT 100
    `,
    params
  );

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    seasonId: row.season_id,
    name: row.name,
    modeScope: row.mode_scope,
    cardVersionIds: jsonParse<string[]>(row.card_version_ids, []),
    validationHash: row.validation_hash,
    isValid: Boolean(Number(row.is_valid)),
    validationResult: jsonParse(row.validation_result, { valid: false, errors: [], warnings: [] }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
};

export const saveArenaV2Deck = async (input: ArenaV2SaveDeckInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const validation = await validateArenaV2DeckForSeason(input.seasonId, input.cardVersionIds);
  const deckId = input.deckId || makeId('arena_v2_deck');
  const validationHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      seasonId: input.seasonId,
      modeScope: input.modeScope,
      cardVersionIds: input.cardVersionIds,
      validation
    }))
    .digest('hex');
  const cardVersionIdsJson = JSON.stringify(input.cardVersionIds);
  const validationJson = JSON.stringify(validation);

  if (input.deckId) {
    const existing = await queryGet<{ id: string; user_id: string }>(
      db,
      'SELECT id, user_id FROM arena_v2_decks WHERE id = ? LIMIT 1',
      [input.deckId]
    );
    if (!existing) {
      throw new Error('ArenaV2DeckNotFound');
    }
    if (existing.user_id !== input.userId) {
      throw new Error('ArenaV2DeckForbidden');
    }
    await runSql(
      db,
      `
        UPDATE arena_v2_decks
           SET season_id = ?,
               name = ?,
               mode_scope = ?,
               card_version_ids = ?,
               validation_hash = ?,
               is_valid = ?,
               validation_result = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?
      `,
      [input.seasonId, input.name, input.modeScope, cardVersionIdsJson, validationHash, validation.valid ? 1 : 0, validationJson, deckId, input.userId]
    );
  } else {
    await runSql(
      db,
      `
        INSERT INTO arena_v2_decks
          (id, user_id, season_id, name, mode_scope, card_version_ids, validation_hash, is_valid, validation_result)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [deckId, input.userId, input.seasonId, input.name, input.modeScope, cardVersionIdsJson, validationHash, validation.valid ? 1 : 0, validationJson]
    );
  }

  return {
    id: deckId,
    userId: input.userId,
    seasonId: input.seasonId,
    name: input.name,
    modeScope: input.modeScope,
    cardVersionIds: input.cardVersionIds,
    validationHash,
    isValid: validation.valid,
    validationResult: validation
  };
};

export const revalidateArenaV2DeckForUser = async (userId: string, deckId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const deck = await queryGet<any>(
    db,
    'SELECT id, user_id, season_id, name, mode_scope, card_version_ids, validation_hash, is_valid, validation_result FROM arena_v2_decks WHERE id = ? LIMIT 1',
    [deckId]
  );
  if (!deck) throw new Error('ArenaV2DeckNotFound');
  if (deck.user_id !== userId) throw new Error('ArenaV2DeckForbidden');

  const cardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
  const validation = await validateArenaV2DeckForSeason(deck.season_id, cardVersionIds);
  const validationHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      seasonId: deck.season_id,
      modeScope: deck.mode_scope,
      cardVersionIds,
      validation
    }))
    .digest('hex');
  await runSql(
    db,
    `
      UPDATE arena_v2_decks
         SET validation_hash = ?,
             is_valid = ?,
             validation_result = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?
    `,
    [validationHash, validation.valid ? 1 : 0, JSON.stringify(validation), deckId, userId]
  );
  return {
    id: deck.id,
    userId: deck.user_id,
    seasonId: deck.season_id,
    name: deck.name,
    modeScope: deck.mode_scope,
    cardVersionIds,
    validationHash,
    isValid: validation.valid,
    validationResult: validation
  };
};

export const deleteArenaV2DeckForUser = async (userId: string, deckId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await queryGet<{ id: string; user_id: string }>(
    db,
    'SELECT id, user_id FROM arena_v2_decks WHERE id = ? LIMIT 1',
    [deckId]
  );
  if (!existing) throw new Error('ArenaV2DeckNotFound');
  if (existing.user_id !== userId) throw new Error('ArenaV2DeckForbidden');
  await runSql(db, 'DELETE FROM arena_v2_decks WHERE id = ? AND user_id = ?', [deckId, userId]);
  return { deleted: true };
};

export const createArenaV2Match = async (input: ArenaV2CreateMatchInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  if (input.mode !== 'bot') {
    throw new Error(input.mode === 'quick' ? 'ArenaV2UseQuickQueue' : 'ArenaV2UseBattleRoyaleQueue');
  }

  const deck = await queryGet<any>(
    db,
    'SELECT id, user_id, season_id, card_version_ids, is_valid FROM arena_v2_decks WHERE id = ? LIMIT 1',
    [input.deckId]
  );
  if (!deck) throw new Error('ArenaV2DeckNotFound');
  if (deck.user_id !== input.userId) throw new Error('ArenaV2DeckForbidden');
  if (!Boolean(Number(deck.is_valid))) throw new Error('ArenaV2DeckInvalid');

  const seasonId = input.seasonId || deck.season_id;
  if (seasonId !== deck.season_id) throw new Error('ArenaV2DeckSeasonMismatch');
  const season = await queryGet<any>(
    db,
    'SELECT id, card_pool_version FROM arena_v2_seasons WHERE id = ? AND status = ? LIMIT 1',
    [seasonId, 'active']
  );
  if (!season) throw new Error('ArenaV2SeasonClosed');

  const playerCardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
  const validation = await validateArenaV2DeckForSeason(seasonId, playerCardVersionIds);
  if (!validation.valid) throw new Error('ArenaV2DeckInvalid');

  const playerCards = await loadArenaV2CardVersionsByIds(db, playerCardVersionIds);
  const botCards = await queryAll<any>(
    db,
    `
      SELECT id, cost, attack, health
        FROM arena_v2_card_versions
       WHERE season_id = ? AND status = 'active'
       ORDER BY cost ASC, id ASC
       LIMIT 20
    `,
    [seasonId]
  );
  if (botCards.length < 14) throw new Error('ArenaV2BotDeckUnavailable');

  const matchId = makeId('arena_v2_match');
  const seed = stableHash(`chikapo-arena-v2:${matchId}:${input.userId}:${Date.now()}`);
  const playerOrder = stableShuffle(playerCards, `${seed}:player`).map((card) => ({
    instanceId: makeId('arena_v2_card'),
    card
  }));
  const botOrder = stableShuffle(botCards.slice(0, Math.max(14, Math.min(botCards.length, 20))), `${seed}:bot`).map((card) => ({
    instanceId: makeId('arena_v2_card'),
    card
  }));

  await runSql(
    db,
    `
      INSERT INTO arena_v2_matches
        (id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version, card_pool_version, result_summary)
      VALUES
        (?, ?, 'bot', 'mulligan', NULL, 0, 1, ?, 'arena-v2-gdd-1.0.0', ?, ?)
    `,
    [matchId, seasonId, seed, season.card_pool_version, JSON.stringify({ status: 'mulligan', botDifficulty: input.botDifficulty || 'normal' })]
  );

  await insertArenaV2MatchPlayer(db, {
    matchId,
    userId: input.userId,
    seatNo: 0,
    deckId: input.deckId,
    orderedInstances: playerOrder
  });
  await insertArenaV2MatchPlayer(db, {
    matchId,
    userId: null,
    seatNo: 1,
    deckId: null,
    orderedInstances: botOrder
  });

  for (const [seatNo, ordered] of [[0, playerOrder], [1, botOrder]] as const) {
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      await runSql(
        db,
        `
          INSERT INTO arena_v2_card_instances
            (id, match_id, owner_seat_no, card_version_id, zone, position, current_attack, current_health, damage_taken, status_effects, created_turn)
          VALUES
            (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, 0)
        `,
        [
          item.instanceId,
          matchId,
          seatNo,
          item.card.id,
          index < 5 ? 'hand' : 'deck',
          Number(item.card.attack || 0),
          Number(item.card.health || 1),
          JSON.stringify([])
        ]
      );
    }
  }

  return {
    matchId,
    mode: 'bot' as const,
    status: 'mulligan' as const,
    turnNo: 1,
    seed,
    self: {
      seatNo: 0,
      handCardInstanceIds: playerOrder.slice(0, 5).map((item) => item.instanceId),
      deckCount: Math.max(0, playerOrder.length - 5)
    },
    opponent: {
      seatNo: 1,
      handCount: 5,
      deckCount: Math.max(0, botOrder.length - 5),
      botDifficulty: input.botDifficulty || 'normal'
    }
  };
};

export const joinArenaV2QuickQueue = async (input: ArenaV2JoinQueueInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const deck = await loadValidArenaV2DeckForUse(db, input.userId, input.deckId, input.seasonId);
  await expireArenaV2QueueRows(db, deck.seasonId, input.userId);
  const existing = await queryGet<any>(
    db,
    `
      SELECT id, season_id, user_id, deck_id, mmr, status, search_min_mmr, search_max_mmr, matched_match_id, joined_at, updated_at, expires_at
        FROM arena_v2_match_queue
       WHERE season_id = ? AND user_id = ? AND status = 'waiting'
       ORDER BY joined_at DESC
       LIMIT 1
    `,
    [deck.seasonId, input.userId]
  );
  if (existing) return serializeArenaV2QuickQueue(existing);
  const ticketId = makeId('arena_v2_queue');
  const mmr = 1000;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const opponent = await queryGet<any>(
    db,
    `
      SELECT id, season_id, user_id, deck_id, mmr, status, search_min_mmr, search_max_mmr, matched_match_id, joined_at, updated_at, expires_at
        FROM arena_v2_match_queue
       WHERE season_id = ?
         AND status = 'waiting'
         AND user_id <> ?
         AND search_min_mmr <= ?
         AND search_max_mmr >= ?
       ORDER BY joined_at ASC
       LIMIT 1
    `,
    [deck.seasonId, input.userId, mmr, mmr]
  );
  if (opponent) {
    const matchId = await createArenaV2MatchFromDeckSeats(db, {
      seasonId: deck.seasonId,
      cardPoolVersion: deck.season.card_pool_version,
      mode: 'quick',
      battleRoyaleId: null,
      roundNo: 0,
      seats: [
        { seatNo: 0, userId: opponent.user_id, deckId: opponent.deck_id },
        { seatNo: 1, userId: input.userId, deckId: input.deckId }
      ],
      summary: { status: 'mulligan', queue: 'quick', matchedUsers: [opponent.user_id, input.userId] }
    });
    await runSql(
      db,
      `
        UPDATE arena_v2_match_queue
           SET status = 'matched',
               matched_match_id = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'waiting'
      `,
      [matchId, opponent.id]
    );
    await runSql(
      db,
      `
        INSERT INTO arena_v2_match_queue
          (id, season_id, user_id, deck_id, mmr, status, search_min_mmr, search_max_mmr, matched_match_id, expires_at)
        VALUES
          (?, ?, ?, ?, ?, 'matched', ?, ?, ?, ?)
      `,
      [ticketId, deck.seasonId, input.userId, input.deckId, mmr, mmr - 150, mmr + 150, matchId, expiresAt]
    );
    return serializeArenaV2QuickQueue({
      id: ticketId,
      season_id: deck.seasonId,
      user_id: input.userId,
      deck_id: input.deckId,
      mmr,
      status: 'matched',
      search_min_mmr: mmr - 150,
      search_max_mmr: mmr + 150,
      matched_match_id: matchId,
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: expiresAt
    });
  }
  await runSql(
    db,
    `
      INSERT INTO arena_v2_match_queue
        (id, season_id, user_id, deck_id, mmr, status, search_min_mmr, search_max_mmr, expires_at)
      VALUES
        (?, ?, ?, ?, ?, 'waiting', ?, ?, ?)
    `,
    [ticketId, deck.seasonId, input.userId, input.deckId, mmr, mmr - 150, mmr + 150, expiresAt]
  );
  return serializeArenaV2QuickQueue({
    id: ticketId,
    season_id: deck.seasonId,
    user_id: input.userId,
    deck_id: input.deckId,
    mmr,
    status: 'waiting',
    search_min_mmr: mmr - 150,
    search_max_mmr: mmr + 150,
    matched_match_id: null,
    joined_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: expiresAt
  });
};

export const getArenaV2QuickQueueStatus = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return { status: 'none' as const, ticket: null };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { status: 'none' as const, ticket: null };
  await expireArenaV2QueueRows(db, season.id, userId);
  const row = await queryGet<any>(
    db,
    `
      SELECT id, season_id, user_id, deck_id, mmr, status, search_min_mmr, search_max_mmr, matched_match_id, joined_at, updated_at, expires_at
        FROM arena_v2_match_queue
       WHERE season_id = ? AND user_id = ? AND status IN ('waiting', 'matched')
       ORDER BY joined_at DESC
       LIMIT 1
    `,
    [season.id, userId]
  );
  if (!row) return { status: 'none' as const, ticket: null };
  const ticket = serializeArenaV2QuickQueue(row);
  return {
    status: row.status,
    queueId: ticket.id,
    joinedAt: ticket.joinedAt,
    estimatedRange: { minMmr: ticket.searchMinMmr, maxMmr: ticket.searchMaxMmr },
    matchId: ticket.matchedMatchId,
    ticket
  };
};

export const cancelArenaV2QuickQueue = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return { cancelled: false };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { cancelled: false };
  await expireArenaV2QueueRows(db, season.id, userId);
  const matched = await queryGet<any>(
    db,
    `
      SELECT id, matched_match_id
        FROM arena_v2_match_queue
       WHERE season_id = ? AND user_id = ? AND status = 'matched'
       ORDER BY updated_at DESC
       LIMIT 1
    `,
    [season.id, userId]
  );
  if (matched) return { cancelled: false, status: 'matched' as const, matchId: matched.matched_match_id };
  await runSql(
    db,
    `
      UPDATE arena_v2_match_queue
         SET status = 'cancelled',
             updated_at = CURRENT_TIMESTAMP
       WHERE season_id = ? AND user_id = ? AND status = 'waiting'
    `,
    [season.id, userId]
  );
  return { cancelled: true };
};

export const joinArenaV2BattleRoyaleQueue = async (input: ArenaV2JoinQueueInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const deck = await loadValidArenaV2DeckForUse(db, input.userId, input.deckId, input.seasonId);
  await expireArenaV2QueueRows(db, deck.seasonId, input.userId);
  const existing = await queryGet<any>(
    db,
    `
      SELECT id, season_id, user_id, deck_id, status, battle_royale_id, joined_at, updated_at, expires_at
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND user_id = ? AND status = 'waiting'
       ORDER BY joined_at DESC
       LIMIT 1
    `,
    [deck.seasonId, input.userId]
  );
  if (existing) return serializeArenaV2BattleRoyaleQueue(existing);
  const ticketId = makeId('arena_v2_br_queue');
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await runSql(
    db,
    `
      INSERT INTO arena_v2_battle_royale_queue
        (id, season_id, user_id, deck_id, status, expires_at)
      VALUES
        (?, ?, ?, ?, 'waiting', ?)
    `,
    [ticketId, deck.seasonId, input.userId, input.deckId, expiresAt]
  );
  const waitingTickets = await queryAll<any>(
    db,
    `
      SELECT id, season_id, user_id, deck_id, status, battle_royale_id, joined_at, updated_at, expires_at
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND status = 'waiting'
       ORDER BY joined_at ASC
       LIMIT 8
    `,
    [deck.seasonId]
  );
  if (waitingTickets.length >= 8) {
    const battleRoyaleId = makeId('arena_v2_br');
    const entrants = waitingTickets.slice(0, 8);
    const matchIds: string[] = [];
    for (let index = 0; index < entrants.length; index += 2) {
      const pair = entrants.slice(index, index + 2);
      const matchId = await createArenaV2MatchFromDeckSeats(db, {
        seasonId: deck.seasonId,
        cardPoolVersion: deck.season.card_pool_version,
        mode: 'battle_royale_8',
        battleRoyaleId,
        roundNo: 1,
        seats: [
          { seatNo: 0, userId: pair[0].user_id, deckId: pair[0].deck_id },
          { seatNo: 1, userId: pair[1].user_id, deckId: pair[1].deck_id }
        ],
        summary: { status: 'mulligan', queue: 'battle_royale_8', battleRoyaleId, roundNo: 1 }
      });
      matchIds.push(matchId);
    }
    const participantState = entrants.map((ticket, index) => ({
      seedNo: index + 1,
      userId: ticket.user_id,
      deckId: ticket.deck_id,
      status: 'active',
      currentRoundNo: 1,
      finalRank: null
    }));
    await runSql(
      db,
      `
        INSERT INTO arena_v2_battle_royales
          (id, season_id, status, current_round_no, participant_state, match_ids, winner_user_id)
        VALUES
          (?, ?, 'active', 1, ?, ?, NULL)
      `,
      [battleRoyaleId, deck.seasonId, JSON.stringify(participantState), JSON.stringify(matchIds)]
    );
    const placeholders = entrants.map(() => '?').join(', ');
    await runSql(
      db,
      `
        UPDATE arena_v2_battle_royale_queue
           SET status = 'matched',
               battle_royale_id = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id IN (${placeholders}) AND status = 'waiting'
      `,
      [battleRoyaleId, ...entrants.map((ticket) => ticket.id)]
    );
    return serializeArenaV2BattleRoyaleQueue({
      id: ticketId,
      season_id: deck.seasonId,
      user_id: input.userId,
      deck_id: input.deckId,
      status: 'matched',
      battle_royale_id: battleRoyaleId,
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: expiresAt
    });
  }
  return serializeArenaV2BattleRoyaleQueue({
    id: ticketId,
    season_id: deck.seasonId,
    user_id: input.userId,
    deck_id: input.deckId,
    status: 'waiting',
    battle_royale_id: null,
    joined_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    expires_at: expiresAt
  });
};

export const getArenaV2BattleRoyaleQueueStatus = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return { status: 'none' as const, ticket: null };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { status: 'none' as const, ticket: null };
  await expireArenaV2QueueRows(db, season.id, userId);
  const row = await queryGet<any>(
    db,
    `
      SELECT id, season_id, user_id, deck_id, status, battle_royale_id, joined_at, updated_at, expires_at
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND user_id = ? AND status IN ('waiting', 'matched')
       ORDER BY joined_at DESC
       LIMIT 1
    `,
    [season.id, userId]
  );
  if (!row) return { status: 'none' as const, ticket: null };
  const ticket = serializeArenaV2BattleRoyaleQueue(row);
  const participantCount = row.status === 'matched'
    ? 8
    : await countArenaV2BattleRoyaleQueueParticipants(db, season.id);
  return {
    status: row.status,
    queueId: ticket.id,
    joinedAt: ticket.joinedAt,
    participantCount,
    battleRoyaleId: ticket.battleRoyaleId,
    ticket
  };
};

export const cancelArenaV2BattleRoyaleQueue = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return { cancelled: false };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { cancelled: false };
  await expireArenaV2QueueRows(db, season.id, userId);
  const matched = await queryGet<any>(
    db,
    `
      SELECT id, battle_royale_id
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND user_id = ? AND status = 'matched'
       ORDER BY updated_at DESC
       LIMIT 1
    `,
    [season.id, userId]
  );
  if (matched) return { cancelled: false, status: 'matched' as const, battleRoyaleId: matched.battle_royale_id };
  await runSql(
    db,
    `
      UPDATE arena_v2_battle_royale_queue
         SET status = 'cancelled',
             updated_at = CURRENT_TIMESTAMP
       WHERE season_id = ? AND user_id = ? AND status = 'waiting'
    `,
    [season.id, userId]
  );
  return { cancelled: true };
};

const expireArenaV2QueueRows = async (db: SqlExecutor, seasonId?: string, userId?: string) => {
  const now = new Date().toISOString();
  const scopedQuickWhere = [
    "status = 'waiting'",
    'expires_at < ?',
    seasonId ? 'season_id = ?' : '',
    userId ? 'user_id = ?' : ''
  ].filter(Boolean).join(' AND ');
  const scopedParams = [now, ...(seasonId ? [seasonId] : []), ...(userId ? [userId] : [])];
  await runSql(
    db,
    `
      UPDATE arena_v2_match_queue
         SET status = 'expired',
             updated_at = CURRENT_TIMESTAMP
       WHERE ${scopedQuickWhere}
    `,
    scopedParams
  );
  await runSql(
    db,
    `
      UPDATE arena_v2_battle_royale_queue
         SET status = 'expired',
             updated_at = CURRENT_TIMESTAMP
       WHERE ${scopedQuickWhere}
    `,
    scopedParams
  );
};

const countArenaV2BattleRoyaleQueueParticipants = async (db: SqlExecutor, seasonId: string) => {
  const row = await queryGet<{ count: number; c?: number }>(
    db,
    `
      SELECT COUNT(*) AS count
        FROM arena_v2_battle_royale_queue
       WHERE season_id = ? AND status = 'waiting' AND expires_at >= ?
    `,
    [seasonId, new Date().toISOString()]
  );
  return Number(row?.count ?? row?.c ?? 0);
};

export const processArenaV2ExpiredQueues = async () => {
  const db = getExecutor();
  if (!db) return { quickExpired: 0, battleRoyaleExpired: 0 };
  const now = new Date().toISOString();
  const quick = await runSql(
    db,
    `
      UPDATE arena_v2_match_queue
         SET status = 'expired',
             updated_at = CURRENT_TIMESTAMP
       WHERE status = 'waiting' AND expires_at < ?
    `,
    [now]
  );
  const battleRoyale = await runSql(
    db,
    `
      UPDATE arena_v2_battle_royale_queue
         SET status = 'expired',
             updated_at = CURRENT_TIMESTAMP
       WHERE status = 'waiting' AND expires_at < ?
    `,
    [now]
  );
  return {
    quickExpired: Number(quick?.changes ?? quick?.affectedRows ?? 0),
    battleRoyaleExpired: Number(battleRoyale?.changes ?? battleRoyale?.affectedRows ?? 0)
  };
};

const loadValidArenaV2DeckForUse = async (db: SqlExecutor, userId: string, deckId: string, seasonId?: string) => {
  const deck = await queryGet<any>(
    db,
    'SELECT id, user_id, season_id, card_version_ids, is_valid FROM arena_v2_decks WHERE id = ? LIMIT 1',
    [deckId]
  );
  if (!deck) throw new Error('ArenaV2DeckNotFound');
  if (deck.user_id !== userId) throw new Error('ArenaV2DeckForbidden');
  if (!Boolean(Number(deck.is_valid))) throw new Error('ArenaV2DeckInvalid');
  if (seasonId && deck.season_id !== seasonId) throw new Error('ArenaV2DeckSeasonMismatch');
  const season = await queryGet<any>(
    db,
    'SELECT id, card_pool_version FROM arena_v2_seasons WHERE id = ? AND status = ? LIMIT 1',
    [deck.season_id, 'active']
  );
  if (!season) throw new Error('ArenaV2SeasonClosed');
  const cardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
  const validation = await validateArenaV2DeckForSeason(deck.season_id, cardVersionIds);
  if (!validation.valid) throw new Error('ArenaV2DeckInvalid');
  return { deck, season, seasonId: deck.season_id };
};

const serializeArenaV2QuickQueue = (row: any) => ({
  id: row.id,
  seasonId: row.season_id,
  userId: row.user_id,
  deckId: row.deck_id,
  mmr: Number(row.mmr || 1000),
  status: row.status,
  searchMinMmr: Number(row.search_min_mmr || 0),
  searchMaxMmr: Number(row.search_max_mmr || 0),
  matchedMatchId: row.matched_match_id,
  joinedAt: row.joined_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at
});

const serializeArenaV2BattleRoyaleQueue = (row: any) => ({
  id: row.id,
  seasonId: row.season_id,
  userId: row.user_id,
  deckId: row.deck_id,
  status: row.status,
  battleRoyaleId: row.battle_royale_id,
  joinedAt: row.joined_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at
});

export const getArenaV2MatchForUser = async (matchId: string, userId?: string | null) => {
  const db = getExecutor();
  if (!db) return null;
  const match = await queryGet<any>(
    db,
    `
      SELECT id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version, card_pool_version,
             started_at, finished_at, winner_user_id, result_summary, replay_expires_at, created_at, updated_at
        FROM arena_v2_matches
       WHERE id = ?
       LIMIT 1
    `,
    [matchId]
  );
  if (!match) return null;

  const players = await queryAll<any>(
    db,
    `
      SELECT id, match_id, user_id, seat_no, deck_id, player_health, fatigue_count, initial_deck_order, hand_card_instance_ids,
             deck_card_instance_ids, graveyard_card_instance_ids, board_state, mulligan_state, final_rank, created_at, updated_at
        FROM arena_v2_match_players
       WHERE match_id = ?
       ORDER BY seat_no ASC
    `,
    [matchId]
  );
  if (userId && !players.some((player) => player.user_id === userId) && match.mode !== 'bot') {
    return null;
  }

  const instances = await queryAll<any>(
    db,
    `
      SELECT ci.id, ci.match_id, ci.owner_seat_no, ci.card_version_id, ci.zone, ci.position, ci.current_attack, ci.current_health,
             ci.damage_taken, ci.status_effects, ci.created_turn,
             cv.streamer_id, cv.display_name, cv.season_id, cv.version, cv.card_class, cv.cost, cv.attack, cv.health, cv.keywords, cv.status AS card_status
        FROM arena_v2_card_instances ci
        LEFT JOIN arena_v2_card_versions cv ON cv.id = ci.card_version_id
       WHERE ci.match_id = ?
       ORDER BY ci.owner_seat_no ASC, ci.zone ASC, ci.created_turn ASC, ci.id ASC
    `,
    [matchId]
  );
  const self = userId ? players.find((player) => player.user_id === userId) : undefined;
  return serializeArenaV2MatchView(match, players, instances, self?.seat_no ?? null);
};

const loadArenaV2RuntimeMatch = async (db: SqlExecutor, matchId: string): Promise<{
  match: any;
  players: ArenaV2RuntimePlayer[];
  cardInstances: ArenaV2RuntimeCardInstance[];
}> => {
  const match = await queryGet<any>(
    db,
    `
      SELECT id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version, card_pool_version,
             started_at, finished_at, winner_user_id, result_summary, replay_expires_at, created_at, updated_at
        FROM arena_v2_matches
       WHERE id = ?
       LIMIT 1
    `,
    [matchId]
  );
  if (!match) throw new Error('ArenaV2MatchNotFound');
  const playerRows = await queryAll<any>(
    db,
    `
      SELECT id, match_id, user_id, seat_no, deck_id, player_health, fatigue_count, initial_deck_order, hand_card_instance_ids,
             deck_card_instance_ids, graveyard_card_instance_ids, board_state, mulligan_state, final_rank, created_at, updated_at
        FROM arena_v2_match_players
       WHERE match_id = ?
       ORDER BY seat_no ASC
    `,
    [matchId]
  );
  const instanceRows = await queryAll<any>(
    db,
    `
      SELECT ci.id, ci.match_id, ci.owner_seat_no, ci.card_version_id, ci.zone, ci.position, ci.current_attack, ci.current_health,
             ci.damage_taken, ci.status_effects, ci.created_turn,
             cv.display_name, cv.card_class, cv.cost, cv.attack, cv.health, cv.keywords
        FROM arena_v2_card_instances ci
        LEFT JOIN arena_v2_card_versions cv ON cv.id = ci.card_version_id
       WHERE ci.match_id = ?
       ORDER BY ci.owner_seat_no ASC, ci.zone ASC, ci.created_turn ASC, ci.id ASC
    `,
    [matchId]
  );
  return {
    match,
    players: playerRows.map((player) => ({
      seatNo: Number(player.seat_no),
      userId: player.user_id,
      deckId: player.deck_id,
      playerHealth: Number(player.player_health || 30),
      fatigueCount: Math.max(0, Number(player.fatigue_count || 0)),
      handCardInstanceIds: jsonParse<string[]>(player.hand_card_instance_ids, []),
      deckCardInstanceIds: jsonParse<string[]>(player.deck_card_instance_ids, []),
      graveyardCardInstanceIds: jsonParse<string[]>(player.graveyard_card_instance_ids, []),
      boardState: jsonParse(player.board_state, []),
      mulliganState: jsonParse(player.mulligan_state, {})
    })),
    cardInstances: instanceRows.map((instance) => ({
      id: instance.id,
      ownerSeatNo: Number(instance.owner_seat_no),
      cardVersionId: instance.card_version_id,
      zone: instance.zone,
      position: jsonParse(instance.position, null),
      currentAttack: Number(instance.current_attack || instance.attack || 0),
      currentHealth: Number(instance.current_health || instance.health || 1),
      damageTaken: Number(instance.damage_taken || 0),
      statusEffects: jsonParse(instance.status_effects, []),
      createdTurn: Number(instance.created_turn || 0),
      card: {
        id: instance.card_version_id,
        cost: Number(instance.cost || 0),
        attack: Number(instance.attack || instance.current_attack || 0),
        health: Number(instance.health || instance.current_health || 1),
        displayName: instance.display_name || instance.card_version_id,
        cardClass: instance.card_class || 'charge',
        keywords: jsonParse(instance.keywords, [])
      }
    }))
  };
};

const collectArenaV2FinalActions = async (db: SqlExecutor, matchId: string, turnNo: number) => {
  const rows = await queryAll<any>(
    db,
    `
      SELECT seat_no, action_payload
        FROM arena_v2_action_submissions
       WHERE match_id = ? AND turn_no = ? AND is_final = 1
       ORDER BY submitted_at ASC
    `,
    [matchId, turnNo]
  );
  const actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]> = {};
  for (const row of rows) {
    const payload = jsonParse<{ actions?: ArenaV2TurnActionDto[] }>(row.action_payload, { actions: [] });
    actionsBySeatNo[Number(row.seat_no)] = payload.actions || [];
  }
  return actionsBySeatNo;
};

const collectArenaV2LatestValidActions = async (db: SqlExecutor, matchId: string, turnNo: number) => {
  const rows = await queryAll<any>(
    db,
    `
      SELECT seat_no, action_payload, validation_result, revision, submitted_at
        FROM arena_v2_action_submissions
       WHERE match_id = ? AND turn_no = ?
       ORDER BY seat_no ASC, revision DESC, submitted_at DESC
    `,
    [matchId, turnNo]
  );
  const actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]> = {};
  for (const row of rows) {
    const seatNo = Number(row.seat_no);
    if (actionsBySeatNo[seatNo]) continue;
    const validation = jsonParse<{ valid?: boolean }>(row.validation_result, { valid: false });
    if (!validation.valid) continue;
    const payload = jsonParse<{ actions?: ArenaV2TurnActionDto[] }>(row.action_payload, { actions: [] });
    actionsBySeatNo[seatNo] = payload.actions || [];
  }
  return actionsBySeatNo;
};

const resolveArenaV2TurnFromActions = async (
  db: SqlExecutor,
  input: {
    matchId: string;
    turnNo: number;
    actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]>;
  }
) => {
  const runtime = await loadArenaV2RuntimeMatch(db, input.matchId);
  await runSql(
    db,
    `
      UPDATE arena_v2_matches
         SET status = 'combat_resolving',
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND turn_no = ?
    `,
    [input.matchId, input.turnNo]
  );
  const resolution = resolveArenaV2Turn({
    matchId: input.matchId,
    mode: runtime.match.mode,
    turnNo: input.turnNo,
    seed: runtime.match.rng_seed,
    players: runtime.players,
    cardInstances: runtime.cardInstances,
    actionsBySeatNo: input.actionsBySeatNo
  });
  await persistArenaV2TurnResolution(db, runtime.match, resolution);
  return resolution;
};

const insertArenaV2ActionSubmission = async (
  db: SqlExecutor,
  input: {
    id: string;
    matchId: string;
    userId: string;
    seatNo: number;
    turnNo: number;
    revision: number;
    actions: ArenaV2TurnActionDto[];
    validation: unknown;
    isFinal: boolean;
  }
) => runSql(
  db,
  `
    INSERT INTO arena_v2_action_submissions
      (id, match_id, user_id, seat_no, turn_no, revision, action_payload, validation_result, is_final)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  [
    input.id,
    input.matchId,
    input.userId,
    input.seatNo,
    input.turnNo,
    input.revision,
    JSON.stringify({ actions: input.actions }),
    JSON.stringify(input.validation),
    input.isFinal ? 1 : 0
  ]
);

const persistArenaV2TurnResolution = async (db: SqlExecutor, match: any, resolution: ArenaV2TurnResolutionResult) => {
  for (const player of resolution.players) {
    await runSql(
      db,
      `
        UPDATE arena_v2_match_players
           SET player_health = ?,
               fatigue_count = ?,
               hand_card_instance_ids = ?,
               deck_card_instance_ids = ?,
               graveyard_card_instance_ids = ?,
               board_state = ?,
               mulligan_state = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE match_id = ? AND seat_no = ?
      `,
      [
        player.playerHealth,
        player.fatigueCount || 0,
        JSON.stringify(player.handCardInstanceIds),
        JSON.stringify(player.deckCardInstanceIds),
        JSON.stringify(player.graveyardCardInstanceIds),
        JSON.stringify(player.boardState),
        JSON.stringify(player.mulliganState || {}),
        match.id,
        player.seatNo
      ]
    );
  }
  for (const instance of resolution.cardInstances) {
    await runSql(
      db,
      `
        UPDATE arena_v2_card_instances
           SET zone = ?,
               position = ?,
               current_attack = ?,
               current_health = ?,
               damage_taken = ?,
               status_effects = ?,
               created_turn = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [
        instance.zone,
        instance.position ? JSON.stringify(instance.position) : null,
        instance.currentAttack,
        instance.currentHealth,
        instance.damageTaken,
        JSON.stringify(instance.statusEffects || []),
        instance.createdTurn,
        instance.id
      ]
    );
  }
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (resolution.nextStatus === 'completed') {
    await runSql(
      db,
      `
        UPDATE arena_v2_matches
           SET status = ?,
               turn_no = ?,
               winner_user_id = ?,
               finished_at = ?,
               replay_expires_at = ?,
               result_summary = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [
        resolution.nextStatus,
        resolution.nextTurnNo,
        resolution.winnerUserId,
        new Date().toISOString(),
        expiresAt,
        JSON.stringify(resolution.summary),
        match.id
      ]
    );
  } else {
    await runSql(
      db,
      `
        UPDATE arena_v2_matches
           SET status = ?,
               turn_no = ?,
               winner_user_id = NULL,
               result_summary = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [resolution.nextStatus, resolution.nextTurnNo, JSON.stringify(resolution.summary), match.id]
    );
  }

  const lastSeq = await queryGet<{ max_seq: number }>(
    db,
    'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM arena_v2_replay_events WHERE match_id = ?',
    [match.id]
  );
  let seq = Number(lastSeq?.max_seq || 0);
  for (const replayEvent of resolution.replayEvents) {
    seq += 1;
    await runSql(
      db,
      `
        INSERT INTO arena_v2_replay_events
          (match_id, seq, turn_no, event_type, payload, expires_at)
        VALUES
          (?, ?, ?, ?, ?, ?)
      `,
      [match.id, seq, replayEvent.turnNo, replayEvent.eventType, JSON.stringify(replayEvent.payload), expiresAt]
    );
  }

  if (match.mode === 'quick' && resolution.nextStatus === 'completed') {
    await updateArenaV2QuickRatings(db, match.season_id, match.id, resolution);
  }
};

const tierForArenaV2Mmr = (mmr: number) => {
  if (mmr >= 1800) return 'master';
  if (mmr >= 1500) return 'diamond';
  if (mmr >= 1300) return 'gold';
  if (mmr >= 1150) return 'silver';
  return 'bronze';
};

const updateArenaV2QuickRatings = async (
  db: SqlExecutor,
  seasonId: string,
  matchId: string,
  resolution: ArenaV2TurnResolutionResult
) => {
  const alreadyApplied = await queryGet<any>(
    db,
    'SELECT id FROM arena_v2_ratings WHERE season_id = ? AND last_match_id = ? LIMIT 1',
    [seasonId, matchId]
  );
  if (alreadyApplied) return;
  for (const player of resolution.players) {
    if (!player.userId) continue;
    const existing = await queryGet<any>(
      db,
      'SELECT id, mmr, peak_mmr, wins, losses, draws, last_match_id FROM arena_v2_ratings WHERE season_id = ? AND user_id = ? LIMIT 1',
      [seasonId, player.userId]
    );
    if (existing?.last_match_id === matchId) continue;
    const oldMmr = Number(existing?.mmr || 1000);
    const isDraw = resolution.result === 'draw';
    const isWin = resolution.winnerUserId === player.userId;
    const nextMmr = Math.max(0, oldMmr + (isDraw ? 0 : isWin ? 25 : -25));
    const nextPeak = Math.max(Number(existing?.peak_mmr || 1000), nextMmr);
    const tier = tierForArenaV2Mmr(nextMmr);
    const peakTier = tierForArenaV2Mmr(nextPeak);
    if (existing) {
      await runSql(
        db,
        `
          UPDATE arena_v2_ratings
             SET mmr = ?,
                 peak_mmr = ?,
                 tier = ?,
                 peak_tier = ?,
                 wins = wins + ?,
                 losses = losses + ?,
                 draws = draws + ?,
                 last_match_id = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
        `,
        [nextMmr, nextPeak, tier, peakTier, isWin ? 1 : 0, !isDraw && !isWin ? 1 : 0, isDraw ? 1 : 0, matchId, existing.id]
      );
    } else {
      await runSql(
        db,
        `
          INSERT INTO arena_v2_ratings
            (id, season_id, user_id, mmr, peak_mmr, tier, peak_tier, wins, losses, draws, last_match_id)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          makeId('arena_v2_rating'),
          seasonId,
          player.userId,
          nextMmr,
          nextPeak,
          tier,
          peakTier,
          isWin ? 1 : 0,
          !isDraw && !isWin ? 1 : 0,
          isDraw ? 1 : 0,
          matchId
        ]
      );
    }
  }
};

export const submitArenaV2TurnActions = async (input: ArenaV2SubmitTurnInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const view = await getArenaV2MatchForUser(input.matchId, input.userId);
  if (!view) throw new Error('ArenaV2MatchNotFound');
  if (view.status !== 'turn_planning' && view.status !== 'action_locked') throw new Error('ArenaV2MatchNotPlanning');
  if (view.turnNo !== input.turnNo) throw new Error('ArenaV2TurnMismatch');
  const selfSeatNo = view.selfSeatNo;
  if (selfSeatNo == null) throw new Error('ArenaV2MatchForbidden');
  const self = view.players.find((player) => player.seatNo === selfSeatNo);
  if (!self) throw new Error('ArenaV2MatchForbidden');
  const latestSubmission = await queryGet<{ max_revision: number }>(
    db,
    `
      SELECT MAX(revision) AS max_revision
        FROM arena_v2_action_submissions
       WHERE match_id = ? AND seat_no = ? AND turn_no = ?
    `,
    [input.matchId, selfSeatNo, input.turnNo]
  );
  const latestRevision = latestSubmission?.max_revision == null ? -1 : Number(latestSubmission.max_revision);
  if (Number(input.revision) <= latestRevision) throw new Error('ArenaV2RevisionNotIncreasing');
  const ownInstances = view.cardInstances.filter((instance) => instance.ownerSeatNo === selfSeatNo);
  const cardInstancesById: Record<string, any> = {};
  for (const instance of ownInstances) {
    cardInstancesById[instance.id] = {
      id: instance.id,
      cardVersionId: instance.cardVersionId,
      cost: Number(instance.card?.cost || 0),
      createdTurn: Number(instance.createdTurn || 0)
    };
  }
  const validation = validateArenaV2TurnAction({
    turnNo: view.turnNo,
    availableCost: getArenaV2AvailableCost(view.turnNo),
    handCardInstanceIds: self.handCardInstanceIds,
    boardCards: self.boardState,
    cardInstancesById,
    actions: input.actions
  });
  const submissionId = makeId('arena_v2_action');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_action_submissions
        (id, match_id, user_id, seat_no, turn_no, revision, action_payload, validation_result, is_final)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      submissionId,
      input.matchId,
      input.userId,
      selfSeatNo,
      input.turnNo,
      input.revision,
      JSON.stringify({ actions: input.actions }),
      JSON.stringify(validation),
      input.isFinal && validation.valid ? 1 : 0
    ]
  );
  if (input.isFinal && validation.valid) {
    const runtime = await loadArenaV2RuntimeMatch(db, input.matchId);
    const actionsBySeatNo = await collectArenaV2FinalActions(db, input.matchId, input.turnNo);
    if (runtime.match.mode === 'bot') {
      const botPlayer = runtime.players.find((player) => player.userId == null);
      if (botPlayer && !actionsBySeatNo[botPlayer.seatNo]) {
        const botInstances = runtime.cardInstances.filter((instance) => instance.ownerSeatNo === botPlayer.seatNo);
        const botCardInstancesById: Record<string, any> = {};
        for (const instance of botInstances) {
          botCardInstancesById[instance.id] = {
            id: instance.id,
            cardVersionId: instance.cardVersionId,
            cost: Number(instance.card?.cost || 0),
            createdTurn: Number(instance.createdTurn || 0)
          };
        }
        const botActions = createArenaV2BotTurnActions({
          turnNo: input.turnNo,
          handCardInstanceIds: botPlayer.handCardInstanceIds,
          boardCards: botPlayer.boardState,
          cardInstancesById: botCardInstancesById
        });
        const botValidation = validateArenaV2TurnAction({
          turnNo: input.turnNo,
          availableCost: getArenaV2AvailableCost(input.turnNo),
          handCardInstanceIds: botPlayer.handCardInstanceIds,
          boardCards: botPlayer.boardState,
          cardInstancesById: botCardInstancesById,
          actions: botActions
        });
        if (botValidation.valid) {
          actionsBySeatNo[botPlayer.seatNo] = botActions;
          await insertArenaV2ActionSubmission(db, {
            id: makeId('arena_v2_action'),
            matchId: input.matchId,
            userId: `bot:${input.matchId}`,
            seatNo: botPlayer.seatNo,
            turnNo: input.turnNo,
            revision: 0,
            actions: botActions,
            validation: botValidation,
            isFinal: true
          });
        }
      }
    }

    const finalSeatNos = new Set(Object.keys(actionsBySeatNo).map((seatNo) => Number(seatNo)));
    const allPlayersLocked = runtime.players.every((player) => finalSeatNos.has(player.seatNo));
    if (allPlayersLocked) {
      await resolveArenaV2TurnFromActions(db, {
        matchId: input.matchId,
        turnNo: input.turnNo,
        actionsBySeatNo
      });
    } else {
      await runSql(
        db,
        `
          UPDATE arena_v2_matches
             SET status = 'action_locked',
                 result_summary = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND turn_no = ?
        `,
        [JSON.stringify({ status: 'action_locked', lockedSeats: [...finalSeatNos], waitingSeats: runtime.players.filter((player) => !finalSeatNos.has(player.seatNo)).map((player) => player.seatNo) }), input.matchId, input.turnNo]
      );
    }
  }
  return {
    submissionId,
    validation,
    accepted: validation.valid,
    match: await getArenaV2MatchForUser(input.matchId, input.userId)
  };
};

export const processArenaV2ExpiredTurns = async (timeoutSeconds = 40, limit = 25) => {
  const db = getExecutor();
  if (!db) return { scanned: 0, resolved: 0 };
  const candidates = await queryAll<any>(
    db,
    `
      SELECT id, turn_no, status, updated_at
        FROM arena_v2_matches
       WHERE status IN ('turn_planning', 'action_locked')
       ORDER BY updated_at ASC
       LIMIT ?
    `,
    [Math.min(Math.max(Number(limit || 25), 1), 100)]
  );
  let resolved = 0;
  const cutoffMs = Date.now() - Math.max(5, Number(timeoutSeconds || 40)) * 1000;
  for (const candidate of candidates) {
    const updatedAtMs = candidate.updated_at ? Date.parse(candidate.updated_at) : 0;
    if (updatedAtMs && updatedAtMs > cutoffMs) continue;
    const runtime = await loadArenaV2RuntimeMatch(db, candidate.id);
    if (runtime.match.status !== 'turn_planning' && runtime.match.status !== 'action_locked') continue;
    const finalActions = await collectArenaV2FinalActions(db, candidate.id, Number(candidate.turn_no));
    const latestValidActions = await collectArenaV2LatestValidActions(db, candidate.id, Number(candidate.turn_no));
    const actionsBySeatNo: Record<number, ArenaV2TurnActionDto[]> = { ...finalActions };
    for (const player of runtime.players) {
      if (!actionsBySeatNo[player.seatNo]) {
        const timeoutActions = latestValidActions[player.seatNo] || [{ type: 'end' as const }];
        actionsBySeatNo[player.seatNo] = timeoutActions;
        await insertArenaV2ActionSubmission(db, {
          id: makeId('arena_v2_action'),
          matchId: candidate.id,
          userId: player.userId || `bot:${candidate.id}`,
          seatNo: player.seatNo,
          turnNo: Number(candidate.turn_no),
          revision: 1_000_000 + Number(candidate.turn_no),
          actions: timeoutActions,
          validation: { valid: true, errors: [], warnings: [{ code: 'ArenaV2TurnTimeout', message: '제한 시간 초과로 서버가 행동을 확정했습니다.' }] },
          isFinal: true
        });
      }
    }
    await resolveArenaV2TurnFromActions(db, {
      matchId: candidate.id,
      turnNo: Number(candidate.turn_no),
      actionsBySeatNo
    });
    resolved += 1;
  }
  return { scanned: candidates.length, resolved };
};

export const submitArenaV2Mulligan = async (input: ArenaV2SubmitMulliganInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const view = await getArenaV2MatchForUser(input.matchId, input.userId);
  if (!view) throw new Error('ArenaV2MatchNotFound');
  if (view.status !== 'mulligan') throw new Error('ArenaV2MatchNotMulligan');
  const selfSeatNo = view.selfSeatNo;
  if (selfSeatNo == null) throw new Error('ArenaV2MatchForbidden');
  const self = view.players.find((player) => player.seatNo === selfSeatNo);
  if (!self) throw new Error('ArenaV2MatchForbidden');

  const replaceSet = new Set(input.replaceCardInstanceIds);
  if (replaceSet.size > 3) throw new Error('ArenaV2MulliganTooManyCards');
  const handSet = new Set(self.handCardInstanceIds);
  for (const id of replaceSet) {
    if (!handSet.has(id)) throw new Error('ArenaV2MulliganCardInvalid');
  }

  const currentPlayer = await queryGet<any>(
    db,
    `
      SELECT hand_card_instance_ids, deck_card_instance_ids, mulligan_state
        FROM arena_v2_match_players
       WHERE match_id = ? AND seat_no = ?
       LIMIT 1
    `,
    [input.matchId, selfSeatNo]
  );
  if (!currentPlayer) throw new Error('ArenaV2MatchForbidden');

  const hand = jsonParse<string[]>(currentPlayer.hand_card_instance_ids, []);
  const deck = jsonParse<string[]>(currentPlayer.deck_card_instance_ids, []);
  const currentMulliganState = jsonParse<{ done?: boolean }>(currentPlayer.mulligan_state, {});
  if (currentMulliganState.done) throw new Error('ArenaV2MulliganAlreadyDone');
  const kept = hand.filter((id) => !replaceSet.has(id));
  const returned = hand.filter((id) => replaceSet.has(id));
  const drawn = deck.slice(0, returned.length);
  const remainingDeck = stableShuffle(
    [...deck.slice(returned.length), ...returned].map((id) => ({ id })),
    `${input.matchId}:mulligan:${selfSeatNo}:${returned.join(':')}`
  ).map((item) => item.id);
  const nextHand = [...kept, ...drawn];
  const mulliganState = {
    done: true,
    replaced: returned,
    kept,
    submittedAt: new Date().toISOString()
  };

  await runSql(
    db,
    `
      UPDATE arena_v2_match_players
         SET hand_card_instance_ids = ?,
             deck_card_instance_ids = ?,
             mulligan_state = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE match_id = ? AND seat_no = ?
    `,
    [JSON.stringify(nextHand), JSON.stringify(remainingDeck), JSON.stringify(mulliganState), input.matchId, selfSeatNo]
  );
  for (const cardInstanceId of drawn) {
    await runSql(
      db,
      `
        UPDATE arena_v2_card_instances
           SET zone = 'hand',
               position = NULL,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [cardInstanceId]
    );
  }
  for (const cardInstanceId of returned) {
    await runSql(
      db,
      `
        UPDATE arena_v2_card_instances
           SET zone = 'deck',
               position = NULL,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `,
      [cardInstanceId]
    );
  }
  const allPlayers = await queryAll<any>(
    db,
    `
      SELECT seat_no, user_id, mulligan_state
        FROM arena_v2_match_players
       WHERE match_id = ?
       ORDER BY seat_no ASC
    `,
    [input.matchId]
  );
  const allMulligansDone = view.mode === 'bot' || allPlayers.every((player) => jsonParse<{ done?: boolean }>(player.mulligan_state, {}).done);
  if (allMulligansDone) {
    await runSql(
      db,
      `
        UPDATE arena_v2_matches
           SET status = 'turn_planning',
               result_summary = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'mulligan'
      `,
      [JSON.stringify({ status: 'turn_planning', mulliganSeatNo: selfSeatNo, readySeats: allPlayers.map((player) => Number(player.seat_no)) }), input.matchId]
    );
  } else {
    const readySeats = allPlayers
      .filter((player) => jsonParse<{ done?: boolean }>(player.mulligan_state, {}).done)
      .map((player) => Number(player.seat_no));
    await runSql(
      db,
      `
        UPDATE arena_v2_matches
           SET result_summary = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'mulligan'
      `,
      [JSON.stringify({ status: 'mulligan', readySeats, waitingSeats: allPlayers.filter((player) => !readySeats.includes(Number(player.seat_no))).map((player) => Number(player.seat_no)) }), input.matchId]
    );
  }
  return {
    accepted: true,
    mulliganState,
    match: await getArenaV2MatchForUser(input.matchId, input.userId)
  };
};

export const getArenaV2Replay = async (matchId: string, userId?: string | null) => {
  const db = getExecutor();
  if (!db) return null;
  const match = await getArenaV2MatchForUser(matchId, userId);
  if (!match) return null;
  const replayState = await queryGet<any>(
    db,
    'SELECT replay_expires_at, status FROM arena_v2_matches WHERE id = ? LIMIT 1',
    [matchId]
  );
  const replayExpiresAt = replayState?.replay_expires_at ? Date.parse(replayState.replay_expires_at) : 0;
  const events = await queryAll<any>(
    db,
    `
      SELECT id, match_id, seq, turn_no, event_type, payload, created_at, expires_at
        FROM arena_v2_replay_events
       WHERE match_id = ?
       ORDER BY seq ASC
       LIMIT 5000
    `,
    [matchId]
  );
  if (events.length === 0 && replayExpiresAt > 0 && replayExpiresAt < Date.now()) {
    throw new Error('ArenaReplayExpired');
  }
  return {
    match,
    events: events.map((event) => ({
      id: event.id,
      matchId: event.match_id,
      seq: Number(event.seq || 0),
      turnNo: Number(event.turn_no || 0),
      eventType: event.event_type,
      payload: jsonParse(event.payload, {}),
      createdAt: event.created_at,
      expiresAt: event.expires_at
    }))
  };
};

export const pruneArenaV2ExpiredReplayEvents = async (limit = 5000) => {
  const db = getExecutor();
  if (!db) return { pruned: 0, held: 0 };
  const now = new Date().toISOString();
  const heldRows = await queryAll<any>(
    db,
    `
      SELECT DISTINCT match_id
        FROM arena_v2_replay_holds
       WHERE status = 'active'
         AND (hold_until IS NULL OR hold_until >= ?)
       LIMIT ?
    `,
    [now, Math.min(Math.max(Number(limit || 5000), 1), 20000)]
  );
  const result = await runSql(
    db,
    `
      DELETE FROM arena_v2_replay_events
       WHERE expires_at < ?
         AND match_id NOT IN (
           SELECT match_id
             FROM arena_v2_replay_holds
            WHERE status = 'active'
              AND (hold_until IS NULL OR hold_until >= ?)
         )
       LIMIT ?
    `,
    [now, now, Math.min(Math.max(Number(limit || 5000), 1), 20000)]
  );
  return {
    pruned: Number(result?.changes ?? result?.affectedRows ?? 0),
    held: heldRows.length
  };
};

export const listArenaV2Rankings = async (seasonId?: string, limit = 100) => {
  const db = getExecutor();
  if (!db) return { seasonId: seasonId || null, source: 'arena_v2_ratings_empty', updatedAt: null, items: [] };
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return { seasonId: null, source: 'arena_v2_ratings_empty', updatedAt: null, items: [] };
  const rows = await queryAll<any>(
    db,
    `
      SELECT season_id, user_id, mmr, peak_mmr, tier, peak_tier, wins, losses, draws, updated_at
        FROM arena_v2_ratings
       WHERE season_id = ?
       ORDER BY mmr DESC, peak_mmr DESC, updated_at ASC
       LIMIT ?
    `,
    [season.id, Math.min(Math.max(Number(limit || 100), 1), 200)]
  );
  return {
    seasonId: season.id,
    source: rows.length ? 'arena_v2_ratings' : 'arena_v2_ratings_empty',
    updatedAt: rows[0]?.updated_at || null,
    items: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      displayName: row.user_id,
      mmr: Number(row.mmr || 1000),
      peakMmr: Number(row.peak_mmr || row.mmr || 1000),
      tier: row.tier || 'bronze',
      peakTier: row.peak_tier || row.tier || 'bronze',
      wins: Number(row.wins || 0),
      losses: Number(row.losses || 0),
      draws: Number(row.draws || 0),
      updatedAt: row.updated_at
    }))
  };
};

export const getArenaV2CurrentRewardsForUser = async (userId: string, seasonId?: string) => {
  const db = getExecutor();
  if (!db) return null;
  const season = seasonId ? { id: seasonId } : await getArenaV2CurrentSeason();
  if (!season?.id) return null;
  const rating = await queryGet<any>(
    db,
    `
      SELECT season_id, user_id, mmr, peak_mmr, tier, peak_tier, wins, losses, draws
        FROM arena_v2_ratings
       WHERE season_id = ? AND user_id = ?
       LIMIT 1
    `,
    [season.id, userId]
  );
  const grant = await queryGet<any>(
    db,
    `
      SELECT id, reward_basis, reward_items, status, hold_reason, granted_at, created_at, updated_at
        FROM arena_v2_reward_grants
       WHERE season_id = ? AND user_id = ?
       LIMIT 1
    `,
    [season.id, userId]
  );
  return {
    seasonId: season.id,
    rating: rating ? {
      mmr: Number(rating.mmr || 1000),
      peakMmr: Number(rating.peak_mmr || rating.mmr || 1000),
      tier: rating.tier || 'bronze',
      peakTier: rating.peak_tier || rating.tier || 'bronze',
      wins: Number(rating.wins || 0),
      losses: Number(rating.losses || 0),
      draws: Number(rating.draws || 0)
    } : {
      mmr: 1000,
      peakMmr: 1000,
      tier: 'bronze',
      peakTier: 'bronze',
      wins: 0,
      losses: 0,
      draws: 0
    },
    grant: grant ? {
      id: grant.id,
      rewardBasis: jsonParse(grant.reward_basis, {}),
      rewardItems: jsonParse(grant.reward_items, []),
      status: grant.status,
      holdReason: grant.hold_reason,
      grantedAt: grant.granted_at,
      createdAt: grant.created_at,
      updatedAt: grant.updated_at
    } : null
  };
};

export const getArenaV2BattleRoyale = async (battleRoyaleId: string, userId?: string | null) => {
  const db = getExecutor();
  if (!db) return null;
  const row = await queryGet<any>(
    db,
    `
      SELECT id, season_id, status, current_round_no, participant_state, match_ids, winner_user_id, created_at, updated_at, finished_at
        FROM arena_v2_battle_royales
       WHERE id = ?
       LIMIT 1
    `,
    [battleRoyaleId]
  );
  if (!row) return null;
  const participantState = jsonParse<any[]>(row.participant_state, []);
  if (userId && Array.isArray(participantState) && participantState.length > 0) {
    const isParticipant = participantState.some((participant) => participant?.userId === userId || participant?.user_id === userId);
    if (!isParticipant) return null;
  }
  return {
    id: row.id,
    seasonId: row.season_id,
    status: row.status,
    currentRoundNo: Number(row.current_round_no || 0),
    participantState,
    matchIds: jsonParse<string[]>(row.match_ids, []),
    winnerUserId: row.winner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at
  };
};

export const listArenaV2WikiEntries = () => ([
  { slug: 'core-rules', title: '핵심 규칙', category: 'rules', status: 'active', updatedAt: '2026-07-07' },
  { slug: 'deck-building', title: '덱 빌딩', category: 'rules', status: 'active', updatedAt: '2026-07-07' },
  { slug: 'battle-royale-8', title: '8인 배틀로얄', category: 'mode', status: 'active', updatedAt: '2026-07-07' },
  { slug: 'reports-rights', title: '신고와 스트리머 권리', category: 'operations', status: 'active', updatedAt: '2026-07-07' }
]);

export const getArenaV2WikiEntry = (slug: string) => {
  const entry = listArenaV2WikiEntries().find((item) => item.slug === slug);
  if (!entry) return null;
  const bodyBySlug: Record<string, string[]> = {
    'core-rules': ['2x3 전장, 손패, 코스트, 동시 턴 제출을 기준으로 진행한다.', '서버가 모든 행동을 검증하고 결과를 확정한다.'],
    'deck-building': ['덱은 같은 시즌의 활성 카드 14~20장으로 구성한다.', '동일 카드 버전과 동일 스트리머 카드는 각각 1장까지만 허용한다.'],
    'battle-royale-8': ['8명이 큐에 모이면 배틀로얄 방을 생성하고 라운드별 매치를 진행한다.', '탈락자 순위와 생존 상태는 battle royale 상태에 저장한다.'],
    'reports-rights': ['신고, 리플레이 보존, 스트리머 권리 요청은 v2 전용 테이블로 분리한다.', '운영자는 신고와 권리 요청을 별도 검토 큐에서 처리한다.']
  };
  return { ...entry, body: bodyBySlug[slug] || [] };
};

const serializeArenaV2MatchView = (match: any, players: any[], instances: any[], selfSeatNo: number | null) => ({
  id: match.id,
  seasonId: match.season_id,
  mode: match.mode,
  status: match.status,
  battleRoyaleId: match.battle_royale_id,
  roundNo: Number(match.round_no || 0),
  turnNo: Number(match.turn_no || 1),
  rulesVersion: match.rules_version,
  cardPoolVersion: match.card_pool_version,
  startedAt: match.started_at,
  finishedAt: match.finished_at,
  winnerUserId: match.winner_user_id,
  resultSummary: jsonParse(match.result_summary, {}),
  selfSeatNo,
  players: players.map((player) => {
    const seatNo = Number(player.seat_no);
    const handCardInstanceIds = jsonParse<string[]>(player.hand_card_instance_ids, []);
    return {
      seatNo,
      userId: player.user_id,
      deckId: player.deck_id,
      playerHealth: Number(player.player_health || 30),
      fatigueCount: Math.max(0, Number(player.fatigue_count || 0)),
      handCardInstanceIds: seatNo === selfSeatNo ? handCardInstanceIds : [],
      handCount: handCardInstanceIds.length,
      deckCount: jsonParse<string[]>(player.deck_card_instance_ids, []).length,
      graveyardCardInstanceIds: jsonParse<string[]>(player.graveyard_card_instance_ids, []),
      boardState: jsonParse(player.board_state, []),
      mulliganState: seatNo === selfSeatNo ? jsonParse(player.mulligan_state, {}) : {}
    };
  }),
  cardInstances: instances.filter((instance) => isArenaV2CardInstanceVisibleToSeat(instance, selfSeatNo)).map((instance) => ({
    id: instance.id,
    ownerSeatNo: Number(instance.owner_seat_no),
    cardVersionId: instance.card_version_id,
    card: instance.display_name ? {
      id: instance.card_version_id,
      streamerId: instance.streamer_id,
      displayName: instance.display_name,
      seasonId: instance.season_id,
      version: Number(instance.version || 1),
      cardClass: instance.card_class,
      cost: Number(instance.cost || 0),
      attack: Number(instance.attack || instance.current_attack || 0),
      health: Number(instance.health || instance.current_health || 1),
      keywords: jsonParse(instance.keywords, []),
      status: instance.card_status || 'active'
    } : undefined,
    zone: instance.zone,
    position: jsonParse(instance.position, null),
    currentAttack: Number(instance.current_attack || 0),
    currentHealth: Number(instance.current_health || 0),
    damageTaken: Number(instance.damage_taken || 0),
    statusEffects: jsonParse(instance.status_effects, []),
    createdTurn: Number(instance.created_turn || 0)
  }))
});

function isArenaV2CardInstanceVisibleToSeat(instance: any, selfSeatNo: number | null): boolean {
  const ownerSeatNo = Number(instance.owner_seat_no);
  if (ownerSeatNo === selfSeatNo) return true;
  return instance.zone === 'board' || instance.zone === 'graveyard' || instance.zone === 'banished';
}

const loadArenaV2CardVersionsByIds = async (db: SqlExecutor, ids: string[]) => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = await queryAll<any>(
    db,
    `
      SELECT id, cost, attack, health
        FROM arena_v2_card_versions
       WHERE id IN (${placeholders}) AND status = 'active'
    `,
    ids
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

const createArenaV2MatchFromDeckSeats = async (
  db: SqlExecutor,
  input: {
    seasonId: string;
    cardPoolVersion: string;
    mode: 'quick' | 'battle_royale_8';
    battleRoyaleId: string | null;
    roundNo: number;
    seats: Array<{ seatNo: number; userId: string; deckId: string }>;
    summary: Record<string, unknown>;
  }
) => {
  const matchId = makeId('arena_v2_match');
  const seed = stableHash(`chikapo-arena-v2:${matchId}:${input.mode}:${input.seats.map((seat) => seat.userId).join(':')}:${Date.now()}`);
  await runSql(
    db,
    `
      INSERT INTO arena_v2_matches
        (id, season_id, mode, status, battle_royale_id, round_no, turn_no, rng_seed, rules_version, card_pool_version, result_summary)
      VALUES
        (?, ?, ?, 'mulligan', ?, ?, 1, ?, 'arena-v2-gdd-1.0.0', ?, ?)
    `,
    [
      matchId,
      input.seasonId,
      input.mode,
      input.battleRoyaleId,
      input.roundNo,
      seed,
      input.cardPoolVersion,
      JSON.stringify(input.summary)
    ]
  );

  for (const seat of input.seats) {
    const deck = await queryGet<any>(
      db,
      'SELECT id, user_id, season_id, card_version_ids, is_valid FROM arena_v2_decks WHERE id = ? LIMIT 1',
      [seat.deckId]
    );
    if (!deck) throw new Error('ArenaV2DeckNotFound');
    if (deck.user_id !== seat.userId) throw new Error('ArenaV2DeckForbidden');
    if (deck.season_id !== input.seasonId) throw new Error('ArenaV2DeckSeasonMismatch');
    if (!Boolean(Number(deck.is_valid))) throw new Error('ArenaV2DeckInvalid');
    const cardVersionIds = jsonParse<string[]>(deck.card_version_ids, []);
    const validation = await validateArenaV2DeckForSeason(input.seasonId, cardVersionIds);
    if (!validation.valid) throw new Error('ArenaV2DeckInvalid');
    const cards = await loadArenaV2CardVersionsByIds(db, cardVersionIds);
    const ordered = stableShuffle(cards, `${seed}:seat:${seat.seatNo}`).map((card) => ({
      instanceId: makeId('arena_v2_card'),
      card
    }));
    await insertArenaV2MatchPlayer(db, {
      matchId,
      userId: seat.userId,
      seatNo: seat.seatNo,
      deckId: seat.deckId,
      orderedInstances: ordered
    });
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index];
      await runSql(
        db,
        `
          INSERT INTO arena_v2_card_instances
            (id, match_id, owner_seat_no, card_version_id, zone, position, current_attack, current_health, damage_taken, status_effects, created_turn)
          VALUES
            (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?, 0)
        `,
        [
          item.instanceId,
          matchId,
          seat.seatNo,
          item.card.id,
          index < 5 ? 'hand' : 'deck',
          Number(item.card.attack || 0),
          Number(item.card.health || 1),
          JSON.stringify([])
        ]
      );
    }
  }
  return matchId;
};

const insertArenaV2MatchPlayer = async (
  db: SqlExecutor,
  input: {
    matchId: string;
    userId: string | null;
    seatNo: number;
    deckId: string | null;
    orderedInstances: Array<{ instanceId: string; card: any }>;
  }
) => {
  const hand = input.orderedInstances.slice(0, 5).map((item) => item.instanceId);
  const deck = input.orderedInstances.slice(5).map((item) => item.instanceId);
  await runSql(
    db,
    `
      INSERT INTO arena_v2_match_players
        (id, match_id, user_id, seat_no, deck_id, player_health, fatigue_count, initial_deck_order, hand_card_instance_ids, deck_card_instance_ids, graveyard_card_instance_ids, board_state, mulligan_state)
      VALUES
        (?, ?, ?, ?, ?, 30, 0, ?, ?, ?, ?, ?, ?)
    `,
    [
      makeId('arena_v2_player'),
      input.matchId,
      input.userId,
      input.seatNo,
      input.deckId,
      JSON.stringify(input.orderedInstances.map((item) => item.instanceId)),
      JSON.stringify(hand),
      JSON.stringify(deck),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({ done: false, replaced: [] })
    ]
  );
};

export const arenaV2TargetExists = async (targetType: ArenaV2ReportInput['targetType'], targetId: string): Promise<boolean> => {
  const db = getExecutor();
  if (!db) return false;
  const tableByTarget: Record<ArenaV2ReportInput['targetType'], string> = {
    card: 'arena_v2_card_versions',
    match: 'arena_v2_matches',
    replay: 'arena_v2_replay_events',
    user: 'users',
    battle_royale: 'arena_v2_battle_royales'
  };
  const table = tableByTarget[targetType];
  if (targetType === 'replay') {
    const row = await queryGet(db, `SELECT 1 AS ok FROM ${table} WHERE match_id = ? LIMIT 1`, [targetId]);
    return Boolean(row);
  }
  const row = await queryGet(db, `SELECT 1 AS ok FROM ${table} WHERE id = ? LIMIT 1`, [targetId]);
  return Boolean(row);
};

export const createArenaV2Report = async (input: ArenaV2ReportInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const id = makeId('arena_v2_report');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_reports
        (id, reporter_user_id, target_type, target_id, reason, status)
      VALUES
        (?, ?, ?, ?, ?, 'received')
    `,
    [id, input.reporterUserId, input.targetType, input.targetId, input.reason]
  );
  return { id, status: 'received' as const };
};

export const listArenaV2ReportsForUser = async (userId: string, limit = 50) => {
  const db = getExecutor();
  if (!db) return [];
  return queryAll(
    db,
    `
      SELECT id, target_type, target_id, reason, status, admin_note, created_at, updated_at
        FROM arena_v2_reports
       WHERE reporter_user_id = ?
       ORDER BY created_at DESC
       LIMIT ?
    `,
    [userId, Math.min(Math.max(limit, 1), 100)]
  );
};

export const listArenaV2ReportsAdmin = async (status?: string, limit = 100) => {
  const db = getExecutor();
  if (!db) return [];
  const params: any[] = [];
  const statusFilter = status ? 'WHERE status = ?' : '';
  if (status) params.push(status);
  params.push(Math.min(Math.max(limit, 1), 200));
  return queryAll(
    db,
    `
      SELECT id, reporter_user_id, target_type, target_id, reason, status, admin_note, created_at, updated_at
        FROM arena_v2_reports
       ${statusFilter}
       ORDER BY created_at DESC
       LIMIT ?
    `,
    params
  );
};

export const reviewArenaV2ReportAdmin = async (reportId: string, reviewerUserId: string, status: 'actioned' | 'rejected', adminNote: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await queryGet<any>(db, 'SELECT id FROM arena_v2_reports WHERE id = ? LIMIT 1', [reportId]);
  if (!existing) throw new Error('ArenaV2ReportNotFound');
  await runSql(
    db,
    `
      UPDATE arena_v2_reports
         SET status = ?,
             admin_note = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [status, adminNote || `reviewed_by:${reviewerUserId}`, reportId]
  );
  return { id: reportId, status };
};

export const createArenaV2StreamerRightRequest = async (input: ArenaV2StreamerRightRequestInput) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const id = makeId('arena_v2_right');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_streamer_right_requests
        (id, streamer_id, requester_user_id, request_type, payload, status)
      VALUES
        (?, ?, ?, ?, ?, 'pending')
    `,
    [id, input.streamerId, input.requesterUserId, input.requestType, JSON.stringify(input.payload ?? {})]
  );
  return { id, status: 'pending' as const };
};

export const listArenaV2StreamerRightRequestsForUser = async (userId: string, streamerId?: string, limit = 50) => {
  const db = getExecutor();
  if (!db) return [];
  const params: any[] = [userId];
  const streamerFilter = streamerId ? 'AND streamer_id = ?' : '';
  if (streamerId) params.push(streamerId);
  params.push(Math.min(Math.max(limit, 1), 100));
  return queryAll(
    db,
    `
      SELECT id, streamer_id, request_type, payload, status, review_note, created_at, updated_at
        FROM arena_v2_streamer_right_requests
       WHERE requester_user_id = ?
       ${streamerFilter}
       ORDER BY created_at DESC
       LIMIT ?
    `,
    params
  );
};

export const listArenaV2StreamerRightRequestsAdmin = async (status?: string, limit = 100) => {
  const db = getExecutor();
  if (!db) return [];
  const params: any[] = [];
  const statusFilter = status ? 'WHERE status = ?' : '';
  if (status) params.push(status);
  params.push(Math.min(Math.max(limit, 1), 200));
  return queryAll(
    db,
    `
      SELECT id, streamer_id, requester_user_id, request_type, payload, status, reviewed_by, review_note, created_at, updated_at
        FROM arena_v2_streamer_right_requests
       ${statusFilter}
       ORDER BY created_at DESC
       LIMIT ?
    `,
    params
  );
};

export const reviewArenaV2StreamerRightRequestAdmin = async (requestId: string, reviewerUserId: string, status: 'approved' | 'rejected', reviewNote: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const existing = await queryGet<any>(
    db,
    'SELECT id, requester_user_id, request_type, payload FROM arena_v2_streamer_right_requests WHERE id = ? LIMIT 1',
    [requestId]
  );
  if (!existing) throw new Error('ArenaV2StreamerRightRequestNotFound');
  let appliedCard: unknown = null;
  if (status === 'approved' && existing.request_type === 'card_config') {
    const payload = jsonParse<Record<string, unknown>>(existing.payload, {});
    const result = await updateMyArenaV2StreamerCard({
      requesterUserId: existing.requester_user_id,
      displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined,
      cardClass: String(payload.cardClass || ''),
      cost: Number(payload.cost),
      attack: Number(payload.attack),
      health: Number(payload.health),
      keywords: Array.isArray(payload.keywords) ? payload.keywords : [],
      artAssetId: typeof payload.artAssetId === 'string' ? payload.artAssetId : undefined
    });
    if (!result.accepted) {
      await runSql(
        db,
        `
          UPDATE arena_v2_streamer_right_requests
             SET status = 'rejected',
                 reviewed_by = ?,
                 review_note = ?,
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = ?
        `,
        [reviewerUserId, reviewNote || JSON.stringify(result.validation), requestId]
      );
      return { id: requestId, status: 'rejected' as const, validation: result.validation };
    }
    appliedCard = result.card;
  }
  await runSql(
    db,
    `
      UPDATE arena_v2_streamer_right_requests
         SET status = ?,
             reviewed_by = ?,
             review_note = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [status, reviewerUserId, reviewNote, requestId]
  );
  return { id: requestId, status, appliedCard };
};

export const holdArenaV2RewardGrantAdmin = async (grantId: string, reason: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  await runSql(
    db,
    `
      UPDATE arena_v2_reward_grants
         SET status = 'held',
             hold_reason = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [reason, grantId]
  );
  return { id: grantId, status: 'held' as const };
};

export const releaseArenaV2RewardGrantAdmin = async (grantId: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  await runSql(
    db,
    `
      UPDATE arena_v2_reward_grants
         SET status = 'pending',
             hold_reason = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `,
    [grantId]
  );
  return { id: grantId, status: 'pending' as const };
};

export const createArenaV2ReplayHoldAdmin = async (matchId: string, adminUserId: string, reason: string, holdUntil?: string) => {
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  const match = await queryGet<any>(db, 'SELECT id FROM arena_v2_matches WHERE id = ? LIMIT 1', [matchId]);
  if (!match) throw new Error('ArenaV2MatchNotFound');
  const id = makeId('arena_v2_replay_hold');
  await runSql(
    db,
    `
      INSERT INTO arena_v2_replay_holds
        (id, match_id, reason, status, hold_until, created_by)
      VALUES
        (?, ?, ?, 'active', ?, ?)
    `,
    [id, matchId, reason, holdUntil || null, adminUserId]
  );
  return { id, matchId, status: 'active' as const };
};

export const previewArenaV2SeasonRewardsAdmin = async (seasonId: string) => {
  const rankings = await listArenaV2Rankings(seasonId, 200);
  const season = await getArenaV2SeasonById(seasonId);
  const rewardTable = Array.isArray(season?.rewardTable) ? season.rewardTable as ArenaV2RewardRule[] : [];
  const tiers: Record<string, number> = {};
  const grants = rankings.items.map((item) => {
    tiers[item.peakTier] = (tiers[item.peakTier] || 0) + 1;
    return {
      userId: item.userId,
      rank: item.rank,
      peakTier: item.peakTier,
      peakMmr: item.peakMmr,
      rewardItems: resolveArenaV2RewardItems(rewardTable, item)
    };
  });
  return {
    seasonId,
    tiers,
    totalPlayers: rankings.items.length,
    rewardRules: rewardTable.length,
    grants,
    duplicateRisk: false,
    heldAccounts: 0
  };
};

export const grantArenaV2SeasonRewardsAdmin = async (seasonId: string, dryRun: boolean, reason: string) => {
  const preview = await previewArenaV2SeasonRewardsAdmin(seasonId);
  if (dryRun) {
    return {
      dryRun,
      reason,
      preview,
      granted: 0,
      skipped: 0,
      status: 'preview'
    };
  }
  const db = getExecutor();
  if (!db) throw new Error('ArenaV2SqlDbRequired');
  let granted = 0;
  let skipped = 0;
  for (const grant of preview.grants) {
    const existing = await queryGet<any>(
      db,
      'SELECT id FROM arena_v2_reward_grants WHERE season_id = ? AND user_id = ? LIMIT 1',
      [seasonId, grant.userId]
    );
    if (existing) {
      skipped += 1;
      continue;
    }
    const rewardBasis = {
      reason,
      rank: grant.rank,
      peakTier: grant.peakTier,
      peakMmr: grant.peakMmr,
      generatedAt: new Date().toISOString()
    };
    await runSql(
      db,
      `
        INSERT INTO arena_v2_reward_grants
          (id, season_id, user_id, reward_basis, reward_items, status, hold_reason, idempotency_key, granted_at)
        VALUES
          (?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)
      `,
      [
        makeId('arena_v2_reward'),
        seasonId,
        grant.userId,
        JSON.stringify(rewardBasis),
        JSON.stringify(grant.rewardItems),
        `arena-v2:${seasonId}:${grant.userId}`
      ]
    );
    granted += 1;
  }
  return {
    dryRun,
    reason,
    preview,
    granted,
    skipped,
    status: 'grants_created'
  };
};

function resolveArenaV2RewardItems(rewardTable: ArenaV2RewardRule[], ranking: { rank: number; peakTier: string; peakMmr: number }) {
  const items: unknown[] = [];
  for (const rule of rewardTable) {
    const tiers = new Set([rule.tier, ...(Array.isArray(rule.tiers) ? rule.tiers : [])].filter(Boolean).map((tier) => String(tier).toLowerCase()));
    const rankMin = Number(rule.rankMin ?? rule.minRank ?? 1);
    const rankMax = Number(rule.rankMax ?? rule.maxRank ?? Number.MAX_SAFE_INTEGER);
    const tierMatches = tiers.size === 0 || tiers.has(String(ranking.peakTier).toLowerCase());
    const rankMatches = ranking.rank >= rankMin && ranking.rank <= rankMax;
    if (!tierMatches || !rankMatches) continue;
    const ruleItems = Array.isArray(rule.items)
      ? rule.items
      : Array.isArray(rule.rewards)
        ? rule.rewards
        : Array.isArray(rule.rewardItems)
          ? rule.rewardItems
          : [];
    items.push(...ruleItems);
  }
  return items;
}

export const recordArenaV2OpsFlagAdmin = async (adminUserId: string, flag: string, enabled: boolean, reason: string) => ({
  flag,
  enabled,
  reason,
  updatedBy: adminUserId,
  updatedAt: new Date().toISOString()
});
