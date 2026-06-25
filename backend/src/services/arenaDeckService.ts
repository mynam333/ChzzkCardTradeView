import { createHash } from 'crypto';
import { getDbMode, getMysqlDb, getSqliteDb } from './db';
import {
  ARENA_BOARD_COLS,
  ARENA_BOARD_ROWS,
  ARENA_DECK_MAX_CARD_COUNT,
  ARENA_DECK_MIN_CARD_COUNT,
  ARENA_MATCH_FORMAT,
  ARENA_ROUND_MAX_DEPLOY_COUNT,
  ARENA_ROUND_PLAN_MAX_COUNT,
  ARENA_TACTIC_CHIPS,
  ArenaRoundNo
} from './arenaRules';
import { listDisabledArenaStreamerIds } from './arenaStreamerCardState';
import { streamerRepository, userCardRepository } from '../repositories';
import { getArenaCurrentSeasonId } from './arenaSeasonService';

export const ARENA_CURRENT_SEASON_ID = 'arena-preseason-0';
const MAX_DECKS_PER_USER = Math.max(1, Number(process.env.ARENA_MAX_DECKS_PER_USER || 12));

export interface ArenaDeckCardRef {
  card_id: string;
  channel_id: string;
}

export interface ArenaRoundPlanSlot {
  card_id: string;
  channel_id: string;
  row: 0 | 1;
  col: 0 | 1 | 2 | 3;
}

export interface ArenaRoundPlan {
  round_no: ArenaRoundNo;
  formation_id: string;
  tactic_style: string;
  focus_rule: string;
  slots: ArenaRoundPlanSlot[];
}

export interface ArenaDeck {
  id: string;
  user_id: string;
  season_id: string;
  name: string;
  cards: ArenaDeckCardRef[];
  round_plans: ArenaRoundPlan[];
  strategy_chip_id: string;
  deck_hash: string;
  validation_status: 'VALID' | 'INVALID';
  validation_result: ArenaDeckValidationResult;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArenaDeckValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized_cards: ArenaDeckCardRef[];
  normalized_round_plans: ArenaRoundPlan[];
  normalized_strategy_chip_id: string;
  deck_rule: {
    deck_min_card_count: typeof ARENA_DECK_MIN_CARD_COUNT;
    deck_max_card_count: typeof ARENA_DECK_MAX_CARD_COUNT;
    round_max_deploy_count: typeof ARENA_ROUND_MAX_DEPLOY_COUNT;
    round_plan_max_count: typeof ARENA_ROUND_PLAN_MAX_COUNT;
    board_rows: typeof ARENA_BOARD_ROWS;
    board_cols: typeof ARENA_BOARD_COLS;
    duplicate_streamer_card: false;
    disabled_streamer_card_allowed: false;
    match_format: typeof ARENA_MATCH_FORMAT;
  };
}

type RawDeckRow = {
  id: number | string | bigint;
  user_id: string;
  season_id: string;
  name: string;
  cards_json: string;
  round_plans_json: string;
  strategy_chip_id?: string | null;
  deck_hash: string;
  validation_status: string;
  validation_result_json: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

let ensureTablePromise: Promise<void> | null = null;
let knownStreamerIdsCache: { ids: Set<string>; expiresAt: number } | null = null;
let knownStreamerIdsInFlight: Promise<Set<string>> | null = null;
const STREAMER_ID_CACHE_TTL_MS = Math.max(60_000, Number(process.env.ARENA_STREAMER_ID_CACHE_TTL_MS || 300_000));

const getCardIdChannel = (cardId: unknown): string => {
  const trimmed = String(cardId || '').trim();
  return trimmed.startsWith('arena_streamer_') ? trimmed.replace(/^arena_streamer_/, '') : trimmed;
};

const toCardId = (channelId: string) => `arena_streamer_${channelId}`;

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const hashDeck = (cards: ArenaDeckCardRef[], roundPlans: ArenaRoundPlan[], strategyChipId: string) =>
  createHash('sha256')
    .update(JSON.stringify({ cards, round_plans: roundPlans, strategy_chip_id: strategyChipId }))
    .digest('hex');

const loadKnownStreamerIds = async (): Promise<Set<string>> => {
  const now = Date.now();
  if (knownStreamerIdsCache && knownStreamerIdsCache.expiresAt > now) return knownStreamerIdsCache.ids;
  if (knownStreamerIdsInFlight) return knownStreamerIdsInFlight;

  knownStreamerIdsInFlight = streamerRepository.findAll()
    .then((streamers) => {
      const ids = new Set(streamers.map((streamer) => streamer.channel_id).filter(Boolean));
      knownStreamerIdsCache = { ids, expiresAt: Date.now() + STREAMER_ID_CACHE_TTL_MS };
      return ids;
    })
    .finally(() => {
      knownStreamerIdsInFlight = null;
    });

  return knownStreamerIdsInFlight;
};
const loadOwnedArenaChannelIds = async (userId: string): Promise<Set<string>> => {
  const ownedCards = await userCardRepository.findByUserId(userId);
  return new Set(
    ownedCards
      .map((card: any) => String(card?.channel_id || '').trim())
      .filter(Boolean)
  );
};

const normalizeCardsInput = (body: any): ArenaDeckCardRef[] => {
  const source = Array.isArray(body?.cards)
    ? body.cards
    : Array.isArray(body?.card_ids)
      ? body.card_ids
      : [];

  return source
    .map((item: any) => {
      const channelId = getCardIdChannel(typeof item === 'string' ? item : item?.card_id || item?.channel_id);
      return channelId ? { card_id: toCardId(channelId), channel_id: channelId } : null;
    })
    .filter((item: ArenaDeckCardRef | null): item is ArenaDeckCardRef => Boolean(item));
};

const normalizeSlot = (slot: any): ArenaRoundPlanSlot | null => {
  const channelId = getCardIdChannel(slot?.card_id || slot?.channel_id);
  const row = Number(slot?.row ?? slot?.position?.row);
  const col = Number(slot?.col ?? slot?.position?.col);
  if (!channelId || !Number.isInteger(row) || !Number.isInteger(col)) return null;
  return {
    card_id: toCardId(channelId),
    channel_id: channelId,
    row: row as 0 | 1,
    col: col as 0 | 1 | 2 | 3
  };
};

const buildDefaultRoundPlan = (cards: ArenaDeckCardRef[], roundNo: ArenaRoundNo): ArenaRoundPlan => ({
  round_no: roundNo,
  formation_id: 'default-2x4',
  tactic_style: 'balanced',
  focus_rule: 'frontline_first',
  slots: cards.slice(0, 6).map((card, index) => ({
    ...card,
    row: (index < 3 ? 1 : 0) as 0 | 1,
    col: (index % 3) as 0 | 1 | 2 | 3
  }))
});

const toRoundNo = (value: number, fallback: number): ArenaRoundNo => {
  const numeric = value >= 1 && value <= ARENA_ROUND_PLAN_MAX_COUNT ? value : fallback;
  return Math.min(ARENA_ROUND_PLAN_MAX_COUNT, Math.max(1, numeric)) as ArenaRoundNo;
};

const normalizeRoundPlansInput = (body: any, cards: ArenaDeckCardRef[]): ArenaRoundPlan[] => {
  const source = Array.isArray(body?.round_plans) ? body.round_plans.slice(0, ARENA_ROUND_PLAN_MAX_COUNT) : [];
  if (source.length === 0) return [buildDefaultRoundPlan(cards, 1)];

  return source.map((plan: any, index: number) => {
    const roundNo = toRoundNo(Number(plan?.round_no || index + 1), index + 1);
    const slotsSource = Array.isArray(plan?.slots) ? plan.slots : [];
    const slots = slotsSource
      .map(normalizeSlot)
      .filter((slot: ArenaRoundPlanSlot | null): slot is ArenaRoundPlanSlot => Boolean(slot));

    return {
      round_no: roundNo,
      formation_id: String(plan?.formation_id || 'custom-2x4').trim().slice(0, 64) || 'custom-2x4',
      tactic_style: String(plan?.tactic_style || 'balanced').trim().slice(0, 64) || 'balanced',
      focus_rule: String(plan?.focus_rule || 'frontline_first').trim().slice(0, 64) || 'frontline_first',
      slots: slots.length > 0 ? slots : buildDefaultRoundPlan(cards, toRoundNo(index + 1, 1)).slots
    };
  });
};

const normalizeStrategyChipId = (value: unknown) => {
  const id = String(value || 'none').trim();
  return ARENA_TACTIC_CHIPS.some((chip) => chip.id === id) ? id : 'none';
};

const validationRule = (): ArenaDeckValidationResult['deck_rule'] => ({
  deck_min_card_count: ARENA_DECK_MIN_CARD_COUNT,
  deck_max_card_count: ARENA_DECK_MAX_CARD_COUNT,
  round_max_deploy_count: ARENA_ROUND_MAX_DEPLOY_COUNT,
  round_plan_max_count: ARENA_ROUND_PLAN_MAX_COUNT,
  board_rows: ARENA_BOARD_ROWS,
  board_cols: ARENA_BOARD_COLS,
  duplicate_streamer_card: false,
  disabled_streamer_card_allowed: false,
  match_format: ARENA_MATCH_FORMAT
});

export const validateArenaDeckInput = async (body: any, userId?: string): Promise<ArenaDeckValidationResult> => {
  const normalizedCards = normalizeCardsInput(body);
  const normalizedRoundPlans = normalizeRoundPlansInput(body, normalizedCards);
  const normalizedStrategyChipId = normalizeStrategyChipId(body?.strategy_chip_id);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (normalizedCards.length < ARENA_DECK_MIN_CARD_COUNT || normalizedCards.length > ARENA_DECK_MAX_CARD_COUNT) {
    errors.push('덱은 6~10장의 스트리머 카드로 구성해야 합니다.');
  }

  const uniqueChannels = new Set(normalizedCards.map((card) => card.channel_id));
  if (uniqueChannels.size !== normalizedCards.length) {
    errors.push('같은 스트리머 카드는 한 덱에 중복 편성할 수 없습니다.');
  }

  if (normalizedRoundPlans.length < 1 || normalizedRoundPlans.length > ARENA_ROUND_PLAN_MAX_COUNT) {
    errors.push('라운드별 전술 플랜은 1~5개만 저장할 수 있습니다.');
  }

  const disabledIds = await listDisabledArenaStreamerIds();
  const disabledIncluded = normalizedCards.some((card) => disabledIds.has(card.channel_id));
  if (disabledIncluded) {
    errors.push('비활성화된 스트리머 카드는 덱에 편성할 수 없습니다.');
  }

  const knownStreamerIds = await loadKnownStreamerIds();
  const unknownChannelIds = Array.from(uniqueChannels).filter((channelId) => !knownStreamerIds.has(channelId));
  const confirmedMissing = await Promise.all(
    unknownChannelIds.map(async (channelId) => {
      const streamer = await streamerRepository.findById(channelId);
      if (streamer) {
        knownStreamerIds.add(channelId);
        return null;
      }
      return channelId;
    })
  );
  const missingCardIds = confirmedMissing.filter((channelId): channelId is string => Boolean(channelId)).map((channelId) => toCardId(channelId));
  if (missingCardIds.length > 0) {
    errors.push(`등록되지 않은 아레나 카드가 포함되어 있습니다: ${missingCardIds.slice(0, 3).join(', ')}`);
  }

  if (userId) {
    const ownedChannelIds = await loadOwnedArenaChannelIds(userId);
    const unownedCardIds = normalizedCards
      .filter((card) => !ownedChannelIds.has(card.channel_id))
      .map((card) => card.card_id);
    if (unownedCardIds.length > 0) {
      errors.push(`보유하지 않은 아레나 카드는 덱에 편성할 수 없습니다: ${unownedCardIds.slice(0, 3).join(', ')}`);
    }
  }

  const seenRoundNos = new Set<number>();
  for (const plan of normalizedRoundPlans) {
    if (seenRoundNos.has(plan.round_no)) {
      errors.push('라운드 번호가 중복된 전술 플랜이 있습니다.');
    }
    seenRoundNos.add(plan.round_no);

    if (plan.slots.length < 1 || plan.slots.length > ARENA_ROUND_MAX_DEPLOY_COUNT) {
      errors.push(`${plan.round_no}라운드 출전 카드는 1~6장이어야 합니다.`);
    }

    const planCards = new Set<string>();
    const planPositions = new Set<string>();
    for (const slot of plan.slots) {
      if (!uniqueChannels.has(slot.channel_id)) {
        errors.push(`${plan.round_no}라운드에 덱에 없는 카드가 배치되어 있습니다: ${slot.card_id}`);
      }
      if (planCards.has(slot.channel_id)) {
        errors.push(`${plan.round_no}라운드에 같은 카드가 중복 출전합니다: ${slot.card_id}`);
      }
      planCards.add(slot.channel_id);

      if (slot.row < 0 || slot.row > 1 || slot.col < 0 || slot.col > 3) {
        errors.push(`${plan.round_no}라운드에 2x4 보드 밖 좌표가 있습니다.`);
      }
      const positionKey = `${slot.row}:${slot.col}`;
      if (planPositions.has(positionKey)) {
        errors.push(`${plan.round_no}라운드에 같은 칸을 중복 사용했습니다.`);
      }
      planPositions.add(positionKey);
    }
  }

  if (normalizedRoundPlans.length < ARENA_ROUND_PLAN_MAX_COUNT) {
    warnings.push('전술 플랜이 5개 미만이면 남은 라운드는 마지막 플랜을 재사용합니다.');
  }

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
    warnings,
    normalized_cards: normalizedCards,
    normalized_round_plans: normalizedRoundPlans,
    normalized_strategy_chip_id: normalizedStrategyChipId,
    deck_rule: validationRule()
  };
};

const ensureArenaDeckTable = async () => {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    const mode = getDbMode();
    if (mode === 'MYSQL') {
      const db = getMysqlDb();
      await db.run(`
        CREATE TABLE IF NOT EXISTS arena_decks (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          user_id VARCHAR(191) NOT NULL,
          season_id VARCHAR(64) NOT NULL,
          name VARCHAR(80) NOT NULL,
          cards_json JSON NOT NULL,
          round_plans_json JSON NOT NULL,
          strategy_chip_id VARCHAR(64) NOT NULL DEFAULT 'none',
          deck_hash VARCHAR(128) NOT NULL,
          validation_status VARCHAR(32) NOT NULL DEFAULT 'VALID',
          validation_result_json JSON NULL,
          last_used_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_arena_decks_user (user_id, season_id, updated_at),
          INDEX idx_arena_decks_hash (deck_hash),
          INDEX idx_arena_decks_validation (season_id, validation_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await db.run(`ALTER TABLE arena_decks ADD COLUMN strategy_chip_id VARCHAR(64) NOT NULL DEFAULT 'none'`).catch(() => undefined);
      return;
    }

    if (mode === 'LOCAL_SQL') {
      const db = getSqliteDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS arena_decks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          season_id TEXT NOT NULL,
          name TEXT NOT NULL,
          cards_json TEXT NOT NULL,
          round_plans_json TEXT NOT NULL,
          strategy_chip_id TEXT NOT NULL DEFAULT 'none',
          deck_hash TEXT NOT NULL,
          validation_status TEXT NOT NULL DEFAULT 'VALID',
          validation_result_json TEXT,
          last_used_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_arena_decks_user ON arena_decks (user_id, season_id, updated_at);
        CREATE INDEX IF NOT EXISTS idx_arena_decks_hash ON arena_decks (deck_hash);
        CREATE INDEX IF NOT EXISTS idx_arena_decks_validation ON arena_decks (season_id, validation_status);
      `);
      try {
        db.prepare(`ALTER TABLE arena_decks ADD COLUMN strategy_chip_id TEXT NOT NULL DEFAULT 'none'`).run();
      } catch {
        // Column already exists.
      }
      return;
    }

    throw new Error('ArenaDeckStorageUnsupported');
  })().catch((err) => {
    ensureTablePromise = null;
    throw err;
  });

  return ensureTablePromise;
};

const mapDeckRow = (row: RawDeckRow): ArenaDeck => {
  const cards = parseJson<ArenaDeckCardRef[]>(row.cards_json, []);
  const roundPlans = parseJson<ArenaRoundPlan[]>(row.round_plans_json, []);
  const validationResult = parseJson<ArenaDeckValidationResult>(row.validation_result_json, {
    valid: row.validation_status === 'VALID',
    errors: [],
    warnings: [],
    normalized_cards: cards,
    normalized_round_plans: roundPlans,
    normalized_strategy_chip_id: row.strategy_chip_id || 'none',
    deck_rule: validationRule()
  });
  const strategyChipId = row.strategy_chip_id || validationResult.normalized_strategy_chip_id || 'none';

  return {
    id: String(row.id),
    user_id: row.user_id,
    season_id: row.season_id,
    name: row.name,
    cards,
    round_plans: roundPlans,
    strategy_chip_id: strategyChipId,
    deck_hash: row.deck_hash,
    validation_status: row.validation_status === 'VALID' ? 'VALID' : 'INVALID',
    validation_result: validationResult,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

export const listArenaDecks = async (userId: string): Promise<ArenaDeck[]> => {
  await ensureArenaDeckTable();
  if (getDbMode() === 'MYSQL') {
    const rows = await getMysqlDb().all<RawDeckRow>(
      `SELECT * FROM arena_decks WHERE user_id = ? AND season_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
      userId,
      getArenaCurrentSeasonId(),
      MAX_DECKS_PER_USER
    );
    return rows.map(mapDeckRow);
  }

  const rows = getSqliteDb()
    .prepare(`SELECT * FROM arena_decks WHERE user_id = ? AND season_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`)
    .all(userId, getArenaCurrentSeasonId(), MAX_DECKS_PER_USER) as RawDeckRow[];
  return rows.map(mapDeckRow);
};

export const getArenaDeck = async (userId: string, deckId: string): Promise<ArenaDeck | null> => {
  await ensureArenaDeckTable();
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get<RawDeckRow>(
      `SELECT * FROM arena_decks WHERE id = ? AND user_id = ? AND season_id = ? LIMIT 1`,
      deckId,
      userId,
      getArenaCurrentSeasonId()
    );
    return row ? mapDeckRow(row) : null;
  }

  const row = getSqliteDb()
    .prepare(`SELECT * FROM arena_decks WHERE id = ? AND user_id = ? AND season_id = ? LIMIT 1`)
    .get(deckId, userId, getArenaCurrentSeasonId()) as RawDeckRow | undefined;
  return row ? mapDeckRow(row) : null;
};

const normalizeDeckName = (name: unknown) => {
  const value = String(name || '').trim();
  return (value || '아레나 덱').slice(0, 80);
};

export const createArenaDeck = async (userId: string, body: any): Promise<ArenaDeck> => {
  await ensureArenaDeckTable();
  const currentDecks = await listArenaDecks(userId);
  if (currentDecks.length >= MAX_DECKS_PER_USER) {
    throw new Error('ArenaDeckLimitExceeded');
  }

  const validation = await validateArenaDeckInput(body, userId);
  if (!validation.valid) {
    const err = new Error('ArenaDeckValidationFailed') as Error & { validation?: ArenaDeckValidationResult };
    err.validation = validation;
    throw err;
  }

  const name = normalizeDeckName(body?.name);
  const deckHash = hashDeck(validation.normalized_cards, validation.normalized_round_plans, validation.normalized_strategy_chip_id);
  const validationJson = JSON.stringify(validation);

  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `INSERT INTO arena_decks
        (user_id, season_id, name, cards_json, round_plans_json, strategy_chip_id, deck_hash, validation_status, validation_result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      getArenaCurrentSeasonId(),
      name,
      JSON.stringify(validation.normalized_cards),
      JSON.stringify(validation.normalized_round_plans),
      validation.normalized_strategy_chip_id,
      deckHash,
      'VALID',
      validationJson
    );
    const deck = await getArenaDeck(userId, String(result.insertId));
    if (!deck) throw new Error('ArenaDeckCreateReadbackFailed');
    return deck;
  }

  const result = getSqliteDb()
    .prepare(
      `INSERT INTO arena_decks
        (user_id, season_id, name, cards_json, round_plans_json, strategy_chip_id, deck_hash, validation_status, validation_result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      getArenaCurrentSeasonId(),
      name,
      JSON.stringify(validation.normalized_cards),
      JSON.stringify(validation.normalized_round_plans),
      validation.normalized_strategy_chip_id,
      deckHash,
      'VALID',
      validationJson
    );
  const deck = await getArenaDeck(userId, String(result.lastInsertRowid));
  if (!deck) throw new Error('ArenaDeckCreateReadbackFailed');
  return deck;
};

export const updateArenaDeck = async (userId: string, deckId: string, body: any): Promise<ArenaDeck | null> => {
  await ensureArenaDeckTable();
  const existing = await getArenaDeck(userId, deckId);
  if (!existing) return null;

  const cardListChanged = Array.isArray(body?.cards) || Array.isArray(body?.card_ids);
  const validation = await validateArenaDeckInput({
    ...body,
    cards: body?.cards ?? existing.cards,
    round_plans: cardListChanged ? [] : body?.round_plans ?? existing.round_plans,
    strategy_chip_id: body?.strategy_chip_id ?? existing.strategy_chip_id
  }, userId);
  if (!validation.valid) {
    const err = new Error('ArenaDeckValidationFailed') as Error & { validation?: ArenaDeckValidationResult };
    err.validation = validation;
    throw err;
  }

  const name = normalizeDeckName(body?.name ?? existing.name);
  const deckHash = hashDeck(validation.normalized_cards, validation.normalized_round_plans, validation.normalized_strategy_chip_id);
  const validationJson = JSON.stringify(validation);

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_decks
          SET name = ?, cards_json = ?, round_plans_json = ?, strategy_chip_id = ?, deck_hash = ?,
              validation_status = ?, validation_result_json = ?
        WHERE id = ? AND user_id = ? AND season_id = ?`,
      name,
      JSON.stringify(validation.normalized_cards),
      JSON.stringify(validation.normalized_round_plans),
      validation.normalized_strategy_chip_id,
      deckHash,
      'VALID',
      validationJson,
      deckId,
      userId,
      getArenaCurrentSeasonId()
    );
  } else {
    getSqliteDb()
      .prepare(
        `UPDATE arena_decks
            SET name = ?, cards_json = ?, round_plans_json = ?, strategy_chip_id = ?, deck_hash = ?,
                validation_status = ?, validation_result_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND season_id = ?`
      )
      .run(
        name,
        JSON.stringify(validation.normalized_cards),
        JSON.stringify(validation.normalized_round_plans),
        validation.normalized_strategy_chip_id,
        deckHash,
        'VALID',
        validationJson,
        deckId,
        userId,
        getArenaCurrentSeasonId()
      );
  }

  return getArenaDeck(userId, deckId);
};

export const deleteArenaDeck = async (userId: string, deckId: string): Promise<boolean> => {
  await ensureArenaDeckTable();
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(
      `DELETE FROM arena_decks WHERE id = ? AND user_id = ? AND season_id = ?`,
      deckId,
      userId,
      getArenaCurrentSeasonId()
    );
    return result.changes > 0;
  }

  const result = getSqliteDb()
    .prepare(`DELETE FROM arena_decks WHERE id = ? AND user_id = ? AND season_id = ?`)
    .run(deckId, userId, getArenaCurrentSeasonId());
  return result.changes > 0;
};

export const revalidateArenaDeck = async (userId: string, deckId: string): Promise<ArenaDeck | null> => {
  const existing = await getArenaDeck(userId, deckId);
  if (!existing) return null;

  const validation = await validateArenaDeckInput(existing, userId);
  const validationStatus = validation.valid ? 'VALID' : 'INVALID';
  const validationJson = JSON.stringify(validation);

  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(
      `UPDATE arena_decks
          SET validation_status = ?, validation_result_json = ?
        WHERE id = ? AND user_id = ? AND season_id = ?`,
      validationStatus,
      validationJson,
      deckId,
      userId,
      getArenaCurrentSeasonId()
    );
  } else {
    getSqliteDb()
      .prepare(
        `UPDATE arena_decks
            SET validation_status = ?, validation_result_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND user_id = ? AND season_id = ?`
      )
      .run(validationStatus, validationJson, deckId, userId, getArenaCurrentSeasonId());
  }

  return getArenaDeck(userId, deckId);
};



