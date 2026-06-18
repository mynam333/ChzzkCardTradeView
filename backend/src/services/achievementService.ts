import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { recordMysqlAssetEvent, recordSqliteAssetEvent } from './assetEventLog';
import { recordMysqlPointLedger, recordSqlitePointLedger } from './pointLedger';
import { notificationRepository } from '../repositories';

export type AchievementCategory =
  | 'start'
  | 'collection'
  | 'growth'
  | 'economy'
  | 'trade'
  | 'market'
  | 'minigame'
  | 'community'
  | 'streamer'
  | 'event'
  | 'hidden';

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'legendary' | 'event';
export type AchievementStatus = 'locked' | 'in_progress' | 'completed' | 'claimed' | 'expired';
export type AchievementRepeatPolicy = 'once' | 'daily' | 'weekly' | 'monthly' | 'seasonal' | 'repeatable';
export type AchievementClaimPolicy = 'manual' | 'auto';
export type AchievementProgressMode = 'incremental' | 'snapshot' | 'composite';

type AchievementCriteria =
  | { type: 'stat'; metric: string; target: number; operator?: '>=' }
  | { type: 'all'; conditions: Array<{ type: 'stat'; metric: string; target: number; operator?: '>=' }> };

export type AchievementReward =
  | { type: 'point'; points: number; label?: string }
  | { type: 'card'; channel_id: string; quantity: number; label?: string }
  | { type: 'cosmetic'; item_id: number; quantity: number; label?: string }
  | { type: 'minigame_ticket'; quantity: number; label?: string }
  | { type: 'free_draw_ticket'; quantity: number; label?: string }
  | { type: 'title'; title_id: number; label?: string };

export type Achievement = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: AchievementCategory;
  tier: AchievementTier;
  icon: string | null;
  icon_color: string | null;
  is_active: boolean;
  is_hidden: boolean;
  hidden_hint: string | null;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  repeat_policy: AchievementRepeatPolicy;
  claim_policy: AchievementClaimPolicy;
  progress_mode: AchievementProgressMode;
  criteria_json: AchievementCriteria;
  rewards_json: AchievementReward[];
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type UserAchievementView = {
  achievement_id: number;
  code: string | null;
  name: string;
  description: string | null;
  category: AchievementCategory | 'hidden';
  tier: AchievementTier;
  icon: string | null;
  icon_color: string | null;
  is_hidden: boolean;
  hidden_hint: string | null;
  status: AchievementStatus;
  progress_current: number | null;
  progress_target: number | null;
  progress_percent: number | null;
  completed_at: string | null;
  claimed_at: string | null;
  rewards: AchievementReward[] | null;
  sort_order: number;
};

export type AchievementEventInput = {
  eventKey: string;
  userId: string;
  eventType: string;
  sourceType?: string | null;
  sourceId?: string | number | null;
  value?: number;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
  stats?: Record<string, number>;
  refreshSnapshots?: boolean;
  evaluate?: boolean;
};

const allowedCategories: AchievementCategory[] = ['start', 'collection', 'growth', 'economy', 'trade', 'market', 'minigame', 'community', 'streamer', 'event', 'hidden'];
const allowedTiers: AchievementTier[] = ['bronze', 'silver', 'gold', 'platinum', 'legendary', 'event'];
const allowedRepeatPolicies: AchievementRepeatPolicy[] = ['once', 'daily', 'weekly', 'monthly', 'seasonal', 'repeatable'];
const allowedClaimPolicies: AchievementClaimPolicy[] = ['manual', 'auto'];
const allowedProgressModes: AchievementProgressMode[] = ['incremental', 'snapshot', 'composite'];

const allowedMetrics = new Set([
  'login.count',
  'login.daily.count',
  'card.acquired.count',
  'card.sold.count',
  'card.fused.count',
  'card.star.5.count',
  'trade.completed.count',
  'market.listed.count',
  'market.purchase.count',
  'market.sale.count',
  'market.bid.count',
  'minigame.success.count',
  'minigame.success.quiz.count',
  'minigame.success.puzzle.count',
  'minigame.success.match.count',
  'minigame.success.value_duel.count',
  'minigame.success.crop_detective.count',
  'minigame.perfect.count',
  'minigame.speed_bonus.count',
  'shop.purchase.count',
  'cosmetic.equip.count',
  'coupon.claim.count',
  'profile.representative.set',
  'profile.status_message.set',
  'inventory.card_count',
  'inventory.unique_streamer_count',
  'inventory.star.5.count',
  'inventory.locked_count',
  'inventory.hidden_count',
  'inventory.favorite_count',
  'user.title_count',
  'user.cosmetic_count',
  'user.point_balance'
]);

const clampLimit = (value: unknown, fallback = 80, max = 200) =>
  Math.max(1, Math.min(max, Math.floor(Number(value || fallback))));

const safeJsonParse = <T>(value: unknown, fallback: T): T => {
  if (!value) return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

const compactMetadata = (metadata: Record<string, unknown> | null | undefined) => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (value == null) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 191);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
};

let sqliteReady: object | null = null;
let mysqlReady = false;
let achievementCache: { data: Achievement[]; expiresAt: number } | null = null;
const ACHIEVEMENT_CACHE_TTL_MS = 60_000;

const DEFAULT_ACHIEVEMENTS: Array<Omit<Achievement, 'id' | 'created_at' | 'updated_at' | 'criteria_json' | 'rewards_json'> & {
  criteria_json: AchievementCriteria;
  rewards_json: AchievementReward[];
}> = [
  {
    code: 'first_card',
    name: '첫 소환',
    description: '카드를 처음 획득했습니다.',
    category: 'start',
    tier: 'bronze',
    icon: 'Sparkles',
    icon_color: '#2563eb',
    is_active: true,
    is_hidden: false,
    hidden_hint: null,
    sort_order: 10,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'incremental',
    criteria_json: { type: 'stat', metric: 'card.acquired.count', target: 1 },
    rewards_json: [{ type: 'point', points: 1000 }],
    created_by: null
  },
  {
    code: 'cards_10',
    name: '카드 수집가 I',
    description: '카드를 10장 보유했습니다.',
    category: 'collection',
    tier: 'bronze',
    icon: 'Layers',
    icon_color: '#16a34a',
    is_active: true,
    is_hidden: false,
    hidden_hint: null,
    sort_order: 20,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'snapshot',
    criteria_json: { type: 'stat', metric: 'inventory.card_count', target: 10 },
    rewards_json: [{ type: 'point', points: 2000 }],
    created_by: null
  },
  {
    code: 'unique_streamers_10',
    name: '다양한 취향',
    description: '서로 다른 스트리머 카드 10종을 보유했습니다.',
    category: 'collection',
    tier: 'silver',
    icon: 'Users',
    icon_color: '#0891b2',
    is_active: true,
    is_hidden: false,
    hidden_hint: null,
    sort_order: 30,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'snapshot',
    criteria_json: { type: 'stat', metric: 'inventory.unique_streamer_count', target: 10 },
    rewards_json: [{ type: 'free_draw_ticket', quantity: 1 }],
    created_by: null
  },
  {
    code: 'first_fuse',
    name: '첫 한계돌파',
    description: '카드를 처음 한계돌파했습니다.',
    category: 'growth',
    tier: 'bronze',
    icon: 'Star',
    icon_color: '#f59e0b',
    is_active: true,
    is_hidden: false,
    hidden_hint: null,
    sort_order: 40,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'incremental',
    criteria_json: { type: 'stat', metric: 'card.fused.count', target: 1 },
    rewards_json: [{ type: 'point', points: 3000 }],
    created_by: null
  },
  {
    code: 'five_star_owner',
    name: '최고 등급',
    description: '5성 카드를 1장 보유했습니다.',
    category: 'growth',
    tier: 'gold',
    icon: 'Crown',
    icon_color: '#eab308',
    is_active: true,
    is_hidden: false,
    hidden_hint: null,
    sort_order: 50,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'snapshot',
    criteria_json: { type: 'stat', metric: 'inventory.star.5.count', target: 1 },
    rewards_json: [{ type: 'point', points: 10000 }],
    created_by: null
  },
  {
    code: 'first_minigame_win',
    name: '첫 승리',
    description: '미니게임을 처음 성공했습니다.',
    category: 'minigame',
    tier: 'bronze',
    icon: 'Gamepad2',
    icon_color: '#7c3aed',
    is_active: true,
    is_hidden: false,
    hidden_hint: null,
    sort_order: 60,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'incremental',
    criteria_json: { type: 'stat', metric: 'minigame.success.count', target: 1 },
    rewards_json: [{ type: 'minigame_ticket', quantity: 1 }],
    created_by: null
  },
  {
    code: 'first_shop_purchase',
    name: '첫 꾸미기 쇼핑',
    description: '상점 아이템을 처음 구매했습니다.',
    category: 'economy',
    tier: 'bronze',
    icon: 'Store',
    icon_color: '#db2777',
    is_active: true,
    is_hidden: false,
    hidden_hint: null,
    sort_order: 70,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'incremental',
    criteria_json: { type: 'stat', metric: 'shop.purchase.count', target: 1 },
    rewards_json: [{ type: 'point', points: 1000 }],
    created_by: null
  },
  {
    code: 'first_market_purchase',
    name: '첫 마켓 구매',
    description: '오픈마켓에서 카드를 처음 구매했습니다.',
    category: 'market',
    tier: 'silver',
    icon: 'ShoppingCart',
    icon_color: '#0f766e',
    is_active: true,
    is_hidden: false,
    hidden_hint: null,
    sort_order: 80,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'incremental',
    criteria_json: { type: 'stat', metric: 'market.purchase.count', target: 1 },
    rewards_json: [{ type: 'point', points: 3000 }],
    created_by: null
  },
  {
    code: 'hidden_all_rounder_day',
    name: '완벽한 하루',
    description: '하루 안에 여러 핵심 활동을 달성했습니다.',
    category: 'hidden',
    tier: 'event',
    icon: 'Lock',
    icon_color: '#111827',
    is_active: true,
    is_hidden: true,
    hidden_hint: '하루 안에 여러 기능을 골고루 사용해 보세요.',
    sort_order: 1000,
    starts_at: null,
    ends_at: null,
    repeat_policy: 'once',
    claim_policy: 'manual',
    progress_mode: 'composite',
    criteria_json: {
      type: 'all',
      conditions: [
        { type: 'stat', metric: 'card.acquired.count', target: 1 },
        { type: 'stat', metric: 'minigame.success.count', target: 1 },
        { type: 'stat', metric: 'shop.purchase.count', target: 1 }
      ]
    },
    rewards_json: [{ type: 'point', points: 3000 }],
    created_by: null
  }
];

export const invalidateAchievementCache = () => {
  achievementCache = null;
};

const normalizeDateValue = (value: any): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const mapAchievementRow = (row: any): Achievement => ({
  id: Number(row.id),
  code: row.code,
  name: row.name,
  description: row.description ?? null,
  category: row.category || 'event',
  tier: row.tier || 'bronze',
  icon: row.icon ?? null,
  icon_color: row.icon_color ?? null,
  is_active: row.is_active === true || row.is_active === 1,
  is_hidden: row.is_hidden === true || row.is_hidden === 1,
  hidden_hint: row.hidden_hint ?? null,
  sort_order: Number(row.sort_order || 0),
  starts_at: normalizeDateValue(row.starts_at),
  ends_at: normalizeDateValue(row.ends_at),
  repeat_policy: row.repeat_policy || 'once',
  claim_policy: row.claim_policy || 'manual',
  progress_mode: row.progress_mode || 'incremental',
  criteria_json: safeJsonParse<AchievementCriteria>(row.criteria_json, { type: 'stat', metric: 'login.count', target: 1 }),
  rewards_json: safeJsonParse<AchievementReward[]>(row.rewards_json, []),
  created_by: row.created_by ?? null,
  created_at: normalizeDateValue(row.created_at),
  updated_at: normalizeDateValue(row.updated_at)
});

export const ensureAchievementTables = async (): Promise<void> => {
  const mode = getDbMode();
  if (mode === 'LOCAL_SQL') {
    const db = getSqliteDb();
    if (sqliteReady === db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'bronze',
        icon TEXT,
        icon_color TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        hidden_hint TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        starts_at TEXT,
        ends_at TEXT,
        repeat_policy TEXT NOT NULL DEFAULT 'once',
        claim_policy TEXT NOT NULL DEFAULT 'manual',
        progress_mode TEXT NOT NULL DEFAULT 'incremental',
        criteria_json TEXT NOT NULL,
        rewards_json TEXT NOT NULL DEFAULT '[]',
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS user_achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        achievement_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'locked',
        progress_current INTEGER NOT NULL DEFAULT 0,
        progress_target INTEGER NOT NULL DEFAULT 1,
        progress_json TEXT NOT NULL DEFAULT '{}',
        completed_at TEXT,
        claimed_at TEXT,
        last_evaluated_at TEXT,
        repeat_key TEXT NOT NULL DEFAULT 'once',
        UNIQUE(user_id, achievement_id, repeat_key)
      );
      CREATE TABLE IF NOT EXISTS achievement_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        source_type TEXT,
        source_id TEXT,
        value INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS user_achievement_stats (
        user_id TEXT NOT NULL,
        stat_key TEXT NOT NULL,
        stat_value INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY(user_id, stat_key)
      );
      CREATE TABLE IF NOT EXISTS achievement_grant_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        achievement_id INTEGER NOT NULL,
        repeat_key TEXT NOT NULL DEFAULT 'once',
        reward_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, achievement_id, repeat_key)
      );
      CREATE TABLE IF NOT EXISTS achievement_evaluation_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        dedupe_key TEXT NOT NULL UNIQUE,
        run_after TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        locked_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_achievement_events_user_id ON achievement_events(user_id, id);
      CREATE INDEX IF NOT EXISTS idx_achievement_events_user_type ON achievement_events(user_id, event_type, id);
      CREATE INDEX IF NOT EXISTS idx_achievement_events_type_time ON achievement_events(event_type, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_user_achievements_user_status ON user_achievements(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_achievements_active_sort ON achievements(is_active, sort_order);
      CREATE INDEX IF NOT EXISTS idx_achievements_category_active ON achievements(category, is_active);
    `);
    sqliteReady = db;
    await seedDefaultAchievements();
    return;
  }

  if (mode === 'MYSQL') {
    if (mysqlReady) return;
    const db = getMysqlDb();
    await db.run(`
      CREATE TABLE IF NOT EXISTS achievements (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(120) NOT NULL UNIQUE,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NULL,
        category VARCHAR(40) NOT NULL,
        tier VARCHAR(24) NOT NULL DEFAULT 'bronze',
        icon VARCHAR(64) NULL,
        icon_color VARCHAR(32) NULL,
        is_active TINYINT NOT NULL DEFAULT 1,
        is_hidden TINYINT NOT NULL DEFAULT 0,
        hidden_hint VARCHAR(500) NULL,
        sort_order INT NOT NULL DEFAULT 0,
        starts_at DATETIME NULL,
        ends_at DATETIME NULL,
        repeat_policy VARCHAR(24) NOT NULL DEFAULT 'once',
        claim_policy VARCHAR(24) NOT NULL DEFAULT 'manual',
        progress_mode VARCHAR(24) NOT NULL DEFAULT 'incremental',
        criteria_json JSON NOT NULL,
        rewards_json JSON NOT NULL,
        created_by VARCHAR(191) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_achievements_active_sort (is_active, sort_order),
        INDEX idx_achievements_category_active (category, is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        achievement_id BIGINT NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'locked',
        progress_current BIGINT NOT NULL DEFAULT 0,
        progress_target BIGINT NOT NULL DEFAULT 1,
        progress_json JSON NULL,
        completed_at DATETIME NULL,
        claimed_at DATETIME NULL,
        last_evaluated_at DATETIME NULL,
        repeat_key VARCHAR(80) NOT NULL DEFAULT 'once',
        UNIQUE KEY uniq_user_achievement_repeat (user_id, achievement_id, repeat_key),
        INDEX idx_user_achievements_user_status (user_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS achievement_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        event_key VARCHAR(255) NOT NULL UNIQUE,
        user_id VARCHAR(191) NOT NULL,
        event_type VARCHAR(80) NOT NULL,
        source_type VARCHAR(80) NULL,
        source_id VARCHAR(191) NULL,
        value BIGINT NOT NULL DEFAULT 1,
        metadata_json JSON NULL,
        occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_achievement_events_user_id (user_id, id),
        INDEX idx_achievement_events_user_type (user_id, event_type, id),
        INDEX idx_achievement_events_type_time (event_type, occurred_at),
        INDEX idx_achievement_events_source (source_type, source_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS user_achievement_stats (
        user_id VARCHAR(191) NOT NULL,
        stat_key VARCHAR(120) NOT NULL,
        stat_value BIGINT NOT NULL DEFAULT 0,
        metadata_json JSON NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id, stat_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS achievement_grant_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        achievement_id BIGINT NOT NULL,
        repeat_key VARCHAR(80) NOT NULL DEFAULT 'once',
        reward_json JSON NULL,
        status VARCHAR(24) NOT NULL,
        error_message VARCHAR(500) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_achievement_grant (user_id, achievement_id, repeat_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS achievement_evaluation_queue (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        reason VARCHAR(120) NOT NULL,
        priority INT NOT NULL DEFAULT 0,
        dedupe_key VARCHAR(255) NOT NULL UNIQUE,
        run_after DATETIME NULL,
        attempts INT NOT NULL DEFAULT 0,
        locked_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    mysqlReady = true;
    await seedDefaultAchievements();
    return;
  }
};

const seedDefaultAchievements = async () => {
  const mode = getDbMode();
  if (mode === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const stmt = db.prepare(`
      INSERT INTO achievements
        (code, name, description, category, tier, icon, icon_color, is_active, is_hidden, hidden_hint, sort_order,
         starts_at, ends_at, repeat_policy, claim_policy, progress_mode, criteria_json, rewards_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO NOTHING
    `);
    const txn = db.transaction(() => {
      for (const item of DEFAULT_ACHIEVEMENTS) {
        stmt.run(
          item.code,
          item.name,
          item.description,
          item.category,
          item.tier,
          item.icon,
          item.icon_color,
          item.is_active ? 1 : 0,
          item.is_hidden ? 1 : 0,
          item.hidden_hint,
          item.sort_order,
          item.starts_at,
          item.ends_at,
          item.repeat_policy,
          item.claim_policy,
          item.progress_mode,
          JSON.stringify(item.criteria_json),
          JSON.stringify(item.rewards_json),
          item.created_by
        );
      }
    });
    txn();
  } else if (mode === 'MYSQL') {
    const db = getMysqlDb();
    for (const item of DEFAULT_ACHIEVEMENTS) {
      await db.run(`
        INSERT IGNORE INTO achievements
          (code, name, description, category, tier, icon, icon_color, is_active, is_hidden, hidden_hint, sort_order,
           starts_at, ends_at, repeat_policy, claim_policy, progress_mode, criteria_json, rewards_json, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        item.code,
        item.name,
        item.description,
        item.category,
        item.tier,
        item.icon,
        item.icon_color,
        item.is_active ? 1 : 0,
        item.is_hidden ? 1 : 0,
        item.hidden_hint,
        item.sort_order,
        item.starts_at,
        item.ends_at,
        item.repeat_policy,
        item.claim_policy,
        item.progress_mode,
        JSON.stringify(item.criteria_json),
        JSON.stringify(item.rewards_json),
        item.created_by
      );
    }
  }
  invalidateAchievementCache();
};

const validateStatCondition = (condition: any): string | null => {
  if (!condition || condition.type !== 'stat') return '조건은 stat 타입이어야 합니다.';
  if (!allowedMetrics.has(String(condition.metric || ''))) return `허용되지 않은 업적 메트릭입니다: ${condition.metric || ''}`;
  const target = Math.floor(Number(condition.target));
  if (!Number.isFinite(target) || target <= 0 || target > 1_000_000_000) return '업적 목표값은 1 이상의 정상 범위 정수여야 합니다.';
  return null;
};

export const validateAchievementPayload = (payload: any): { ok: true; normalized: Partial<Achievement> } | { ok: false; message: string } => {
  const code = String(payload.code || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,119}$/.test(code)) return { ok: false, message: '업적 코드는 영문/숫자/언더스코어/하이픈 3~120자로 입력해야 합니다.' };
  const name = String(payload.name || '').trim();
  if (!name || name.length > 120) return { ok: false, message: '업적 이름은 1~120자여야 합니다.' };
  const category = allowedCategories.includes(payload.category) ? payload.category : null;
  if (!category) return { ok: false, message: '업적 카테고리가 올바르지 않습니다.' };
  const tier = allowedTiers.includes(payload.tier) ? payload.tier : 'bronze';
  const repeatPolicy = allowedRepeatPolicies.includes(payload.repeat_policy) ? payload.repeat_policy : 'once';
  const claimPolicy = allowedClaimPolicies.includes(payload.claim_policy) ? payload.claim_policy : 'manual';
  const progressMode = allowedProgressModes.includes(payload.progress_mode) ? payload.progress_mode : 'incremental';
  const criteria = safeJsonParse<AchievementCriteria>(payload.criteria_json, payload.criteria_json);
  if (!criteria || typeof criteria !== 'object') return { ok: false, message: '업적 조건이 올바르지 않습니다.' };
  if (criteria.type === 'stat') {
    const err = validateStatCondition(criteria);
    if (err) return { ok: false, message: err };
  } else if (criteria.type === 'all') {
    if (!Array.isArray(criteria.conditions) || criteria.conditions.length === 0 || criteria.conditions.length > 8) {
      return { ok: false, message: '복합 조건은 1~8개의 stat 조건만 허용합니다.' };
    }
    for (const condition of criteria.conditions) {
      const err = validateStatCondition(condition);
      if (err) return { ok: false, message: err };
    }
  } else {
    return { ok: false, message: '지원하지 않는 업적 조건 타입입니다.' };
  }

  const rewards = safeJsonParse<AchievementReward[]>(payload.rewards_json, payload.rewards_json || []);
  if (!Array.isArray(rewards) || rewards.length > 8) return { ok: false, message: '업적 보상은 최대 8개까지 설정할 수 있습니다.' };
  let economicRisk = 0;
  for (const reward of rewards) {
    if (!reward || typeof reward !== 'object') return { ok: false, message: '업적 보상 형식이 올바르지 않습니다.' };
    if (reward.type === 'point') {
      const points = Math.floor(Number(reward.points));
      if (!Number.isFinite(points) || points <= 0 || points > 10_000_000) return { ok: false, message: '포인트 보상은 1~10,000,000 범위여야 합니다.' };
      economicRisk += points;
    } else if (reward.type === 'card') {
      if (!String((reward as any).channel_id || '').trim()) return { ok: false, message: '카드 보상은 스트리머 채널 ID가 필요합니다.' };
      const qty = Math.floor(Number((reward as any).quantity));
      if (!Number.isFinite(qty) || qty <= 0 || qty > 100) return { ok: false, message: '카드 보상 수량은 1~100 범위여야 합니다.' };
      economicRisk += 50_000 * qty;
    } else if (reward.type === 'cosmetic') {
      const itemId = Math.floor(Number((reward as any).item_id));
      const qty = Math.floor(Number((reward as any).quantity));
      if (!itemId || qty <= 0 || qty > 100) return { ok: false, message: '코스메틱 보상은 아이템과 1~100 수량이 필요합니다.' };
    } else if (reward.type === 'minigame_ticket' || reward.type === 'free_draw_ticket') {
      const qty = Math.floor(Number((reward as any).quantity));
      if (!Number.isFinite(qty) || qty <= 0 || qty > 100) return { ok: false, message: '티켓 보상 수량은 1~100 범위여야 합니다.' };
      economicRisk += reward.type === 'free_draw_ticket' ? 10_000 * qty : 1_000 * qty;
    } else if (reward.type === 'title') {
      const titleId = Math.floor(Number((reward as any).title_id));
      if (!titleId) return { ok: false, message: '칭호 보상은 title_id가 필요합니다.' };
    } else {
      return { ok: false, message: '지원하지 않는 업적 보상 타입입니다.' };
    }
  }

  if (payload.is_hidden === true && economicRisk > 10_000 && payload.confirm_hidden_economic_reward !== true) {
    return { ok: false, message: '숨겨진 업적에 큰 경제 보상을 설정하려면 별도 확인이 필요합니다.' };
  }
  if (repeatPolicy !== 'once' && rewards.length > 0 && payload.confirm_repeat_reward !== true) {
    return { ok: false, message: '반복 업적 보상은 누적 지급 위험 확인이 필요합니다.' };
  }

  return {
    ok: true,
    normalized: {
      code,
      name,
      description: payload.description ? String(payload.description).slice(0, 500) : null,
      category,
      tier,
      icon: payload.icon ? String(payload.icon).slice(0, 64) : null,
      icon_color: payload.icon_color ? String(payload.icon_color).slice(0, 32) : null,
      is_active: payload.is_active !== false,
      is_hidden: payload.is_hidden === true,
      hidden_hint: payload.hidden_hint ? String(payload.hidden_hint).slice(0, 500) : null,
      sort_order: Math.floor(Number(payload.sort_order || 0)),
      starts_at: payload.starts_at || null,
      ends_at: payload.ends_at || null,
      repeat_policy: repeatPolicy,
      claim_policy: claimPolicy,
      progress_mode: progressMode,
      criteria_json: criteria,
      rewards_json: rewards
    }
  };
};

export const listAchievements = async (options: { includeInactive?: boolean } = {}): Promise<Achievement[]> => {
  await ensureAchievementTables();
  const now = Date.now();
  if (!options.includeInactive && achievementCache && achievementCache.expiresAt > now) return achievementCache.data;

  let rows: any[] = [];
  if (getDbMode() === 'LOCAL_SQL') {
    rows = getSqliteDb().prepare(`${options.includeInactive ? 'SELECT *' : 'SELECT *'} FROM achievements ${options.includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order ASC, id ASC`).all() as any[];
  } else if (getDbMode() === 'MYSQL') {
    rows = await getMysqlDb().all(`SELECT * FROM achievements ${options.includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order ASC, id ASC`);
  } else {
    let query = getSupabaseClient().from('achievements').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true });
    if (!options.includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw error;
    rows = data || [];
  }
  const mapped = rows.map(mapAchievementRow);
  if (!options.includeInactive) achievementCache = { data: mapped, expiresAt: now + ACHIEVEMENT_CACHE_TTL_MS };
  return mapped;
};

const getUserStats = async (userId: string): Promise<Record<string, number>> => {
  await ensureAchievementTables();
  if (getDbMode() === 'LOCAL_SQL') {
    const rows = getSqliteDb().prepare('SELECT stat_key, stat_value FROM user_achievement_stats WHERE user_id = ?').all(userId) as any[];
    return Object.fromEntries(rows.map((row) => [row.stat_key, Number(row.stat_value || 0)]));
  }
  if (getDbMode() === 'MYSQL') {
    const rows = await getMysqlDb().all('SELECT stat_key, stat_value FROM user_achievement_stats WHERE user_id = ?', userId);
    return Object.fromEntries(rows.map((row: any) => [row.stat_key, Number(row.stat_value || 0)]));
  }
  const { data, error } = await getSupabaseClient().from('user_achievement_stats').select('stat_key, stat_value').eq('user_id', userId);
  if (error) throw error;
  return Object.fromEntries((data || []).map((row: any) => [row.stat_key, Number(row.stat_value || 0)]));
};

const evaluateCriteria = (criteria: AchievementCriteria, stats: Record<string, number>) => {
  if (criteria.type === 'stat') {
    const target = Math.max(1, Math.floor(Number(criteria.target || 1)));
    const current = Math.max(0, Math.floor(Number(stats[criteria.metric] || 0)));
    return { current: Math.min(current, target), rawCurrent: current, target, complete: current >= target, details: { [criteria.metric]: current } };
  }
  const details: Record<string, number> = {};
  let current = 0;
  let target = 0;
  let complete = true;
  for (const condition of criteria.conditions) {
    const conditionTarget = Math.max(1, Math.floor(Number(condition.target || 1)));
    const conditionCurrent = Math.max(0, Math.floor(Number(stats[condition.metric] || 0)));
    details[condition.metric] = conditionCurrent;
    current += Math.min(conditionCurrent, conditionTarget);
    target += conditionTarget;
    if (conditionCurrent < conditionTarget) complete = false;
  }
  return { current, rawCurrent: current, target: Math.max(1, target), complete, details };
};

const activeInWindow = (achievement: Achievement) => {
  const now = Date.now();
  if (achievement.starts_at && new Date(achievement.starts_at).getTime() > now) return false;
  if (achievement.ends_at && new Date(achievement.ends_at).getTime() < now) return false;
  return true;
};

const getRepeatKey = (achievement: Achievement, date = new Date()) => {
  if (achievement.repeat_policy === 'once') return 'once';
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  if (achievement.repeat_policy === 'daily') return `${y}-${m}-${d}`;
  if (achievement.repeat_policy === 'monthly') return `${y}-${m}`;
  if (achievement.repeat_policy === 'weekly') {
    const oneJan = Date.UTC(y, 0, 1);
    const dayOfYear = Math.floor((Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate()) - oneJan) / 86400000) + 1;
    return `${y}-W${String(Math.ceil(dayOfYear / 7)).padStart(2, '0')}`;
  }
  return `${y}-${m}-${d}`;
};

export const recomputeSnapshotStats = async (userId: string): Promise<void> => {
  await ensureAchievementTables();
  if (!userId) return;
  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const cardStats = db.prepare(`
      SELECT COUNT(*) AS card_count,
             COUNT(DISTINCT channel_id) AS unique_streamer_count,
             SUM(CASE WHEN COALESCE(star, 0) = 5 THEN 1 ELSE 0 END) AS star5_count,
             SUM(CASE WHEN COALESCE(is_locked, 0) = 1 THEN 1 ELSE 0 END) AS locked_count,
             SUM(CASE WHEN COALESCE(is_hidden, 0) = 1 THEN 1 ELSE 0 END) AS hidden_count,
             SUM(CASE WHEN favorite_order IS NOT NULL THEN 1 ELSE 0 END) AS favorite_count
        FROM user_cards
       WHERE user_id = ?
    `).get(userId) as any;
    const titleStats = db.prepare('SELECT COUNT(*) AS c FROM user_titles WHERE user_id = ?').get(userId) as any;
    const cosmeticStats = db.prepare('SELECT COALESCE(SUM(quantity), 0) AS c FROM user_cosmetics WHERE user_id = ?').get(userId) as any;
    const user = db.prepare('SELECT point, representative_card_channel_id, status_message FROM users WHERE id = ?').get(userId) as any;
    const stats: Record<string, number> = {
      'inventory.card_count': Number(cardStats?.card_count || 0),
      'inventory.unique_streamer_count': Number(cardStats?.unique_streamer_count || 0),
      'inventory.star.5.count': Number(cardStats?.star5_count || 0),
      'inventory.locked_count': Number(cardStats?.locked_count || 0),
      'inventory.hidden_count': Number(cardStats?.hidden_count || 0),
      'inventory.favorite_count': Number(cardStats?.favorite_count || 0),
      'user.title_count': Number(titleStats?.c || 0),
      'user.cosmetic_count': Number(cosmeticStats?.c || 0),
      'user.point_balance': Number(user?.point || 0),
      'profile.representative.set': user?.representative_card_channel_id ? 1 : 0,
      'profile.status_message.set': user?.status_message ? 1 : 0
    };
    const stmt = db.prepare(`
      INSERT INTO user_achievement_stats (user_id, stat_key, stat_value, metadata_json, updated_at)
      VALUES (?, ?, ?, '{}', datetime('now'))
      ON CONFLICT(user_id, stat_key) DO UPDATE SET stat_value = excluded.stat_value, updated_at = excluded.updated_at
    `);
    const txn = db.transaction(() => Object.entries(stats).forEach(([key, value]) => stmt.run(userId, key, value)));
    txn();
    return;
  }
  if (getDbMode() === 'MYSQL') {
    const db = getMysqlDb();
    const cardStats = await db.get(`
      SELECT COUNT(*) AS card_count,
             COUNT(DISTINCT channel_id) AS unique_streamer_count,
             SUM(CASE WHEN COALESCE(star, 0) = 5 THEN 1 ELSE 0 END) AS star5_count,
             SUM(CASE WHEN COALESCE(is_locked, 0) = 1 THEN 1 ELSE 0 END) AS locked_count,
             SUM(CASE WHEN COALESCE(is_hidden, 0) = 1 THEN 1 ELSE 0 END) AS hidden_count,
             SUM(CASE WHEN favorite_order IS NOT NULL THEN 1 ELSE 0 END) AS favorite_count
        FROM user_cards
       WHERE user_id = ?
    `, userId);
    const titleStats = await db.get('SELECT COUNT(*) AS c FROM user_titles WHERE user_id = ?', userId);
    const cosmeticStats = await db.get('SELECT COALESCE(SUM(quantity), 0) AS c FROM user_cosmetics WHERE user_id = ?', userId);
    const user = await db.get('SELECT point, representative_card_channel_id, status_message FROM users WHERE id = ?', userId);
    const stats: Record<string, number> = {
      'inventory.card_count': Number(cardStats?.card_count || 0),
      'inventory.unique_streamer_count': Number(cardStats?.unique_streamer_count || 0),
      'inventory.star.5.count': Number(cardStats?.star5_count || 0),
      'inventory.locked_count': Number(cardStats?.locked_count || 0),
      'inventory.hidden_count': Number(cardStats?.hidden_count || 0),
      'inventory.favorite_count': Number(cardStats?.favorite_count || 0),
      'user.title_count': Number(titleStats?.c || 0),
      'user.cosmetic_count': Number(cosmeticStats?.c || 0),
      'user.point_balance': Number(user?.point || 0),
      'profile.representative.set': user?.representative_card_channel_id ? 1 : 0,
      'profile.status_message.set': user?.status_message ? 1 : 0
    };
    for (const [key, value] of Object.entries(stats)) {
      await db.run(`
        INSERT INTO user_achievement_stats (user_id, stat_key, stat_value, metadata_json, updated_at)
        VALUES (?, ?, ?, JSON_OBJECT(), UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE stat_value = VALUES(stat_value), updated_at = VALUES(updated_at)
      `, userId, key, value);
    }
  }
};

export const incrementAchievementStats = async (userId: string, stats: Record<string, number>): Promise<void> => {
  await ensureAchievementTables();
  const entries = Object.entries(stats).filter(([key, value]) => allowedMetrics.has(key) && Number.isFinite(Number(value)) && Number(value) !== 0);
  if (entries.length === 0) return;
  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const stmt = db.prepare(`
      INSERT INTO user_achievement_stats (user_id, stat_key, stat_value, metadata_json, updated_at)
      VALUES (?, ?, ?, '{}', datetime('now'))
      ON CONFLICT(user_id, stat_key) DO UPDATE SET stat_value = stat_value + excluded.stat_value, updated_at = excluded.updated_at
    `);
    const txn = db.transaction(() => entries.forEach(([key, value]) => stmt.run(userId, key, Math.trunc(Number(value)))));
    txn();
  } else if (getDbMode() === 'MYSQL') {
    const db = getMysqlDb();
    for (const [key, value] of entries) {
      await db.run(`
        INSERT INTO user_achievement_stats (user_id, stat_key, stat_value, metadata_json, updated_at)
        VALUES (?, ?, ?, JSON_OBJECT(), UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE stat_value = stat_value + VALUES(stat_value), updated_at = VALUES(updated_at)
      `, userId, key, Math.trunc(Number(value)));
    }
  } else {
    // Supabase deployments should create tables/RPC separately; best-effort read-modify-write avoids blocking core flows.
    const client = getSupabaseClient();
    for (const [key, value] of entries) {
      const { data } = await client.from('user_achievement_stats').select('stat_value').eq('user_id', userId).eq('stat_key', key).maybeSingle();
      await client.from('user_achievement_stats').upsert({
        user_id: userId,
        stat_key: key,
        stat_value: Number(data?.stat_value || 0) + Math.trunc(Number(value)),
        metadata_json: {},
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,stat_key' });
    }
  }
};

export const evaluateUserAchievements = async (userId: string): Promise<void> => {
  await ensureAchievementTables();
  await recomputeSnapshotStats(userId).catch(() => undefined);
  const achievements = await listAchievements();
  const stats = await getUserStats(userId);
  const nowIso = new Date().toISOString();

  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const select = db.prepare('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?');
    const insert = db.prepare(`
      INSERT INTO user_achievements
        (user_id, achievement_id, status, progress_current, progress_target, progress_json, completed_at, last_evaluated_at, repeat_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, achievement_id, repeat_key) DO UPDATE SET
        status = CASE
          WHEN user_achievements.status = 'claimed' THEN user_achievements.status
          WHEN user_achievements.status = 'completed' THEN user_achievements.status
          ELSE excluded.status
        END,
        progress_current = excluded.progress_current,
        progress_target = excluded.progress_target,
        progress_json = excluded.progress_json,
        completed_at = COALESCE(user_achievements.completed_at, excluded.completed_at),
        last_evaluated_at = excluded.last_evaluated_at
    `);
    const txn = db.transaction(() => {
      for (const achievement of achievements) {
        if (!activeInWindow(achievement)) continue;
        const repeatKey = getRepeatKey(achievement);
        const current = select.get(userId, achievement.id, repeatKey) as any;
        if (current?.status === 'claimed') continue;
        const result = evaluateCriteria(achievement.criteria_json, stats);
        const status: AchievementStatus = result.complete ? 'completed' : (result.rawCurrent > 0 ? 'in_progress' : 'locked');
        insert.run(
          userId,
          achievement.id,
          current?.status === 'completed' ? 'completed' : status,
          result.rawCurrent,
          result.target,
          JSON.stringify(result.details),
          result.complete ? nowIso : null,
          nowIso,
          repeatKey
        );
      }
    });
    txn();
  } else if (getDbMode() === 'MYSQL') {
    const db = getMysqlDb();
    for (const achievement of achievements) {
      if (!activeInWindow(achievement)) continue;
      const repeatKey = getRepeatKey(achievement);
      const current = await db.get('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?', userId, achievement.id, repeatKey);
      if (current?.status === 'claimed') continue;
      const result = evaluateCriteria(achievement.criteria_json, stats);
      const status: AchievementStatus = result.complete ? 'completed' : (result.rawCurrent > 0 ? 'in_progress' : 'locked');
      await db.run(`
        INSERT INTO user_achievements
          (user_id, achievement_id, status, progress_current, progress_target, progress_json, completed_at, last_evaluated_at, repeat_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = CASE
            WHEN status = 'claimed' THEN status
            WHEN status = 'completed' THEN status
            ELSE VALUES(status)
          END,
          progress_current = VALUES(progress_current),
          progress_target = VALUES(progress_target),
          progress_json = VALUES(progress_json),
          completed_at = COALESCE(completed_at, VALUES(completed_at)),
          last_evaluated_at = VALUES(last_evaluated_at)
      `,
        userId,
        achievement.id,
        current?.status === 'completed' ? 'completed' : status,
        result.rawCurrent,
        result.target,
        JSON.stringify(result.details),
        result.complete ? nowIso : null,
        nowIso,
        repeatKey
      );
    }
  }
};

export const recordAchievementEvent = async (input: AchievementEventInput): Promise<void> => {
  if (!input.userId || !input.eventKey || !input.eventType) return;
  await ensureAchievementTables();
  const metadata = compactMetadata(input.metadata);
  const value = Math.trunc(Number(input.value || 1));
  try {
    let inserted = true;
    if (getDbMode() === 'LOCAL_SQL') {
      const result = getSqliteDb().prepare(`
        INSERT OR IGNORE INTO achievement_events
          (event_key, user_id, event_type, source_type, source_id, value, metadata_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.eventKey,
        input.userId,
        input.eventType,
        input.sourceType || null,
        input.sourceId == null ? null : String(input.sourceId),
        value,
        JSON.stringify(metadata),
        input.occurredAt || new Date().toISOString()
      );
      inserted = result.changes > 0;
    } else if (getDbMode() === 'MYSQL') {
      const result = await getMysqlDb().run(`
        INSERT IGNORE INTO achievement_events
          (event_key, user_id, event_type, source_type, source_id, value, metadata_json, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        input.eventKey,
        input.userId,
        input.eventType,
        input.sourceType || null,
        input.sourceId == null ? null : String(input.sourceId),
        value,
        JSON.stringify(metadata),
        input.occurredAt || new Date().toISOString()
      );
      inserted = Number(result.changes || result.affectedRows || 0) > 0;
    } else {
      const { error } = await getSupabaseClient().from('achievement_events').insert({
        event_key: input.eventKey,
        user_id: input.userId,
        event_type: input.eventType,
        source_type: input.sourceType || null,
        source_id: input.sourceId == null ? null : String(input.sourceId),
        value,
        metadata_json: metadata,
        occurred_at: input.occurredAt || new Date().toISOString()
      });
      if (error) {
        if (String(error.code || '').includes('23505') || /duplicate/i.test(error.message || '')) inserted = false;
        else throw error;
      }
    }
    if (!inserted) return;
    if (input.stats) await incrementAchievementStats(input.userId, input.stats);
    if (input.refreshSnapshots) await recomputeSnapshotStats(input.userId).catch(() => undefined);
    if (input.evaluate !== false) await evaluateUserAchievements(input.userId).catch((err) => console.warn('[Achievement] evaluate failed:', err?.message || err));
  } catch (err: any) {
    console.warn('[Achievement] event record failed:', err?.message || err);
  }
};

export const listUserAchievements = async (
  userId: string,
  options: { status?: string; category?: string; hidden?: string; sort?: string; limit?: number } = {}
): Promise<{ items: UserAchievementView[]; summary: Record<string, number> }> => {
  await evaluateUserAchievements(userId);
  const achievements = await listAchievements();
  let rows: any[] = [];
  if (getDbMode() === 'LOCAL_SQL') {
    rows = getSqliteDb().prepare('SELECT * FROM user_achievements WHERE user_id = ?').all(userId) as any[];
  } else if (getDbMode() === 'MYSQL') {
    rows = await getMysqlDb().all('SELECT * FROM user_achievements WHERE user_id = ?', userId);
  } else {
    const { data, error } = await getSupabaseClient().from('user_achievements').select('*').eq('user_id', userId);
    if (error) throw error;
    rows = data || [];
  }
  const stateByAchievement = new Map(rows.map((row) => [Number(row.achievement_id), row]));
  const items = achievements.map((achievement) => {
    const state = stateByAchievement.get(achievement.id) || {};
    const status = (state.status || 'locked') as AchievementStatus;
    const completeOrClaimed = status === 'completed' || status === 'claimed';
    const hiddenMasked = achievement.is_hidden && !completeOrClaimed;
    const current = Number(state.progress_current || 0);
    const target = Math.max(1, Number(state.progress_target || evaluateCriteria(achievement.criteria_json, {}).target || 1));
    const view: UserAchievementView = hiddenMasked ? {
      achievement_id: achievement.id,
      code: null,
      name: '???',
      description: '조건을 달성하면 공개됩니다.',
      category: 'hidden',
      tier: achievement.tier,
      icon: 'Lock',
      icon_color: achievement.icon_color,
      is_hidden: true,
      hidden_hint: achievement.hidden_hint,
      status,
      progress_current: null,
      progress_target: null,
      progress_percent: null,
      completed_at: null,
      claimed_at: null,
      rewards: null,
      sort_order: achievement.sort_order
    } : {
      achievement_id: achievement.id,
      code: achievement.code,
      name: achievement.name,
      description: achievement.description,
      category: achievement.category,
      tier: achievement.tier,
      icon: achievement.icon,
      icon_color: achievement.icon_color,
      is_hidden: achievement.is_hidden,
      hidden_hint: achievement.hidden_hint,
      status,
      progress_current: current,
      progress_target: target,
      progress_percent: Math.max(0, Math.min(100, Math.round((current / target) * 100))),
      completed_at: normalizeDateValue(state.completed_at),
      claimed_at: normalizeDateValue(state.claimed_at),
      rewards: achievement.rewards_json,
      sort_order: achievement.sort_order
    };
    return view;
  });
  const filtered = items.filter((item) => {
    if (options.status && options.status !== 'ALL' && item.status !== options.status) return false;
    if (options.category && options.category !== 'ALL' && item.category !== options.category) return false;
    if (options.hidden === 'true' && !item.is_hidden) return false;
    if (options.hidden === 'false' && item.is_hidden) return false;
    return true;
  });
  const sort = options.sort || 'default';
  filtered.sort((a, b) => {
    if (sort === 'near') return (b.progress_percent ?? -1) - (a.progress_percent ?? -1);
    if (sort === 'completed') return new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime();
    if (sort === 'category') return String(a.category).localeCompare(String(b.category), 'ko-KR') || a.sort_order - b.sort_order;
    return a.sort_order - b.sort_order;
  });
  const limited = filtered.slice(0, clampLimit(options.limit, 120, 300));
  const summary = items.reduce((acc, item) => {
    acc.total += 1;
    if (item.status === 'completed' || item.status === 'claimed') acc.completed += 1;
    if (item.status === 'completed') acc.claimable += 1;
    if (item.is_hidden) acc.hidden += 1;
    return acc;
  }, { total: 0, completed: 0, claimable: 0, hidden: 0 });
  return { items: limited, summary };
};

const findAchievementById = async (id: number) => {
  const achievements = await listAchievements({ includeInactive: true });
  return achievements.find((achievement) => achievement.id === id) || null;
};

export const claimAchievementReward = async (userId: string, achievementId: number): Promise<{ ok: boolean; reason: string; rewards?: AchievementReward[]; new_points?: number }> => {
  await ensureAchievementTables();
  const achievement = await findAchievementById(achievementId);
  if (!achievement) return { ok: false, reason: 'NOT_FOUND' };
  const repeatKey = getRepeatKey(achievement);
  const rewards = achievement.rewards_json || [];
  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const txn = db.transaction(() => {
      const state = db.prepare('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?').get(userId, achievementId, repeatKey) as any;
      if (!state || state.status !== 'completed') return { ok: false, reason: state?.status === 'claimed' ? 'ALREADY_CLAIMED' : 'NOT_COMPLETED' };
      try {
        db.prepare('INSERT INTO achievement_grant_logs (user_id, achievement_id, repeat_key, reward_json, status) VALUES (?, ?, ?, ?, ?)')
          .run(userId, achievementId, repeatKey, JSON.stringify(rewards), 'success');
      } catch (err: any) {
        if (err?.code?.startsWith?.('SQLITE_CONSTRAINT')) return { ok: false, reason: 'ALREADY_CLAIMED' };
        throw err;
      }
      for (const reward of rewards) grantSqliteReward(db, userId, achievement, repeatKey, reward);
      db.prepare("UPDATE user_achievements SET status = 'claimed', claimed_at = datetime('now') WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?")
        .run(userId, achievementId, repeatKey);
      const user = db.prepare('SELECT point FROM users WHERE id = ?').get(userId) as any;
      return { ok: true, reason: 'OK', rewards, new_points: Number(user?.point || 0) };
    });
    const result = txn();
    if (result.ok) {
      notificationRepository.create({
        user_id: userId,
        title: '업적 보상 수령',
        body: `${achievement.name} 업적 보상을 수령했습니다.`,
        link: 'my-info'
      }).catch(() => undefined);
      await recomputeSnapshotStats(userId).catch(() => undefined);
    }
    return result;
  }
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().transaction(async (tx) => {
      const state = await tx.get('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ? AND repeat_key = ? FOR UPDATE', userId, achievementId, repeatKey);
      if (!state || state.status !== 'completed') return { ok: false, reason: state?.status === 'claimed' ? 'ALREADY_CLAIMED' : 'NOT_COMPLETED' };
      const inserted = await tx.run('INSERT IGNORE INTO achievement_grant_logs (user_id, achievement_id, repeat_key, reward_json, status) VALUES (?, ?, ?, ?, ?)', userId, achievementId, repeatKey, JSON.stringify(rewards), 'success');
      if (inserted.changes === 0) return { ok: false, reason: 'ALREADY_CLAIMED' };
      for (const reward of rewards) await grantMysqlReward(tx, userId, achievement, repeatKey, reward);
      await tx.run("UPDATE user_achievements SET status = 'claimed', claimed_at = UTC_TIMESTAMP() WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?", userId, achievementId, repeatKey);
      const user = await tx.get('SELECT point FROM users WHERE id = ?', userId);
      return { ok: true, reason: 'OK', rewards, new_points: Number(user?.point || 0) };
    });
    if (result.ok) {
      notificationRepository.create({
        user_id: userId,
        title: '업적 보상 수령',
        body: `${achievement.name} 업적 보상을 수령했습니다.`,
        link: 'my-info'
      }).catch(() => undefined);
      await recomputeSnapshotStats(userId).catch(() => undefined);
    }
    return result;
  }
  return { ok: false, reason: 'UNSUPPORTED_DB_MODE' };
};

const rewardSourceId = (achievement: Achievement, repeatKey: string) => `${achievement.code}:${repeatKey}`;

const grantSqliteReward = (db: any, userId: string, achievement: Achievement, repeatKey: string, reward: AchievementReward) => {
  const sourceId = rewardSourceId(achievement, repeatKey);
  if (reward.type === 'point') {
    const points = Math.trunc(Number(reward.points || 0));
    if (points <= 0) return;
    db.prepare('UPDATE users SET point = point + ? WHERE id = ?').run(points, userId);
    recordSqlitePointLedger(db, {
      userId,
      amount: points,
      sourceType: 'manual_adjustment',
      sourceId,
      reason: 'achievement_reward',
      description: `업적 보상: ${achievement.name}`,
      metadata: { achievement_id: achievement.id, achievement_code: achievement.code, repeat_key: repeatKey }
    });
  } else if (reward.type === 'card') {
    const quantity = Math.trunc(Number(reward.quantity || 0));
    const latest = db.prepare('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM user_cards WHERE channel_id = ?').get(reward.channel_id) as any;
    const baseSn = Number(latest?.max_sn || 0);
    for (let i = 1; i <= quantity; i++) {
      const result = db.prepare('INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, 0)').run(userId, reward.channel_id, baseSn + i);
      recordSqliteAssetEvent(db, {
        userId,
        assetType: 'card',
        action: 'add',
        quantity: 1,
        sourceType: 'achievement',
        sourceId,
        reason: 'achievement_card_reward',
        description: `업적 보상: ${achievement.name}`,
        cardId: Number(result.lastInsertRowid),
        channelId: reward.channel_id,
        serialNumber: baseSn + i,
        star: 0,
        metadata: { achievement_id: achievement.id, achievement_code: achievement.code }
      });
    }
  } else if (reward.type === 'cosmetic') {
    const quantity = Math.trunc(Number(reward.quantity || 0));
    db.prepare(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, ?)
      ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity
    `).run(userId, reward.item_id, quantity);
    recordSqliteAssetEvent(db, { userId, assetType: 'cosmetic', action: 'add', quantity, sourceType: 'achievement', sourceId, reason: 'achievement_cosmetic_reward', description: `업적 보상: ${achievement.name}`, itemId: reward.item_id });
  } else if (reward.type === 'minigame_ticket') {
    const quantity = Math.trunc(Number(reward.quantity || 0));
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
      VALUES (?, 5, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET bonus_tickets = bonus_tickets + excluded.bonus_tickets, updated_at = excluded.updated_at
    `).run(userId, quantity, now, now);
    recordSqliteAssetEvent(db, { userId, assetType: 'ticket', action: 'add', quantity, sourceType: 'achievement', sourceId, reason: 'achievement_minigame_ticket_reward', description: `업적 보상: ${achievement.name}`, itemType: 'minigame_ticket' });
  } else if (reward.type === 'free_draw_ticket') {
    const quantity = Math.trunc(Number(reward.quantity || 0));
    db.prepare('UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?').run(quantity, userId);
    recordSqliteAssetEvent(db, { userId, assetType: 'ticket', action: 'add', quantity, sourceType: 'achievement', sourceId, reason: 'achievement_free_draw_ticket_reward', description: `업적 보상: ${achievement.name}`, itemType: 'free_draw_ticket' });
  } else if (reward.type === 'title') {
    db.prepare(`
      INSERT INTO user_titles (user_id, title_id, grant_source) VALUES (?, ?, ?)
      ON CONFLICT(user_id, title_id) DO NOTHING
    `).run(userId, reward.title_id, 'achievement');
    recordSqliteAssetEvent(db, { userId, assetType: 'title', action: 'add', quantity: 1, sourceType: 'achievement', sourceId, reason: 'achievement_title_reward', description: `업적 보상: ${achievement.name}`, itemId: reward.title_id });
  }
};

const grantMysqlReward = async (tx: any, userId: string, achievement: Achievement, repeatKey: string, reward: AchievementReward) => {
  const sourceId = rewardSourceId(achievement, repeatKey);
  if (reward.type === 'point') {
    const points = Math.trunc(Number(reward.points || 0));
    if (points <= 0) return;
    await tx.run('UPDATE users SET point = point + ? WHERE id = ?', points, userId);
    await recordMysqlPointLedger(tx, {
      userId,
      amount: points,
      sourceType: 'manual_adjustment',
      sourceId,
      reason: 'achievement_reward',
      description: `업적 보상: ${achievement.name}`,
      metadata: { achievement_id: achievement.id, achievement_code: achievement.code, repeat_key: repeatKey }
    });
  } else if (reward.type === 'card') {
    const quantity = Math.trunc(Number(reward.quantity || 0));
    const latest = await tx.get('SELECT COALESCE(MAX(serial_number), 0) AS max_sn FROM user_cards WHERE channel_id = ? FOR UPDATE', reward.channel_id);
    const baseSn = Number(latest?.max_sn || 0);
    for (let i = 1; i <= quantity; i++) {
      const result = await tx.run('INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, 0)', userId, reward.channel_id, baseSn + i);
      await recordMysqlAssetEvent(tx, { userId, assetType: 'card', action: 'add', quantity: 1, sourceType: 'achievement', sourceId, reason: 'achievement_card_reward', description: `업적 보상: ${achievement.name}`, cardId: Number(result.insertId), channelId: reward.channel_id, serialNumber: baseSn + i, star: 0, metadata: { achievement_id: achievement.id, achievement_code: achievement.code } });
    }
  } else if (reward.type === 'cosmetic') {
    const quantity = Math.trunc(Number(reward.quantity || 0));
    await tx.run(`
      INSERT INTO user_cosmetics (user_id, item_id, quantity) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
    `, userId, reward.item_id, quantity);
    await recordMysqlAssetEvent(tx, { userId, assetType: 'cosmetic', action: 'add', quantity, sourceType: 'achievement', sourceId, reason: 'achievement_cosmetic_reward', description: `업적 보상: ${achievement.name}`, itemId: reward.item_id });
  } else if (reward.type === 'minigame_ticket') {
    const quantity = Math.trunc(Number(reward.quantity || 0));
    await tx.run(`
      INSERT INTO user_minigame_tickets (user_id, current_tickets, bonus_tickets, last_charged_at, updated_at)
      VALUES (?, 5, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE bonus_tickets = bonus_tickets + VALUES(bonus_tickets), updated_at = VALUES(updated_at)
    `, userId, quantity);
    await recordMysqlAssetEvent(tx, { userId, assetType: 'ticket', action: 'add', quantity, sourceType: 'achievement', sourceId, reason: 'achievement_minigame_ticket_reward', description: `업적 보상: ${achievement.name}`, itemType: 'minigame_ticket' });
  } else if (reward.type === 'free_draw_ticket') {
    const quantity = Math.trunc(Number(reward.quantity || 0));
    await tx.run('UPDATE users SET bonus_free_draw_tickets = COALESCE(bonus_free_draw_tickets, 0) + ? WHERE id = ?', quantity, userId);
    await recordMysqlAssetEvent(tx, { userId, assetType: 'ticket', action: 'add', quantity, sourceType: 'achievement', sourceId, reason: 'achievement_free_draw_ticket_reward', description: `업적 보상: ${achievement.name}`, itemType: 'free_draw_ticket' });
  } else if (reward.type === 'title') {
    await tx.run('INSERT IGNORE INTO user_titles (user_id, title_id, grant_source) VALUES (?, ?, ?)', userId, reward.title_id, 'achievement');
    await recordMysqlAssetEvent(tx, { userId, assetType: 'title', action: 'add', quantity: 1, sourceType: 'achievement', sourceId, reason: 'achievement_title_reward', description: `업적 보상: ${achievement.name}`, itemId: reward.title_id });
  }
};

export const createAchievement = async (payload: any, createdBy: string | null) => {
  await ensureAchievementTables();
  const validated = validateAchievementPayload(payload);
  if (!validated.ok) return validated;
  const a = validated.normalized as Achievement;
  if (getDbMode() === 'LOCAL_SQL') {
    const result = getSqliteDb().prepare(`
      INSERT INTO achievements
        (code, name, description, category, tier, icon, icon_color, is_active, is_hidden, hidden_hint, sort_order,
         starts_at, ends_at, repeat_policy, claim_policy, progress_mode, criteria_json, rewards_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(a.code, a.name, a.description, a.category, a.tier, a.icon, a.icon_color, a.is_active ? 1 : 0, a.is_hidden ? 1 : 0, a.hidden_hint, a.sort_order, a.starts_at, a.ends_at, a.repeat_policy, a.claim_policy, a.progress_mode, JSON.stringify(a.criteria_json), JSON.stringify(a.rewards_json), createdBy);
    invalidateAchievementCache();
    return { ok: true as const, achievement: { ...a, id: Number(result.lastInsertRowid) } };
  }
  if (getDbMode() === 'MYSQL') {
    const result = await getMysqlDb().run(`
      INSERT INTO achievements
        (code, name, description, category, tier, icon, icon_color, is_active, is_hidden, hidden_hint, sort_order,
         starts_at, ends_at, repeat_policy, claim_policy, progress_mode, criteria_json, rewards_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, a.code, a.name, a.description, a.category, a.tier, a.icon, a.icon_color, a.is_active ? 1 : 0, a.is_hidden ? 1 : 0, a.hidden_hint, a.sort_order, a.starts_at, a.ends_at, a.repeat_policy, a.claim_policy, a.progress_mode, JSON.stringify(a.criteria_json), JSON.stringify(a.rewards_json), createdBy);
    invalidateAchievementCache();
    return { ok: true as const, achievement: { ...a, id: Number(result.insertId) } };
  }
  return { ok: false as const, message: '현재 DB 모드에서는 관리자 업적 생성을 지원하지 않습니다.' };
};

export const updateAchievement = async (id: number, payload: any) => {
  await ensureAchievementTables();
  const current = await findAchievementById(id);
  if (!current) return { ok: false as const, message: '업적을 찾을 수 없습니다.' };
  const merged = { ...current, ...payload, code: current.code };
  const validated = validateAchievementPayload(merged);
  if (!validated.ok) return validated;
  const a = validated.normalized as Achievement;
  if (getDbMode() === 'LOCAL_SQL') {
    getSqliteDb().prepare(`
      UPDATE achievements
         SET name = ?, description = ?, category = ?, tier = ?, icon = ?, icon_color = ?, is_active = ?, is_hidden = ?,
             hidden_hint = ?, sort_order = ?, starts_at = ?, ends_at = ?, repeat_policy = ?, claim_policy = ?,
             progress_mode = ?, criteria_json = ?, rewards_json = ?, updated_at = datetime('now')
       WHERE id = ?
    `).run(a.name, a.description, a.category, a.tier, a.icon, a.icon_color, a.is_active ? 1 : 0, a.is_hidden ? 1 : 0, a.hidden_hint, a.sort_order, a.starts_at, a.ends_at, a.repeat_policy, a.claim_policy, a.progress_mode, JSON.stringify(a.criteria_json), JSON.stringify(a.rewards_json), id);
  } else if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(`
      UPDATE achievements
         SET name = ?, description = ?, category = ?, tier = ?, icon = ?, icon_color = ?, is_active = ?, is_hidden = ?,
             hidden_hint = ?, sort_order = ?, starts_at = ?, ends_at = ?, repeat_policy = ?, claim_policy = ?,
             progress_mode = ?, criteria_json = ?, rewards_json = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?
    `, a.name, a.description, a.category, a.tier, a.icon, a.icon_color, a.is_active ? 1 : 0, a.is_hidden ? 1 : 0, a.hidden_hint, a.sort_order, a.starts_at, a.ends_at, a.repeat_policy, a.claim_policy, a.progress_mode, JSON.stringify(a.criteria_json), JSON.stringify(a.rewards_json), id);
  } else return { ok: false as const, message: '현재 DB 모드에서는 관리자 업적 수정을 지원하지 않습니다.' };
  invalidateAchievementCache();
  return { ok: true as const };
};

export const adminListAchievementProgress = async () => {
  await ensureAchievementTables();
  const achievements = await listAchievements({ includeInactive: true });
  let rows: any[] = [];
  if (getDbMode() === 'LOCAL_SQL') {
    rows = getSqliteDb().prepare(`
      SELECT achievement_id,
             SUM(CASE WHEN status IN ('completed', 'claimed') THEN 1 ELSE 0 END) AS completed_count,
             SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed_count
        FROM user_achievements
       GROUP BY achievement_id
    `).all() as any[];
  } else if (getDbMode() === 'MYSQL') {
    rows = await getMysqlDb().all(`
      SELECT achievement_id,
             SUM(CASE WHEN status IN ('completed', 'claimed') THEN 1 ELSE 0 END) AS completed_count,
             SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed_count
        FROM user_achievements
       GROUP BY achievement_id
    `);
  }
  const counts = new Map(rows.map((row) => [Number(row.achievement_id), row]));
  return achievements.map((achievement) => ({
    ...achievement,
    completed_count: Number(counts.get(achievement.id)?.completed_count || 0),
    claimed_count: Number(counts.get(achievement.id)?.claimed_count || 0)
  }));
};
