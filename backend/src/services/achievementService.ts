import { getDbMode, getMysqlDb, getSqliteDb, getSupabaseClient } from './db';
import { recordMysqlAssetEvent, recordSqliteAssetEvent } from './assetEventLog';
import { recordMysqlPointLedger, recordSqlitePointLedger } from './pointLedger';
import { createRealtimeNotification } from './notificationDelivery';

export type AchievementCategory =
  | 'start'
  | 'attendance'
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
  | { type: 'cosmetic'; item_id: number; quantity: number; label?: string; revoke_when_unmet?: boolean; granted?: boolean }
  | { type: 'minigame_ticket'; quantity: number; label?: string }
  | { type: 'free_draw_ticket'; quantity: number; label?: string }
  | { type: 'title'; title_id: number; label?: string; revoke_when_unmet?: boolean; granted?: boolean };

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
  limited_winner_count: number | null;
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
  condition_text: string | null;
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

const allowedCategories: AchievementCategory[] = ['start', 'attendance', 'collection', 'growth', 'economy', 'trade', 'market', 'minigame', 'community', 'streamer', 'event', 'hidden'];
const allowedTiers: AchievementTier[] = ['bronze', 'silver', 'gold', 'platinum', 'legendary', 'event'];
const allowedRepeatPolicies: AchievementRepeatPolicy[] = ['once', 'daily', 'weekly', 'monthly', 'seasonal', 'repeatable'];
const allowedClaimPolicies: AchievementClaimPolicy[] = ['manual', 'auto'];
const allowedProgressModes: AchievementProgressMode[] = ['incremental', 'snapshot', 'composite'];
const tierRank: Record<AchievementTier, number> = {
  legendary: 0,
  event: 1,
  platinum: 2,
  gold: 3,
  silver: 4,
  bronze: 5
};
const recommendedStatusRank: Record<AchievementStatus, number> = {
  completed: 0,
  in_progress: 1,
  locked: 2,
  expired: 3,
  claimed: 4
};

const allowedMetrics = new Set([
  'login.count',
  'login.daily.count',
  'login.current_streak_days',
  'login.max_streak_days',
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
  'achievement.completed_count',
  'achievement.claimed_count',
  'achievement.claimable_count',
  'inventory.card_count',
  'inventory.unique_streamer_count',
  'inventory.star.0.count',
  'inventory.star.1.count',
  'inventory.star.2.count',
  'inventory.star.3.count',
  'inventory.star.4.count',
  'inventory.star.5.count',
  'inventory.total_star_sum',
  'inventory.unique_star_level_count',
  'inventory.low_serial.1.count',
  'inventory.low_serial.10.count',
  'inventory.low_serial.100.count',
  'inventory.locked_count',
  'inventory.hidden_count',
  'inventory.favorite_count',
  'inventory.cosmetic_equipped_count',
  'inventory.border_equipped_count',
  'inventory.name_effect_equipped_count',
  'user.title_count',
  'user.cosmetic_count',
  'user.unique_cosmetic_count',
  'user.border_cosmetic_count',
  'user.name_effect_cosmetic_count',
  'user.point_balance',
  'user.free_draw_ticket_balance',
  'user.bonus_free_draw_ticket_balance',
  'user.minigame_ticket_balance',
  'user.account_age_days',
  'market.active_listing_count',
  'market.active_fixed_listing_count',
  'market.active_auction_listing_count',
  'market.sold_listing_count',
  'market.bought_listing_count',
  'market.active_bid_count',
  'market.watch_count',
  'shop.unique_purchase_count',
  'coupon.redeemed_unique_count',
  'community.friend_count'
]);

const metricConditionText: Record<string, (target: number) => string> = {
  'login.count': (target) => `${target.toLocaleString()}회 로그인`,
  'login.daily.count': (target) => `${target.toLocaleString()}일 로그인`,
  'login.current_streak_days': (target) => `연속 출석 ${target.toLocaleString()}일 유지`,
  'login.max_streak_days': (target) => `최대 연속 출석 ${target.toLocaleString()}일 달성`,
  'card.acquired.count': (target) => `카드 ${target.toLocaleString()}장 획득`,
  'card.sold.count': (target) => `카드 ${target.toLocaleString()}장 판매`,
  'card.fused.count': (target) => `카드 ${target.toLocaleString()}회 한계돌파`,
  'card.star.5.count': (target) => `5성 카드 ${target.toLocaleString()}장 획득`,
  'trade.completed.count': (target) => `교환 ${target.toLocaleString()}회 완료`,
  'market.listed.count': (target) => `마켓에 카드 ${target.toLocaleString()}회 등록`,
  'market.purchase.count': (target) => `마켓에서 카드 ${target.toLocaleString()}회 구매`,
  'market.sale.count': (target) => `마켓에서 카드 ${target.toLocaleString()}회 판매`,
  'market.bid.count': (target) => `마켓 입찰 ${target.toLocaleString()}회 참여`,
  'minigame.success.count': (target) => `미니게임 ${target.toLocaleString()}회 성공`,
  'minigame.success.quiz.count': (target) => `퀴즈 미니게임 ${target.toLocaleString()}회 성공`,
  'minigame.success.puzzle.count': (target) => `퍼즐 미니게임 ${target.toLocaleString()}회 성공`,
  'minigame.success.match.count': (target) => `매치 미니게임 ${target.toLocaleString()}회 성공`,
  'minigame.success.value_duel.count': (target) => `가치 대결 미니게임 ${target.toLocaleString()}회 성공`,
  'minigame.success.crop_detective.count': (target) => `크롭 탐정 미니게임 ${target.toLocaleString()}회 성공`,
  'minigame.perfect.count': (target) => `미니게임 퍼펙트 ${target.toLocaleString()}회 달성`,
  'minigame.speed_bonus.count': (target) => `미니게임 속도 보너스 ${target.toLocaleString()}회 달성`,
  'shop.purchase.count': (target) => `상점에서 ${target.toLocaleString()}회 구매`,
  'cosmetic.equip.count': (target) => `코스메틱 ${target.toLocaleString()}회 장착`,
  'coupon.claim.count': (target) => `쿠폰 ${target.toLocaleString()}회 사용`,
  'profile.representative.set': () => '대표 카드 설정',
  'profile.status_message.set': () => '상태 메시지 설정',
  'achievement.completed_count': (target) => `업적 ${target.toLocaleString()}개 달성`,
  'achievement.claimed_count': (target) => `업적 보상 ${target.toLocaleString()}개 수령`,
  'achievement.claimable_count': (target) => `수령 가능한 업적 ${target.toLocaleString()}개 보유`,
  'inventory.card_count': (target) => `카드 ${target.toLocaleString()}장 보유`,
  'inventory.unique_streamer_count': (target) => `서로 다른 스트리머 카드 ${target.toLocaleString()}종 보유`,
  'inventory.star.0.count': (target) => `0성 카드 ${target.toLocaleString()}장 보유`,
  'inventory.star.1.count': (target) => `1성 카드 ${target.toLocaleString()}장 보유`,
  'inventory.star.2.count': (target) => `2성 카드 ${target.toLocaleString()}장 보유`,
  'inventory.star.3.count': (target) => `3성 카드 ${target.toLocaleString()}장 보유`,
  'inventory.star.4.count': (target) => `4성 카드 ${target.toLocaleString()}장 보유`,
  'inventory.star.5.count': (target) => `5성 카드 ${target.toLocaleString()}장 보유`,
  'inventory.total_star_sum': (target) => `보유 카드 별 합계 ${target.toLocaleString()} 달성`,
  'inventory.unique_star_level_count': (target) => `서로 다른 카드 등급 ${target.toLocaleString()}종 보유`,
  'inventory.low_serial.1.count': (target) => `시리얼 1번 카드 ${target.toLocaleString()}장 보유`,
  'inventory.low_serial.10.count': (target) => `시리얼 10번 이하 카드 ${target.toLocaleString()}장 보유`,
  'inventory.low_serial.100.count': (target) => `시리얼 100번 이하 카드 ${target.toLocaleString()}장 보유`,
  'inventory.locked_count': (target) => `잠금 카드 ${target.toLocaleString()}장 보유`,
  'inventory.hidden_count': (target) => `숨김 카드 ${target.toLocaleString()}장 보유`,
  'inventory.favorite_count': (target) => `즐겨찾기 카드 ${target.toLocaleString()}장 설정`,
  'inventory.cosmetic_equipped_count': (target) => `코스메틱 장착 슬롯 ${target.toLocaleString()}개 사용`,
  'inventory.border_equipped_count': (target) => `테두리 코스메틱 ${target.toLocaleString()}개 장착`,
  'inventory.name_effect_equipped_count': (target) => `이름 이펙트 ${target.toLocaleString()}개 장착`,
  'user.title_count': (target) => `칭호 ${target.toLocaleString()}개 보유`,
  'user.cosmetic_count': (target) => `코스메틱 ${target.toLocaleString()}개 보유`,
  'user.unique_cosmetic_count': (target) => `서로 다른 코스메틱 ${target.toLocaleString()}종 보유`,
  'user.border_cosmetic_count': (target) => `테두리 코스메틱 ${target.toLocaleString()}개 보유`,
  'user.name_effect_cosmetic_count': (target) => `이름 이펙트 ${target.toLocaleString()}개 보유`,
  'user.point_balance': (target) => `${target.toLocaleString()}P 보유`,
  'user.free_draw_ticket_balance': (target) => `무료 소환권 ${target.toLocaleString()}장 보유`,
  'user.bonus_free_draw_ticket_balance': (target) => `추가 무료 소환권 ${target.toLocaleString()}장 보유`,
  'user.minigame_ticket_balance': (target) => `미니게임 티켓 ${target.toLocaleString()}장 보유`,
  'user.account_age_days': (target) => `가입 후 ${target.toLocaleString()}일 경과`,
  'market.active_listing_count': (target) => `마켓 판매 등록 ${target.toLocaleString()}건 유지`,
  'market.active_fixed_listing_count': (target) => `마켓 고정가 판매 등록 ${target.toLocaleString()}건 유지`,
  'market.active_auction_listing_count': (target) => `마켓 경매 등록 ${target.toLocaleString()}건 유지`,
  'market.sold_listing_count': (target) => `마켓 판매 완료 ${target.toLocaleString()}건 달성`,
  'market.bought_listing_count': (target) => `마켓 구매 완료 ${target.toLocaleString()}건 달성`,
  'market.active_bid_count': (target) => `진행 중인 경매 입찰 ${target.toLocaleString()}건 보유`,
  'market.watch_count': (target) => `마켓 관심 알림 ${target.toLocaleString()}개 설정`,
  'shop.unique_purchase_count': (target) => `서로 다른 상점 아이템 ${target.toLocaleString()}종 구매`,
  'coupon.redeemed_unique_count': (target) => `서로 다른 쿠폰 ${target.toLocaleString()}개 사용`,
  'community.friend_count': (target) => `친구 ${target.toLocaleString()}명 보유`
};

const formatCondition = (condition: { metric: string; target: number }) => {
  const target = Math.max(1, Math.floor(Number(condition.target || 1)));
  return metricConditionText[condition.metric]?.(target) || `${condition.metric} ${target.toLocaleString()} 달성`;
};

const formatAchievementConditionText = (criteria: AchievementCriteria) => {
  if (criteria.type === 'stat') return formatCondition(criteria);
  return criteria.conditions.map(formatCondition).join(' · ');
};

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

const uniquePositiveIds = (ids: number[]) =>
  Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.floor(id))));

const loadAchievementRewardLabels = async (rewardGroups: AchievementReward[][]) => {
  const cosmeticIds = uniquePositiveIds(rewardGroups.flatMap((rewards) =>
    rewards.map((reward) => reward.type === 'cosmetic' ? Number(reward.item_id || 0) : 0)
  ));
  const titleIds = uniquePositiveIds(rewardGroups.flatMap((rewards) =>
    rewards.map((reward) => reward.type === 'title' ? Number(reward.title_id || 0) : 0)
  ));
  const cosmeticNames = new Map<number, string>();
  const titleNames = new Map<number, string>();

  try {
    if (getDbMode() === 'LOCAL_SQL') {
      const db = getSqliteDb();
      if (cosmeticIds.length > 0) {
        const placeholders = cosmeticIds.map(() => '?').join(',');
        const rows = db.prepare(`SELECT id, name FROM shop_items WHERE id IN (${placeholders})`).all(...cosmeticIds) as any[];
        rows.forEach((row) => cosmeticNames.set(Number(row.id), String(row.name || `아이템#${row.id}`)));
      }
      if (titleIds.length > 0) {
        const placeholders = titleIds.map(() => '?').join(',');
        const rows = db.prepare(`SELECT id, name FROM titles WHERE id IN (${placeholders})`).all(...titleIds) as any[];
        rows.forEach((row) => titleNames.set(Number(row.id), String(row.name || `칭호#${row.id}`)));
      }
    } else if (getDbMode() === 'MYSQL') {
      const db = getMysqlDb();
      if (cosmeticIds.length > 0) {
        const placeholders = cosmeticIds.map(() => '?').join(',');
        const rows = await db.all(`SELECT id, name FROM shop_items WHERE id IN (${placeholders})`, cosmeticIds);
        rows.forEach((row: any) => cosmeticNames.set(Number(row.id), String(row.name || `아이템#${row.id}`)));
      }
      if (titleIds.length > 0) {
        const placeholders = titleIds.map(() => '?').join(',');
        const rows = await db.all(`SELECT id, name FROM titles WHERE id IN (${placeholders})`, titleIds);
        rows.forEach((row: any) => titleNames.set(Number(row.id), String(row.name || `칭호#${row.id}`)));
      }
    } else {
      const client = getSupabaseClient();
      if (cosmeticIds.length > 0) {
        const { data, error } = await client.from('shop_items').select('id,name').in('id', cosmeticIds);
        if (!error) (data || []).forEach((row: any) => cosmeticNames.set(Number(row.id), String(row.name || `아이템#${row.id}`)));
      }
      if (titleIds.length > 0) {
        const { data, error } = await client.from('titles').select('id,name').in('id', titleIds);
        if (!error) (data || []).forEach((row: any) => titleNames.set(Number(row.id), String(row.name || `칭호#${row.id}`)));
      }
    }
  } catch (err: any) {
    console.warn('[Achievement] 보상 라벨 조회 실패:', err?.message || err);
  }

  return { cosmeticNames, titleNames };
};

const applyAchievementRewardLabels = (
  rewards: AchievementReward[],
  labels: Awaited<ReturnType<typeof loadAchievementRewardLabels>>
): AchievementReward[] => rewards.map((reward) => {
  if (reward.type === 'cosmetic') {
    const label = reward.label || labels.cosmeticNames.get(Number(reward.item_id));
    return label ? { ...reward, label } : reward;
  }
  if (reward.type === 'title') {
    const label = reward.label || labels.titleNames.get(Number(reward.title_id));
    return label ? { ...reward, label } : reward;
  }
  return reward;
});

const enrichAchievementsWithRewardLabels = async (achievements: Achievement[]): Promise<Achievement[]> => {
  const labels = await loadAchievementRewardLabels(achievements.map((achievement) => achievement.rewards_json || []));
  return achievements.map((achievement) => ({
    ...achievement,
    rewards_json: applyAchievementRewardLabels(achievement.rewards_json || [], labels)
  }));
};

let sqliteReady: object | null = null;
let mysqlReady = false;
let achievementCache: { data: Achievement[]; expiresAt: number } | null = null;
const ACHIEVEMENT_CACHE_TTL_MS = 60_000;

const isSupabaseMissingRelationError = (error: any) => {
  const code = String(error?.code || '');
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return code === '42P01'
    || code === 'PGRST205'
    || /relation .* does not exist|could not find the table|schema cache|does not exist/i.test(message);
};

const DEFAULT_ACHIEVEMENTS: Array<Omit<Achievement, 'id' | 'created_at' | 'updated_at' | 'limited_winner_count' | 'criteria_json' | 'rewards_json'> & {
  limited_winner_count?: number | null;
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

const toMysqlDateTime = (value: string | Date | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
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
  limited_winner_count: Number(row.limited_winner_count || 0) > 0 ? Math.floor(Number(row.limited_winner_count)) : null,
  criteria_json: safeJsonParse<AchievementCriteria>(row.criteria_json, { type: 'stat', metric: 'login.count', target: 1 }),
  rewards_json: safeJsonParse<AchievementReward[]>(row.rewards_json, []),
  created_by: row.created_by ?? null,
  created_at: normalizeDateValue(row.created_at),
  updated_at: normalizeDateValue(row.updated_at)
});

const defaultAchievements = (): Achievement[] => DEFAULT_ACHIEVEMENTS.map((achievement, index) => ({
  ...achievement,
  id: index + 1,
  limited_winner_count: achievement.limited_winner_count || null,
  created_at: null,
  updated_at: null
}));

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
        limited_winner_count INTEGER,
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
    try {
      db.prepare('SELECT revoked_at FROM achievement_grant_logs LIMIT 1').get();
    } catch {
      db.exec('ALTER TABLE achievement_grant_logs ADD COLUMN revoked_at TEXT;');
    }
    try {
      db.prepare('SELECT limited_winner_count FROM achievements LIMIT 1').get();
    } catch {
      db.exec('ALTER TABLE achievements ADD COLUMN limited_winner_count INTEGER;');
    }
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
        icon VARCHAR(120) NULL,
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
        limited_winner_count INT NULL,
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
    try {
      await db.run('ALTER TABLE achievement_grant_logs ADD COLUMN revoked_at DATETIME NULL AFTER error_message');
    } catch (err: any) {
      if (err?.code !== 'ER_DUP_FIELDNAME' && !String(err?.message || '').includes('Duplicate column')) throw err;
    }
    try {
      await db.run('ALTER TABLE achievements ADD COLUMN limited_winner_count INT NULL AFTER progress_mode');
    } catch (err: any) {
      if (err?.code !== 'ER_DUP_FIELDNAME' && !String(err?.message || '').includes('Duplicate column')) throw err;
    }
    try {
      await db.run('ALTER TABLE achievements MODIFY COLUMN icon VARCHAR(120) NULL');
    } catch (err: any) {
      if (!String(err?.message || '').includes('check that column/key exists')) throw err;
    }
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

const normalizeIconName = (value: unknown): string | null => {
  const icon = String(value || '').trim();
  if (!icon) return null;
  if (icon.length > 120 || !/^(?:[A-Za-z][A-Za-z0-9]*|lucide:[A-Za-z][A-Za-z0-9]*|mdi(?::[a-z0-9][a-z0-9-]*|[A-Z][A-Za-z0-9]*))$/.test(icon)) {
    throw new Error('업적 아이콘명은 Lucide 또는 MDI 형식이어야 합니다.');
  }
  return icon;
};

export const validateAchievementPayload = (payload: any): { ok: true; normalized: Partial<Achievement> } | { ok: false; message: string } => {
  const code = String(payload.code || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,119}$/.test(code)) return { ok: false, message: '업적 코드는 영문/숫자/언더스코어/하이픈 3~120자로 입력해야 합니다.' };
  const name = String(payload.name || '').trim();
  if (!name || name.length > 120) return { ok: false, message: '업적 이름은 1~120자여야 합니다.' };
  let icon: string | null = null;
  try {
    icon = normalizeIconName(payload.icon);
  } catch (err: any) {
    return { ok: false, message: err?.message || '업적 아이콘명이 올바르지 않습니다.' };
  }
  const category = allowedCategories.includes(payload.category) ? payload.category : null;
  if (!category) return { ok: false, message: '업적 카테고리가 올바르지 않습니다.' };
  const tier = allowedTiers.includes(payload.tier) ? payload.tier : 'bronze';
  const repeatPolicy = allowedRepeatPolicies.includes(payload.repeat_policy) ? payload.repeat_policy : 'once';
  const claimPolicy = allowedClaimPolicies.includes(payload.claim_policy) ? payload.claim_policy : 'manual';
  const progressMode = allowedProgressModes.includes(payload.progress_mode) ? payload.progress_mode : 'incremental';
  const limitedWinnerCountRaw = Math.floor(Number(payload.limited_winner_count || 0));
  if (!Number.isFinite(limitedWinnerCountRaw) || limitedWinnerCountRaw < 0 || limitedWinnerCountRaw > 1_000_000) {
    return { ok: false, message: '선착순 한정 인원은 0~1,000,000 범위의 정수여야 합니다.' };
  }
  const limitedWinnerCount = limitedWinnerCountRaw > 0 ? limitedWinnerCountRaw : null;
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
  const normalizedRewards: AchievementReward[] = [];
  for (const reward of rewards) {
    if (!reward || typeof reward !== 'object') return { ok: false, message: '업적 보상 형식이 올바르지 않습니다.' };
    if (reward.type === 'point') {
      const points = Math.floor(Number(reward.points));
      if (!Number.isFinite(points) || points <= 0 || points > 10_000_000) return { ok: false, message: '포인트 보상은 1~10,000,000 범위여야 합니다.' };
      if ((reward as any).revoke_when_unmet === true) return { ok: false, message: '조건 미달 시 회수는 코스메틱 또는 칭호 보상에만 사용할 수 있습니다.' };
      economicRisk += points;
      normalizedRewards.push({ type: 'point', points, ...(reward.label ? { label: String(reward.label).slice(0, 120) } : {}) });
    } else if (reward.type === 'card') {
      if (!String((reward as any).channel_id || '').trim()) return { ok: false, message: '카드 보상은 스트리머 채널 ID가 필요합니다.' };
      const qty = Math.floor(Number((reward as any).quantity));
      if (!Number.isFinite(qty) || qty <= 0 || qty > 100) return { ok: false, message: '카드 보상 수량은 1~100 범위여야 합니다.' };
      if ((reward as any).revoke_when_unmet === true) return { ok: false, message: '조건 미달 시 회수는 코스메틱 또는 칭호 보상에만 사용할 수 있습니다.' };
      economicRisk += 50_000 * qty;
      normalizedRewards.push({ type: 'card', channel_id: String((reward as any).channel_id).trim(), quantity: qty, ...(reward.label ? { label: String(reward.label).slice(0, 120) } : {}) });
    } else if (reward.type === 'cosmetic') {
      const itemId = Math.floor(Number((reward as any).item_id));
      const qty = Math.floor(Number((reward as any).quantity));
      if (!itemId || qty <= 0 || qty > 100) return { ok: false, message: '코스메틱 보상은 아이템과 1~100 수량이 필요합니다.' };
      normalizedRewards.push({
        type: 'cosmetic',
        item_id: itemId,
        quantity: qty,
        ...(reward.label ? { label: String(reward.label).slice(0, 120) } : {}),
        ...((reward as any).revoke_when_unmet === true ? { revoke_when_unmet: true } : {})
      });
    } else if (reward.type === 'minigame_ticket' || reward.type === 'free_draw_ticket') {
      const qty = Math.floor(Number((reward as any).quantity));
      if (!Number.isFinite(qty) || qty <= 0 || qty > 100) return { ok: false, message: '티켓 보상 수량은 1~100 범위여야 합니다.' };
      if ((reward as any).revoke_when_unmet === true) return { ok: false, message: '조건 미달 시 회수는 코스메틱 또는 칭호 보상에만 사용할 수 있습니다.' };
      economicRisk += reward.type === 'free_draw_ticket' ? 10_000 * qty : 1_000 * qty;
      normalizedRewards.push({ type: reward.type, quantity: qty, ...(reward.label ? { label: String(reward.label).slice(0, 120) } : {}) } as AchievementReward);
    } else if (reward.type === 'title') {
      const titleId = Math.floor(Number((reward as any).title_id));
      if (!titleId) return { ok: false, message: '칭호 보상은 title_id가 필요합니다.' };
      normalizedRewards.push({
        type: 'title',
        title_id: titleId,
        ...(reward.label ? { label: String(reward.label).slice(0, 120) } : {}),
        ...((reward as any).revoke_when_unmet === true ? { revoke_when_unmet: true } : {})
      });
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
      icon,
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
      limited_winner_count: limitedWinnerCount,
      criteria_json: criteria,
      rewards_json: normalizedRewards
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
    if (error) {
      if (isSupabaseMissingRelationError(error)) return defaultAchievements();
      throw error;
    }
    rows = data && data.length > 0 ? data : defaultAchievements();
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
  if (error && isSupabaseMissingRelationError(error)) return {};
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

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const formatUtcDateKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

const getKstDateKey = (value: string | Date | null | undefined = new Date()) => {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return formatUtcDateKey(new Date(safeDate.getTime() + KST_OFFSET_MS));
};

const offsetDateKey = (dateKey: string, offsetDays: number) => {
  const parts = String(dateKey || '').split('-').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return formatUtcDateKey(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]) + offsetDays * DAY_MS));
};

const isDateKey = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

type AchievementStatRow = { stat_value: number; metadata_json?: unknown } | null;

const readAchievementStat = async (userId: string, statKey: string): Promise<AchievementStatRow> => {
  if (getDbMode() === 'LOCAL_SQL') {
    const row = getSqliteDb().prepare('SELECT stat_value, metadata_json FROM user_achievement_stats WHERE user_id = ? AND stat_key = ?').get(userId, statKey) as any;
    return row ? { stat_value: Number(row.stat_value || 0), metadata_json: row.metadata_json } : null;
  }
  if (getDbMode() === 'MYSQL') {
    const row = await getMysqlDb().get('SELECT stat_value, metadata_json FROM user_achievement_stats WHERE user_id = ? AND stat_key = ?', userId, statKey) as any;
    return row ? { stat_value: Number(row.stat_value || 0), metadata_json: row.metadata_json } : null;
  }
  const { data, error } = await getSupabaseClient()
    .from('user_achievement_stats')
    .select('stat_value, metadata_json')
    .eq('user_id', userId)
    .eq('stat_key', statKey)
    .maybeSingle();
  if (error && isSupabaseMissingRelationError(error)) return null;
  if (error) throw error;
  return data ? { stat_value: Number((data as any).stat_value || 0), metadata_json: (data as any).metadata_json } : null;
};

const setAchievementStat = async (userId: string, statKey: string, statValue: number, metadata: Record<string, unknown> = {}) => {
  const value = Math.max(0, Math.trunc(Number(statValue || 0)));
  if (getDbMode() === 'LOCAL_SQL') {
    getSqliteDb().prepare(`
      INSERT INTO user_achievement_stats (user_id, stat_key, stat_value, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, stat_key) DO UPDATE SET
        stat_value = excluded.stat_value,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(userId, statKey, value, JSON.stringify(metadata));
    return;
  }
  if (getDbMode() === 'MYSQL') {
    await getMysqlDb().run(`
      INSERT INTO user_achievement_stats (user_id, stat_key, stat_value, metadata_json, updated_at)
      VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE
        stat_value = VALUES(stat_value),
        metadata_json = VALUES(metadata_json),
        updated_at = VALUES(updated_at)
    `, userId, statKey, value, JSON.stringify(metadata));
    return;
  }
  const { error } = await getSupabaseClient().from('user_achievement_stats').upsert({
    user_id: userId,
    stat_key: statKey,
    stat_value: value,
    metadata_json: metadata,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,stat_key' });
  if (error && isSupabaseMissingRelationError(error)) return;
  if (error) throw error;
};

const getStatLastDate = (row: AchievementStatRow) =>
  safeJsonParse<{ last_date?: string }>(row?.metadata_json, {}).last_date || null;

const recordDailyLoginStreak = async (userId: string, occurredAt?: string | Date | null) => {
  const today = getKstDateKey(occurredAt);
  const yesterday = offsetDateKey(today, -1);
  const currentRow = await readAchievementStat(userId, 'login.current_streak_days');
  const maxRow = await readAchievementStat(userId, 'login.max_streak_days');
  const lastDate = getStatLastDate(currentRow);
  let currentStreak = Math.max(0, Math.trunc(Number(currentRow?.stat_value || 0)));
  if (lastDate === today) currentStreak = Math.max(1, currentStreak);
  else if (lastDate === yesterday) currentStreak += 1;
  else currentStreak = 1;
  const maxStreak = Math.max(Math.max(0, Math.trunc(Number(maxRow?.stat_value || 0))), currentStreak);
  const metadata = { last_date: today };
  await setAchievementStat(userId, 'login.current_streak_days', currentStreak, metadata);
  await setAchievementStat(userId, 'login.max_streak_days', maxStreak, metadata);
};

const expireDailyLoginStreakIfNeeded = async (userId: string) => {
  const row = await readAchievementStat(userId, 'login.current_streak_days');
  const lastDate = getStatLastDate(row);
  if (!isDateKey(lastDate)) return;
  const yesterday = offsetDateKey(getKstDateKey(), -1);
  if (!yesterday || String(lastDate) >= yesterday) return;
  if (Number(row?.stat_value || 0) <= 0) return;
  await setAchievementStat(userId, 'login.current_streak_days', 0, { last_date: lastDate });
};

export const recomputeSnapshotStats = async (userId: string): Promise<void> => {
  await ensureAchievementTables();
  if (!userId) return;
  await expireDailyLoginStreakIfNeeded(userId).catch(() => undefined);
  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const cardStats = db.prepare(`
      SELECT COUNT(*) AS card_count,
             COUNT(DISTINCT channel_id) AS unique_streamer_count,
             SUM(CASE WHEN COALESCE(star, 0) = 0 THEN 1 ELSE 0 END) AS star0_count,
             SUM(CASE WHEN COALESCE(star, 0) = 1 THEN 1 ELSE 0 END) AS star1_count,
             SUM(CASE WHEN COALESCE(star, 0) = 2 THEN 1 ELSE 0 END) AS star2_count,
             SUM(CASE WHEN COALESCE(star, 0) = 3 THEN 1 ELSE 0 END) AS star3_count,
             SUM(CASE WHEN COALESCE(star, 0) = 4 THEN 1 ELSE 0 END) AS star4_count,
             SUM(CASE WHEN COALESCE(star, 0) = 5 THEN 1 ELSE 0 END) AS star5_count,
             COALESCE(SUM(COALESCE(star, 0)), 0) AS total_star_sum,
             COUNT(DISTINCT COALESCE(star, 0)) AS unique_star_level_count,
             SUM(CASE WHEN serial_number = 1 THEN 1 ELSE 0 END) AS low_serial_1_count,
             SUM(CASE WHEN serial_number <= 10 THEN 1 ELSE 0 END) AS low_serial_10_count,
             SUM(CASE WHEN serial_number <= 100 THEN 1 ELSE 0 END) AS low_serial_100_count,
             SUM(CASE WHEN COALESCE(is_locked, 0) = 1 THEN 1 ELSE 0 END) AS locked_count,
             SUM(CASE WHEN COALESCE(is_hidden, 0) = 1 THEN 1 ELSE 0 END) AS hidden_count,
             SUM(CASE WHEN favorite_order IS NOT NULL THEN 1 ELSE 0 END) AS favorite_count,
             SUM(CASE WHEN border_item_id IS NOT NULL THEN 1 ELSE 0 END) AS border_equipped_count,
             SUM(CASE WHEN name_effect_item_id IS NOT NULL THEN 1 ELSE 0 END) AS name_effect_equipped_count,
             SUM(CASE WHEN border_item_id IS NOT NULL THEN 1 ELSE 0 END) + SUM(CASE WHEN name_effect_item_id IS NOT NULL THEN 1 ELSE 0 END) AS cosmetic_equipped_count
        FROM user_cards
       WHERE user_id = ?
    `).get(userId) as any;
    const titleStats = db.prepare('SELECT COUNT(*) AS c FROM user_titles WHERE user_id = ?').get(userId) as any;
    const cosmeticStats = db.prepare(`
      SELECT COALESCE(SUM(uc.quantity), 0) AS c,
             COUNT(DISTINCT uc.item_id) AS unique_count,
             COALESCE(SUM(CASE WHEN si.type = 'border' THEN uc.quantity ELSE 0 END), 0) AS border_count,
             COALESCE(SUM(CASE WHEN si.type = 'name_effect' THEN uc.quantity ELSE 0 END), 0) AS name_effect_count
        FROM user_cosmetics uc
        LEFT JOIN shop_items si ON si.id = uc.item_id
       WHERE uc.user_id = ?
    `).get(userId) as any;
    const achievementStats = db.prepare(`
      SELECT SUM(CASE WHEN status IN ('completed', 'claimed') THEN 1 ELSE 0 END) AS completed_count,
             SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed_count,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS claimable_count
        FROM user_achievements
       WHERE user_id = ?
    `).get(userId) as any;
    const marketStats = db.prepare(`
      SELECT SUM(CASE WHEN seller_id = ? AND status = 'PENDING' THEN 1 ELSE 0 END) AS active_listing_count,
             SUM(CASE WHEN seller_id = ? AND status = 'PENDING' AND COALESCE(listing_type, 'fixed') = 'fixed' THEN 1 ELSE 0 END) AS active_fixed_listing_count,
             SUM(CASE WHEN seller_id = ? AND status = 'PENDING' AND listing_type = 'auction' THEN 1 ELSE 0 END) AS active_auction_listing_count,
             SUM(CASE WHEN seller_id = ? AND status = 'SOLD' THEN 1 ELSE 0 END) AS sold_listing_count,
             SUM(CASE WHEN buyer_id = ? AND status = 'SOLD' THEN 1 ELSE 0 END) AS bought_listing_count,
             SUM(CASE WHEN current_bidder_id = ? AND status = 'PENDING' AND listing_type = 'auction' THEN 1 ELSE 0 END) AS active_bid_count
        FROM market_listings
    `).get(userId, userId, userId, userId, userId, userId) as any;
    const watchStats = db.prepare('SELECT COUNT(*) AS c FROM market_watches WHERE user_id = ?').get(userId) as any;
    const shopStats = db.prepare('SELECT COUNT(*) AS c FROM shop_purchases WHERE user_id = ?').get(userId) as any;
    const couponStats = db.prepare('SELECT COUNT(*) AS c FROM coupon_logs WHERE user_id = ?').get(userId) as any;
    const friendStats = db.prepare('SELECT COUNT(*) AS c FROM friendships WHERE user_a_id = ? OR user_b_id = ?').get(userId, userId) as any;
    const minigameTicketStats = db.prepare('SELECT COALESCE(current_tickets, 0) + COALESCE(bonus_tickets, 0) AS c FROM user_minigame_tickets WHERE user_id = ?').get(userId) as any;
    const user = db.prepare(`
      SELECT point, free_draw_tickets, bonus_free_draw_tickets, representative_card_channel_id, status_message,
             CAST(MAX(0, julianday('now') - julianday(COALESCE(created_at, datetime('now')))) AS INTEGER) AS account_age_days
        FROM users
       WHERE id = ?
    `).get(userId) as any;
    const stats: Record<string, number> = {
      'achievement.completed_count': Number(achievementStats?.completed_count || 0),
      'achievement.claimed_count': Number(achievementStats?.claimed_count || 0),
      'achievement.claimable_count': Number(achievementStats?.claimable_count || 0),
      'inventory.card_count': Number(cardStats?.card_count || 0),
      'inventory.unique_streamer_count': Number(cardStats?.unique_streamer_count || 0),
      'inventory.star.0.count': Number(cardStats?.star0_count || 0),
      'inventory.star.1.count': Number(cardStats?.star1_count || 0),
      'inventory.star.2.count': Number(cardStats?.star2_count || 0),
      'inventory.star.3.count': Number(cardStats?.star3_count || 0),
      'inventory.star.4.count': Number(cardStats?.star4_count || 0),
      'inventory.star.5.count': Number(cardStats?.star5_count || 0),
      'inventory.total_star_sum': Number(cardStats?.total_star_sum || 0),
      'inventory.unique_star_level_count': Number(cardStats?.unique_star_level_count || 0),
      'inventory.low_serial.1.count': Number(cardStats?.low_serial_1_count || 0),
      'inventory.low_serial.10.count': Number(cardStats?.low_serial_10_count || 0),
      'inventory.low_serial.100.count': Number(cardStats?.low_serial_100_count || 0),
      'inventory.locked_count': Number(cardStats?.locked_count || 0),
      'inventory.hidden_count': Number(cardStats?.hidden_count || 0),
      'inventory.favorite_count': Number(cardStats?.favorite_count || 0),
      'inventory.cosmetic_equipped_count': Number(cardStats?.cosmetic_equipped_count || 0),
      'inventory.border_equipped_count': Number(cardStats?.border_equipped_count || 0),
      'inventory.name_effect_equipped_count': Number(cardStats?.name_effect_equipped_count || 0),
      'user.title_count': Number(titleStats?.c || 0),
      'user.cosmetic_count': Number(cosmeticStats?.c || 0),
      'user.unique_cosmetic_count': Number(cosmeticStats?.unique_count || 0),
      'user.border_cosmetic_count': Number(cosmeticStats?.border_count || 0),
      'user.name_effect_cosmetic_count': Number(cosmeticStats?.name_effect_count || 0),
      'user.point_balance': Number(user?.point || 0),
      'user.free_draw_ticket_balance': Number(user?.free_draw_tickets || 0) + Number(user?.bonus_free_draw_tickets || 0),
      'user.bonus_free_draw_ticket_balance': Number(user?.bonus_free_draw_tickets || 0),
      'user.minigame_ticket_balance': Number(minigameTicketStats?.c || 0),
      'user.account_age_days': Number(user?.account_age_days || 0),
      'profile.representative.set': user?.representative_card_channel_id ? 1 : 0,
      'profile.status_message.set': user?.status_message ? 1 : 0,
      'market.active_listing_count': Number(marketStats?.active_listing_count || 0),
      'market.active_fixed_listing_count': Number(marketStats?.active_fixed_listing_count || 0),
      'market.active_auction_listing_count': Number(marketStats?.active_auction_listing_count || 0),
      'market.sold_listing_count': Number(marketStats?.sold_listing_count || 0),
      'market.bought_listing_count': Number(marketStats?.bought_listing_count || 0),
      'market.active_bid_count': Number(marketStats?.active_bid_count || 0),
      'market.watch_count': Number(watchStats?.c || 0),
      'shop.unique_purchase_count': Number(shopStats?.c || 0),
      'coupon.redeemed_unique_count': Number(couponStats?.c || 0),
      'community.friend_count': Number(friendStats?.c || 0)
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
             SUM(CASE WHEN COALESCE(star, 0) = 0 THEN 1 ELSE 0 END) AS star0_count,
             SUM(CASE WHEN COALESCE(star, 0) = 1 THEN 1 ELSE 0 END) AS star1_count,
             SUM(CASE WHEN COALESCE(star, 0) = 2 THEN 1 ELSE 0 END) AS star2_count,
             SUM(CASE WHEN COALESCE(star, 0) = 3 THEN 1 ELSE 0 END) AS star3_count,
             SUM(CASE WHEN COALESCE(star, 0) = 4 THEN 1 ELSE 0 END) AS star4_count,
             SUM(CASE WHEN COALESCE(star, 0) = 5 THEN 1 ELSE 0 END) AS star5_count,
             COALESCE(SUM(COALESCE(star, 0)), 0) AS total_star_sum,
             COUNT(DISTINCT COALESCE(star, 0)) AS unique_star_level_count,
             SUM(CASE WHEN serial_number = 1 THEN 1 ELSE 0 END) AS low_serial_1_count,
             SUM(CASE WHEN serial_number <= 10 THEN 1 ELSE 0 END) AS low_serial_10_count,
             SUM(CASE WHEN serial_number <= 100 THEN 1 ELSE 0 END) AS low_serial_100_count,
             SUM(CASE WHEN COALESCE(is_locked, 0) = 1 THEN 1 ELSE 0 END) AS locked_count,
             SUM(CASE WHEN COALESCE(is_hidden, 0) = 1 THEN 1 ELSE 0 END) AS hidden_count,
             SUM(CASE WHEN favorite_order IS NOT NULL THEN 1 ELSE 0 END) AS favorite_count,
             SUM(CASE WHEN border_item_id IS NOT NULL THEN 1 ELSE 0 END) AS border_equipped_count,
             SUM(CASE WHEN name_effect_item_id IS NOT NULL THEN 1 ELSE 0 END) AS name_effect_equipped_count,
             SUM(CASE WHEN border_item_id IS NOT NULL THEN 1 ELSE 0 END) + SUM(CASE WHEN name_effect_item_id IS NOT NULL THEN 1 ELSE 0 END) AS cosmetic_equipped_count
        FROM user_cards
       WHERE user_id = ?
    `, userId);
    const titleStats = await db.get('SELECT COUNT(*) AS c FROM user_titles WHERE user_id = ?', userId);
    const cosmeticStats = await db.get(`
      SELECT COALESCE(SUM(uc.quantity), 0) AS c,
             COUNT(DISTINCT uc.item_id) AS unique_count,
             COALESCE(SUM(CASE WHEN si.type = 'border' THEN uc.quantity ELSE 0 END), 0) AS border_count,
             COALESCE(SUM(CASE WHEN si.type = 'name_effect' THEN uc.quantity ELSE 0 END), 0) AS name_effect_count
        FROM user_cosmetics uc
        LEFT JOIN shop_items si ON si.id = uc.item_id
       WHERE uc.user_id = ?
    `, userId);
    const achievementStats = await db.get(`
      SELECT SUM(CASE WHEN status IN ('completed', 'claimed') THEN 1 ELSE 0 END) AS completed_count,
             SUM(CASE WHEN status = 'claimed' THEN 1 ELSE 0 END) AS claimed_count,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS claimable_count
        FROM user_achievements
       WHERE user_id = ?
    `, userId);
    const marketStats = await db.get(`
      SELECT SUM(CASE WHEN seller_id = ? AND status = 'PENDING' THEN 1 ELSE 0 END) AS active_listing_count,
             SUM(CASE WHEN seller_id = ? AND status = 'PENDING' AND COALESCE(listing_type, 'fixed') = 'fixed' THEN 1 ELSE 0 END) AS active_fixed_listing_count,
             SUM(CASE WHEN seller_id = ? AND status = 'PENDING' AND listing_type = 'auction' THEN 1 ELSE 0 END) AS active_auction_listing_count,
             SUM(CASE WHEN seller_id = ? AND status = 'SOLD' THEN 1 ELSE 0 END) AS sold_listing_count,
             SUM(CASE WHEN buyer_id = ? AND status = 'SOLD' THEN 1 ELSE 0 END) AS bought_listing_count,
             SUM(CASE WHEN current_bidder_id = ? AND status = 'PENDING' AND listing_type = 'auction' THEN 1 ELSE 0 END) AS active_bid_count
        FROM market_listings
    `, userId, userId, userId, userId, userId, userId);
    const watchStats = await db.get('SELECT COUNT(*) AS c FROM market_watches WHERE user_id = ?', userId);
    const shopStats = await db.get('SELECT COUNT(*) AS c FROM shop_purchases WHERE user_id = ?', userId);
    const couponStats = await db.get('SELECT COUNT(*) AS c FROM coupon_logs WHERE user_id = ?', userId);
    const friendStats = await db.get('SELECT COUNT(*) AS c FROM friendships WHERE user_a_id = ? OR user_b_id = ?', userId, userId);
    const minigameTicketStats = await db.get('SELECT COALESCE(current_tickets, 0) + COALESCE(bonus_tickets, 0) AS c FROM user_minigame_tickets WHERE user_id = ?', userId);
    const user = await db.get(`
      SELECT point, free_draw_tickets, bonus_free_draw_tickets, representative_card_channel_id, status_message,
             GREATEST(0, TIMESTAMPDIFF(DAY, COALESCE(created_at, UTC_TIMESTAMP()), UTC_TIMESTAMP())) AS account_age_days
        FROM users
       WHERE id = ?
    `, userId);
    const stats: Record<string, number> = {
      'achievement.completed_count': Number(achievementStats?.completed_count || 0),
      'achievement.claimed_count': Number(achievementStats?.claimed_count || 0),
      'achievement.claimable_count': Number(achievementStats?.claimable_count || 0),
      'inventory.card_count': Number(cardStats?.card_count || 0),
      'inventory.unique_streamer_count': Number(cardStats?.unique_streamer_count || 0),
      'inventory.star.0.count': Number(cardStats?.star0_count || 0),
      'inventory.star.1.count': Number(cardStats?.star1_count || 0),
      'inventory.star.2.count': Number(cardStats?.star2_count || 0),
      'inventory.star.3.count': Number(cardStats?.star3_count || 0),
      'inventory.star.4.count': Number(cardStats?.star4_count || 0),
      'inventory.star.5.count': Number(cardStats?.star5_count || 0),
      'inventory.total_star_sum': Number(cardStats?.total_star_sum || 0),
      'inventory.unique_star_level_count': Number(cardStats?.unique_star_level_count || 0),
      'inventory.low_serial.1.count': Number(cardStats?.low_serial_1_count || 0),
      'inventory.low_serial.10.count': Number(cardStats?.low_serial_10_count || 0),
      'inventory.low_serial.100.count': Number(cardStats?.low_serial_100_count || 0),
      'inventory.locked_count': Number(cardStats?.locked_count || 0),
      'inventory.hidden_count': Number(cardStats?.hidden_count || 0),
      'inventory.favorite_count': Number(cardStats?.favorite_count || 0),
      'inventory.cosmetic_equipped_count': Number(cardStats?.cosmetic_equipped_count || 0),
      'inventory.border_equipped_count': Number(cardStats?.border_equipped_count || 0),
      'inventory.name_effect_equipped_count': Number(cardStats?.name_effect_equipped_count || 0),
      'user.title_count': Number(titleStats?.c || 0),
      'user.cosmetic_count': Number(cosmeticStats?.c || 0),
      'user.unique_cosmetic_count': Number(cosmeticStats?.unique_count || 0),
      'user.border_cosmetic_count': Number(cosmeticStats?.border_count || 0),
      'user.name_effect_cosmetic_count': Number(cosmeticStats?.name_effect_count || 0),
      'user.point_balance': Number(user?.point || 0),
      'user.free_draw_ticket_balance': Number(user?.free_draw_tickets || 0) + Number(user?.bonus_free_draw_tickets || 0),
      'user.bonus_free_draw_ticket_balance': Number(user?.bonus_free_draw_tickets || 0),
      'user.minigame_ticket_balance': Number(minigameTicketStats?.c || 0),
      'user.account_age_days': Number(user?.account_age_days || 0),
      'profile.representative.set': user?.representative_card_channel_id ? 1 : 0,
      'profile.status_message.set': user?.status_message ? 1 : 0,
      'market.active_listing_count': Number(marketStats?.active_listing_count || 0),
      'market.active_fixed_listing_count': Number(marketStats?.active_fixed_listing_count || 0),
      'market.active_auction_listing_count': Number(marketStats?.active_auction_listing_count || 0),
      'market.sold_listing_count': Number(marketStats?.sold_listing_count || 0),
      'market.bought_listing_count': Number(marketStats?.bought_listing_count || 0),
      'market.active_bid_count': Number(marketStats?.active_bid_count || 0),
      'market.watch_count': Number(watchStats?.c || 0),
      'shop.unique_purchase_count': Number(shopStats?.c || 0),
      'coupon.redeemed_unique_count': Number(couponStats?.c || 0),
      'community.friend_count': Number(friendStats?.c || 0)
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
      const { data, error: selectError } = await client.from('user_achievement_stats').select('stat_value').eq('user_id', userId).eq('stat_key', key).maybeSingle();
      if (selectError && isSupabaseMissingRelationError(selectError)) return;
      if (selectError) throw selectError;
      const { error: upsertError } = await client.from('user_achievement_stats').upsert({
        user_id: userId,
        stat_key: key,
        stat_value: Number(data?.stat_value || 0) + Math.trunc(Number(value)),
        metadata_json: {},
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,stat_key' });
      if (upsertError && isSupabaseMissingRelationError(upsertError)) return;
      if (upsertError) throw upsertError;
    }
  }
};

const isRevocableReward = (reward: AchievementReward) =>
  (reward.type === 'cosmetic' || reward.type === 'title') && reward.revoke_when_unmet === true;

const hasRevocableRewards = (achievement: Achievement) =>
  (achievement.rewards_json || []).some(isRevocableReward);

const sameRewardTarget = (a: AchievementReward, b: AchievementReward) => {
  if (a.type !== b.type) return false;
  if (a.type === 'cosmetic' && b.type === 'cosmetic') return Number(a.item_id) === Number(b.item_id);
  if (a.type === 'title' && b.type === 'title') return Number(a.title_id) === Number(b.title_id);
  return false;
};

const revocableGrantedRewards = (achievement: Achievement, loggedRewards: AchievementReward[]) =>
  loggedRewards.filter((logged) => {
    if (logged.type !== 'cosmetic' && logged.type !== 'title') return false;
    if ((logged as any).granted === false) return false;
    return logged.revoke_when_unmet === true || (achievement.rewards_json || []).some((current) => isRevocableReward(current) && sameRewardTarget(current, logged));
  });

const revokeSqliteCosmeticReward = (db: any, userId: string, achievement: Achievement, reward: Extract<AchievementReward, { type: 'cosmetic' }>) => {
  let remaining = Math.max(1, Math.trunc(Number(reward.quantity || 1)));
  const itemId = Number(reward.item_id);
  const owned = db.prepare('SELECT quantity FROM user_cosmetics WHERE user_id = ? AND item_id = ?').get(userId, itemId) as any;
  const fromInventory = Math.min(remaining, Math.max(0, Number(owned?.quantity || 0)));
  if (fromInventory > 0) {
    const nextQty = Number(owned.quantity || 0) - fromInventory;
    if (nextQty > 0) db.prepare('UPDATE user_cosmetics SET quantity = ? WHERE user_id = ? AND item_id = ?').run(nextQty, userId, itemId);
    else db.prepare('DELETE FROM user_cosmetics WHERE user_id = ? AND item_id = ?').run(userId, itemId);
    remaining -= fromInventory;
  }
  if (remaining > 0) {
    const cards = db.prepare(`
      SELECT id, border_item_id, name_effect_item_id
        FROM user_cards
       WHERE user_id = ?
         AND (border_item_id = ? OR name_effect_item_id = ?)
       ORDER BY id ASC
       LIMIT ?
    `).all(userId, itemId, itemId, remaining) as any[];
    for (const card of cards) {
      db.prepare(`
        UPDATE user_cards
           SET border_item_id = CASE WHEN border_item_id = ? THEN NULL ELSE border_item_id END,
               name_effect_item_id = CASE WHEN name_effect_item_id = ? THEN NULL ELSE name_effect_item_id END
         WHERE id = ?
      `).run(itemId, itemId, card.id);
    }
  }
  recordSqliteAssetEvent(db, {
    userId,
    assetType: 'cosmetic',
    action: 'delete',
    quantity: Math.max(1, Math.trunc(Number(reward.quantity || 1))),
    sourceType: 'achievement',
    sourceId: achievement.id,
    reason: 'achievement_reward_revoked',
    description: `업적 조건 미달로 보상 회수: ${achievement.name}`,
    itemId
  });
};

const revokeSqliteReward = (db: any, userId: string, achievement: Achievement, reward: AchievementReward) => {
  if (reward.type === 'cosmetic') {
    revokeSqliteCosmeticReward(db, userId, achievement, reward);
  } else if (reward.type === 'title') {
    const result = db.prepare("DELETE FROM user_titles WHERE user_id = ? AND title_id = ? AND grant_source = 'achievement'").run(userId, reward.title_id);
    if (Number(result.changes || 0) > 0) {
      recordSqliteAssetEvent(db, { userId, assetType: 'title', action: 'delete', quantity: 1, sourceType: 'achievement', sourceId: achievement.id, reason: 'achievement_reward_revoked', description: `업적 조건 미달로 보상 회수: ${achievement.name}`, itemId: reward.title_id });
    }
  }
};

const revokeSqliteRevocableRewards = (db: any, userId: string, achievement: Achievement, repeatKey: string): boolean => {
  const log = db.prepare("SELECT * FROM achievement_grant_logs WHERE user_id = ? AND achievement_id = ? AND repeat_key = ? AND status = 'success'").get(userId, achievement.id, repeatKey) as any;
  if (!log) return false;
  const rewards = revocableGrantedRewards(achievement, safeJsonParse<AchievementReward[]>(log.reward_json, []));
  if (rewards.length === 0) return false;
  for (const reward of rewards) revokeSqliteReward(db, userId, achievement, reward);
  db.prepare("UPDATE achievement_grant_logs SET status = 'revoked', revoked_at = datetime('now'), error_message = ? WHERE id = ?").run('condition_unmet', log.id);
  return true;
};

const revokeMysqlCosmeticReward = async (tx: any, userId: string, achievement: Achievement, reward: Extract<AchievementReward, { type: 'cosmetic' }>) => {
  let remaining = Math.max(1, Math.trunc(Number(reward.quantity || 1)));
  const itemId = Number(reward.item_id);
  const owned = await tx.get('SELECT quantity FROM user_cosmetics WHERE user_id = ? AND item_id = ? FOR UPDATE', userId, itemId);
  const fromInventory = Math.min(remaining, Math.max(0, Number(owned?.quantity || 0)));
  if (fromInventory > 0) {
    const nextQty = Number(owned.quantity || 0) - fromInventory;
    if (nextQty > 0) await tx.run('UPDATE user_cosmetics SET quantity = ? WHERE user_id = ? AND item_id = ?', nextQty, userId, itemId);
    else await tx.run('DELETE FROM user_cosmetics WHERE user_id = ? AND item_id = ?', userId, itemId);
    remaining -= fromInventory;
  }
  if (remaining > 0) {
    const cards = await tx.all(`
      SELECT id
        FROM user_cards
       WHERE user_id = ?
         AND (border_item_id = ? OR name_effect_item_id = ?)
       ORDER BY id ASC
       LIMIT ?
       FOR UPDATE
    `, userId, itemId, itemId, remaining);
    for (const card of cards) {
      await tx.run(`
        UPDATE user_cards
           SET border_item_id = CASE WHEN border_item_id = ? THEN NULL ELSE border_item_id END,
               name_effect_item_id = CASE WHEN name_effect_item_id = ? THEN NULL ELSE name_effect_item_id END
         WHERE id = ?
      `, itemId, itemId, card.id);
    }
  }
  await recordMysqlAssetEvent(tx, {
    userId,
    assetType: 'cosmetic',
    action: 'delete',
    quantity: Math.max(1, Math.trunc(Number(reward.quantity || 1))),
    sourceType: 'achievement',
    sourceId: achievement.id,
    reason: 'achievement_reward_revoked',
    description: `업적 조건 미달로 보상 회수: ${achievement.name}`,
    itemId
  });
};

const revokeMysqlReward = async (tx: any, userId: string, achievement: Achievement, reward: AchievementReward) => {
  if (reward.type === 'cosmetic') {
    await revokeMysqlCosmeticReward(tx, userId, achievement, reward);
  } else if (reward.type === 'title') {
    const result = await tx.run("DELETE FROM user_titles WHERE user_id = ? AND title_id = ? AND grant_source = 'achievement'", userId, reward.title_id);
    if (Number(result.changes || result.affectedRows || 0) > 0) {
      await recordMysqlAssetEvent(tx, { userId, assetType: 'title', action: 'delete', quantity: 1, sourceType: 'achievement', sourceId: achievement.id, reason: 'achievement_reward_revoked', description: `업적 조건 미달로 보상 회수: ${achievement.name}`, itemId: reward.title_id });
    }
  }
};

const revokeMysqlRevocableRewards = async (userId: string, achievement: Achievement, repeatKey: string): Promise<boolean> => {
  return getMysqlDb().transaction(async (tx) => {
    const log = await tx.get("SELECT * FROM achievement_grant_logs WHERE user_id = ? AND achievement_id = ? AND repeat_key = ? AND status = 'success' FOR UPDATE", userId, achievement.id, repeatKey);
    if (!log) return false;
    const rewards = revocableGrantedRewards(achievement, safeJsonParse<AchievementReward[]>(log.reward_json, []));
    if (rewards.length === 0) return false;
    for (const reward of rewards) await revokeMysqlReward(tx, userId, achievement, reward);
    await tx.run("UPDATE achievement_grant_logs SET status = 'revoked', revoked_at = UTC_TIMESTAMP(), error_message = ? WHERE id = ?", 'condition_unmet', log.id);
    return true;
  });
};

const limitedWinnerLimit = (achievement: Achievement) =>
  Math.max(0, Math.trunc(Number(achievement.limited_winner_count || 0)));

const isAchievementWinnerStatus = (status: unknown) =>
  status === 'completed' || status === 'claimed';

export const evaluateUserAchievements = async (userId: string): Promise<void> => {
  await ensureAchievementTables();
  await recomputeSnapshotStats(userId).catch(() => undefined);
  const achievements = await listAchievements();
  const stats = await getUserStats(userId);
  const nowIso = new Date().toISOString();

  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const select = db.prepare('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?');
    const countLimitedWinners = db.prepare("SELECT COUNT(*) AS c FROM user_achievements WHERE achievement_id = ? AND repeat_key = ? AND status IN ('completed', 'claimed')");
    const insert = db.prepare(`
      INSERT INTO user_achievements
        (user_id, achievement_id, status, progress_current, progress_target, progress_json, completed_at, claimed_at, last_evaluated_at, repeat_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, achievement_id, repeat_key) DO UPDATE SET
        status = excluded.status,
        progress_current = excluded.progress_current,
        progress_target = excluded.progress_target,
        progress_json = excluded.progress_json,
        completed_at = excluded.completed_at,
        claimed_at = excluded.claimed_at,
        last_evaluated_at = excluded.last_evaluated_at
    `);
    const txn = db.transaction(() => {
      for (const achievement of achievements) {
        if (!activeInWindow(achievement)) continue;
        const repeatKey = getRepeatKey(achievement);
        const current = select.get(userId, achievement.id, repeatKey) as any;
        const revocable = hasRevocableRewards(achievement);
        if (current?.status === 'claimed' && !revocable) continue;
        const result = evaluateCriteria(achievement.criteria_json, stats);
        const status: AchievementStatus = result.complete ? 'completed' : (result.rawCurrent > 0 ? 'in_progress' : 'locked');
        const wasClaimed = current?.status === 'claimed';
        if (revocable && wasClaimed && !result.complete) {
          revokeSqliteRevocableRewards(db, userId, achievement, repeatKey);
        }
        const limit = limitedWinnerLimit(achievement);
        const limitedExhausted = limit > 0
          && !isAchievementWinnerStatus(current?.status)
          && Number((countLimitedWinners.get(achievement.id, repeatKey) as any)?.c || 0) >= limit;
        const nextStatus: AchievementStatus = revocable
          ? (limitedExhausted ? 'expired' : (wasClaimed && result.complete ? 'claimed' : status))
          : (limitedExhausted ? 'expired' : (current?.status === 'completed' ? 'completed' : status));
        const nextCompletedAt = !limitedExhausted && result.complete
          ? (current?.completed_at || nowIso)
          : (revocable ? null : current?.completed_at || null);
        const nextClaimedAt = nextStatus === 'claimed' ? (current?.claimed_at || nowIso) : null;
        insert.run(
          userId,
          achievement.id,
          nextStatus,
          result.rawCurrent,
          result.target,
          JSON.stringify(result.details),
          nextCompletedAt,
          nextClaimedAt,
          nowIso,
          repeatKey
        );
      }
    });
    txn();
  } else if (getDbMode() === 'MYSQL') {
    const db = getMysqlDb();
    const nowMysql = toMysqlDateTime(nowIso);
    for (const achievement of achievements) {
      if (!activeInWindow(achievement)) continue;
      const repeatKey = getRepeatKey(achievement);
      const current = await db.get('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?', userId, achievement.id, repeatKey);
      const revocable = hasRevocableRewards(achievement);
      if (current?.status === 'claimed' && !revocable) continue;
      const result = evaluateCriteria(achievement.criteria_json, stats);
      const status: AchievementStatus = result.complete ? 'completed' : (result.rawCurrent > 0 ? 'in_progress' : 'locked');
      const wasClaimed = current?.status === 'claimed';
      if (revocable && wasClaimed && !result.complete) {
        await revokeMysqlRevocableRewards(userId, achievement, repeatKey);
      }
      const limit = limitedWinnerLimit(achievement);
      const alreadyWinner = isAchievementWinnerStatus(current?.status);
      if (limit > 0 && result.complete && !alreadyWinner) {
        await db.transaction(async (tx) => {
          await tx.get('SELECT id FROM achievements WHERE id = ? FOR UPDATE', achievement.id);
          const lockedCurrent = await tx.get('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ? AND repeat_key = ? FOR UPDATE', userId, achievement.id, repeatKey);
          const lockedWinner = isAchievementWinnerStatus(lockedCurrent?.status);
          const winnerCount = lockedWinner
            ? 0
            : Number((await tx.get("SELECT COUNT(*) AS c FROM user_achievements WHERE achievement_id = ? AND repeat_key = ? AND status IN ('completed', 'claimed')", achievement.id, repeatKey))?.c || 0);
          const limitedExhausted = !lockedWinner && winnerCount >= limit;
          const lockedWasClaimed = lockedCurrent?.status === 'claimed';
          const limitedStatus: AchievementStatus = limitedExhausted ? 'expired' : (lockedWasClaimed && revocable ? 'claimed' : 'completed');
          const limitedCompletedAt = !limitedExhausted
            ? (normalizeDateValue(lockedCurrent?.completed_at) ? toMysqlDateTime(lockedCurrent.completed_at) : nowMysql)
            : null;
          const limitedClaimedAt = limitedStatus === 'claimed'
            ? (normalizeDateValue(lockedCurrent?.claimed_at) ? toMysqlDateTime(lockedCurrent.claimed_at) : nowMysql)
            : null;
          await tx.run(`
            INSERT INTO user_achievements
              (user_id, achievement_id, status, progress_current, progress_target, progress_json, completed_at, claimed_at, last_evaluated_at, repeat_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              status = VALUES(status),
              progress_current = VALUES(progress_current),
              progress_target = VALUES(progress_target),
              progress_json = VALUES(progress_json),
              completed_at = VALUES(completed_at),
              claimed_at = VALUES(claimed_at),
              last_evaluated_at = VALUES(last_evaluated_at)
          `,
            userId,
            achievement.id,
            limitedStatus,
            result.rawCurrent,
            result.target,
            JSON.stringify(result.details),
            limitedCompletedAt,
            limitedClaimedAt,
            nowMysql,
            repeatKey
          );
        });
        continue;
      }
      const limitedExhausted = limit > 0
        && !alreadyWinner
        && Number((await db.get("SELECT COUNT(*) AS c FROM user_achievements WHERE achievement_id = ? AND repeat_key = ? AND status IN ('completed', 'claimed')", achievement.id, repeatKey))?.c || 0) >= limit;
      const nextStatus: AchievementStatus = revocable
        ? (limitedExhausted ? 'expired' : (wasClaimed && result.complete ? 'claimed' : status))
        : (limitedExhausted ? 'expired' : (current?.status === 'completed' ? 'completed' : status));
      const nextCompletedAt = !limitedExhausted && result.complete
        ? (normalizeDateValue(current?.completed_at) ? toMysqlDateTime(current.completed_at) : nowMysql)
        : (revocable ? null : toMysqlDateTime(current?.completed_at));
      const nextClaimedAt = nextStatus === 'claimed'
        ? (normalizeDateValue(current?.claimed_at) ? toMysqlDateTime(current.claimed_at) : nowMysql)
        : null;
      await db.run(`
        INSERT INTO user_achievements
          (user_id, achievement_id, status, progress_current, progress_target, progress_json, completed_at, claimed_at, last_evaluated_at, repeat_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          progress_current = VALUES(progress_current),
          progress_target = VALUES(progress_target),
          progress_json = VALUES(progress_json),
          completed_at = VALUES(completed_at),
          claimed_at = VALUES(claimed_at),
          last_evaluated_at = VALUES(last_evaluated_at)
      `,
        userId,
        achievement.id,
        nextStatus,
        result.rawCurrent,
        result.target,
        JSON.stringify(result.details),
        nextCompletedAt,
        nextClaimedAt,
        nowMysql,
        repeatKey
      );
    }
  } else {
    const client = getSupabaseClient();
    const { data: existingRows, error: selectError } = await client
      .from('user_achievements')
      .select('*')
      .eq('user_id', userId);
    if (selectError && isSupabaseMissingRelationError(selectError)) return;
    if (selectError) throw selectError;

    const existingByKey = new Map((existingRows || []).map((row: any) => [`${Number(row.achievement_id)}:${row.repeat_key || 'once'}`, row]));
    const updates: any[] = [];
    for (const achievement of achievements) {
      if (!activeInWindow(achievement)) continue;
      const repeatKey = getRepeatKey(achievement);
      const current = existingByKey.get(`${achievement.id}:${repeatKey}`);
      const revocable = hasRevocableRewards(achievement);
      if (current?.status === 'claimed' && !revocable) continue;
      const result = evaluateCriteria(achievement.criteria_json, stats);
      const status: AchievementStatus = result.complete ? 'completed' : (result.rawCurrent > 0 ? 'in_progress' : 'locked');
      const wasClaimed = current?.status === 'claimed';
      const limit = limitedWinnerLimit(achievement);
      let limitedExhausted = false;
      if (limit > 0 && !isAchievementWinnerStatus(current?.status)) {
        const { count, error: countError } = await client
          .from('user_achievements')
          .select('id', { count: 'exact', head: true })
          .eq('achievement_id', achievement.id)
          .eq('repeat_key', repeatKey)
          .in('status', ['completed', 'claimed']);
        if (countError && isSupabaseMissingRelationError(countError)) return;
        if (countError) throw countError;
        limitedExhausted = Number(count || 0) >= limit;
      }
      const nextStatus: AchievementStatus = revocable
        ? (limitedExhausted ? 'expired' : (wasClaimed && result.complete ? 'claimed' : status))
        : (limitedExhausted ? 'expired' : (current?.status === 'completed' ? 'completed' : status));
      updates.push({
        user_id: userId,
        achievement_id: achievement.id,
        status: nextStatus,
        progress_current: result.rawCurrent,
        progress_target: result.target,
        progress_json: result.details,
        completed_at: !limitedExhausted && result.complete ? (current?.completed_at || nowIso) : (revocable ? null : current?.completed_at || null),
        claimed_at: nextStatus === 'claimed' ? (current?.claimed_at || nowIso) : null,
        last_evaluated_at: nowIso,
        repeat_key: repeatKey
      });
    }
    if (updates.length > 0) {
      const { error: upsertError } = await client
        .from('user_achievements')
        .upsert(updates, { onConflict: 'user_id,achievement_id,repeat_key' });
      if (upsertError && isSupabaseMissingRelationError(upsertError)) return;
      if (upsertError) throw upsertError;
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
        toMysqlDateTime(input.occurredAt || new Date()) || toMysqlDateTime(new Date())
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
    if (input.eventType === 'login.daily') await recordDailyLoginStreak(input.userId, input.occurredAt || new Date());
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
  const achievements = await enrichAchievementsWithRewardLabels(await listAchievements());
  let rows: any[] = [];
  if (getDbMode() === 'LOCAL_SQL') {
    rows = getSqliteDb().prepare('SELECT * FROM user_achievements WHERE user_id = ?').all(userId) as any[];
  } else if (getDbMode() === 'MYSQL') {
    rows = await getMysqlDb().all('SELECT * FROM user_achievements WHERE user_id = ?', userId);
  } else {
    const { data, error } = await getSupabaseClient().from('user_achievements').select('*').eq('user_id', userId);
    if (error && isSupabaseMissingRelationError(error)) rows = [];
    else if (error) throw error;
    else rows = data || [];
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
      condition_text: null,
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
      condition_text: formatAchievementConditionText(achievement.criteria_json),
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
    if (sort === 'recommended') {
      return (recommendedStatusRank[a.status] ?? 9) - (recommendedStatusRank[b.status] ?? 9)
        || (b.progress_percent ?? -1) - (a.progress_percent ?? -1)
        || a.sort_order - b.sort_order;
    }
    if (sort === 'progress' || sort === 'near') return (b.progress_percent ?? -1) - (a.progress_percent ?? -1) || a.sort_order - b.sort_order;
    if (sort === 'completed') return new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime();
    if (sort === 'tier') return (tierRank[a.tier] ?? 9) - (tierRank[b.tier] ?? 9) || a.sort_order - b.sort_order;
    if (sort === 'name') return String(a.name).localeCompare(String(b.name), 'ko-KR') || a.sort_order - b.sort_order;
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
  const labels = await loadAchievementRewardLabels([achievement.rewards_json || []]);
  const displayRewards = applyAchievementRewardLabels(achievement.rewards_json || [], labels);
  const repeatKey = getRepeatKey(achievement);
  const rewards = achievement.rewards_json || [];
  if (getDbMode() === 'LOCAL_SQL') {
    const db = getSqliteDb();
    const txn = db.transaction(() => {
      const state = db.prepare('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?').get(userId, achievementId, repeatKey) as any;
      if (!state || state.status !== 'completed') return { ok: false, reason: state?.status === 'claimed' ? 'ALREADY_CLAIMED' : 'NOT_COMPLETED' };
      const existingLog = db.prepare('SELECT status FROM achievement_grant_logs WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?').get(userId, achievementId, repeatKey) as any;
      if (existingLog?.status === 'success') return { ok: false, reason: 'ALREADY_CLAIMED' };
      if (existingLog) {
        db.prepare("UPDATE achievement_grant_logs SET reward_json = '[]', status = 'pending', error_message = NULL, revoked_at = NULL WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?")
          .run(userId, achievementId, repeatKey);
      } else {
        db.prepare('INSERT INTO achievement_grant_logs (user_id, achievement_id, repeat_key, reward_json, status) VALUES (?, ?, ?, ?, ?)')
          .run(userId, achievementId, repeatKey, '[]', 'pending');
      }
      const grantedRewards = rewards.map((reward) => grantSqliteReward(db, userId, achievement, repeatKey, reward));
      db.prepare("UPDATE achievement_grant_logs SET reward_json = ?, status = 'success', error_message = NULL, revoked_at = NULL WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?")
        .run(JSON.stringify(grantedRewards), userId, achievementId, repeatKey);
      db.prepare("UPDATE user_achievements SET status = 'claimed', claimed_at = datetime('now') WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?")
        .run(userId, achievementId, repeatKey);
      const user = db.prepare('SELECT point FROM users WHERE id = ?').get(userId) as any;
      return { ok: true, reason: 'OK', rewards: displayRewards, new_points: Number(user?.point || 0) };
    });
    const result = txn();
    if (result.ok) {
      createRealtimeNotification({
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
      const existingLog = await tx.get('SELECT status FROM achievement_grant_logs WHERE user_id = ? AND achievement_id = ? AND repeat_key = ? FOR UPDATE', userId, achievementId, repeatKey);
      if (existingLog?.status === 'success') return { ok: false, reason: 'ALREADY_CLAIMED' };
      if (existingLog) {
        await tx.run("UPDATE achievement_grant_logs SET reward_json = ?, status = 'pending', error_message = NULL, revoked_at = NULL WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?", JSON.stringify([]), userId, achievementId, repeatKey);
      } else {
        await tx.run('INSERT INTO achievement_grant_logs (user_id, achievement_id, repeat_key, reward_json, status) VALUES (?, ?, ?, ?, ?)', userId, achievementId, repeatKey, JSON.stringify([]), 'pending');
      }
      const grantedRewards: AchievementReward[] = [];
      for (const reward of rewards) grantedRewards.push(await grantMysqlReward(tx, userId, achievement, repeatKey, reward));
      await tx.run("UPDATE achievement_grant_logs SET reward_json = ?, status = 'success', error_message = NULL, revoked_at = NULL WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?", JSON.stringify(grantedRewards), userId, achievementId, repeatKey);
      await tx.run("UPDATE user_achievements SET status = 'claimed', claimed_at = UTC_TIMESTAMP() WHERE user_id = ? AND achievement_id = ? AND repeat_key = ?", userId, achievementId, repeatKey);
      const user = await tx.get('SELECT point FROM users WHERE id = ?', userId);
      return { ok: true, reason: 'OK', rewards: displayRewards, new_points: Number(user?.point || 0) };
    });
    if (result.ok) {
      createRealtimeNotification({
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

const nextMysqlCardSerialNumber = async (
  tx: { run: (...args: any[]) => Promise<any>; get: <T = any>(sql: string, ...args: any[]) => Promise<T | undefined> },
  channelId: string
): Promise<number> => {
  await tx.run(
    `INSERT INTO user_card_serials (channel_id, last_serial)
     SELECT ?, COALESCE(MAX(serial_number), 0) + 1
       FROM user_cards
      WHERE channel_id = ?
     ON DUPLICATE KEY UPDATE last_serial = GREATEST(last_serial + 1, VALUES(last_serial))`,
    channelId,
    channelId
  );
  const row = await tx.get<{ last_serial: number }>('SELECT last_serial FROM user_card_serials WHERE channel_id = ?', channelId);
  return Number(row?.last_serial || 1);
};

const grantSqliteReward = (db: any, userId: string, achievement: Achievement, repeatKey: string, reward: AchievementReward): AchievementReward => {
  const sourceId = rewardSourceId(achievement, repeatKey);
  if (reward.type === 'point') {
    const points = Math.trunc(Number(reward.points || 0));
    if (points <= 0) return reward;
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
    const result = db.prepare(`
      INSERT INTO user_titles (user_id, title_id, grant_source) VALUES (?, ?, ?)
      ON CONFLICT(user_id, title_id) DO NOTHING
    `).run(userId, reward.title_id, 'achievement');
    const granted = Number(result.changes || 0) > 0;
    if (granted) {
      recordSqliteAssetEvent(db, { userId, assetType: 'title', action: 'add', quantity: 1, sourceType: 'achievement', sourceId, reason: 'achievement_title_reward', description: `업적 보상: ${achievement.name}`, itemId: reward.title_id });
    }
    return { ...reward, granted };
  }
  return reward;
};

const grantMysqlReward = async (tx: any, userId: string, achievement: Achievement, repeatKey: string, reward: AchievementReward): Promise<AchievementReward> => {
  const sourceId = rewardSourceId(achievement, repeatKey);
  if (reward.type === 'point') {
    const points = Math.trunc(Number(reward.points || 0));
    if (points <= 0) return reward;
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
    for (let i = 0; i < quantity; i++) {
      const serialNumber = await nextMysqlCardSerialNumber(tx, reward.channel_id as string);
      const result = await tx.run('INSERT INTO user_cards (user_id, channel_id, serial_number, star) VALUES (?, ?, ?, 0)', userId, reward.channel_id, serialNumber);
      await recordMysqlAssetEvent(tx, { userId, assetType: 'card', action: 'add', quantity: 1, sourceType: 'achievement', sourceId, reason: 'achievement_card_reward', description: `업적 보상: ${achievement.name}`, cardId: Number(result.insertId), channelId: reward.channel_id, serialNumber, star: 0, metadata: { achievement_id: achievement.id, achievement_code: achievement.code } });
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
    const result = await tx.run('INSERT IGNORE INTO user_titles (user_id, title_id, grant_source) VALUES (?, ?, ?)', userId, reward.title_id, 'achievement');
    const granted = Number(result.changes || result.affectedRows || 0) > 0;
    if (granted) {
      await recordMysqlAssetEvent(tx, { userId, assetType: 'title', action: 'add', quantity: 1, sourceType: 'achievement', sourceId, reason: 'achievement_title_reward', description: `업적 보상: ${achievement.name}`, itemId: reward.title_id });
    }
    return { ...reward, granted };
  }
  return reward;
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
         starts_at, ends_at, repeat_policy, claim_policy, progress_mode, limited_winner_count, criteria_json, rewards_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(a.code, a.name, a.description, a.category, a.tier, a.icon, a.icon_color, a.is_active ? 1 : 0, a.is_hidden ? 1 : 0, a.hidden_hint, a.sort_order, a.starts_at, a.ends_at, a.repeat_policy, a.claim_policy, a.progress_mode, a.limited_winner_count, JSON.stringify(a.criteria_json), JSON.stringify(a.rewards_json), createdBy);
    invalidateAchievementCache();
    return { ok: true as const, achievement: { ...a, id: Number(result.lastInsertRowid) } };
  }
  if (getDbMode() === 'MYSQL') {
    const startsAt = toMysqlDateTime(a.starts_at);
    const endsAt = toMysqlDateTime(a.ends_at);
    const result = await getMysqlDb().run(`
      INSERT INTO achievements
        (code, name, description, category, tier, icon, icon_color, is_active, is_hidden, hidden_hint, sort_order,
         starts_at, ends_at, repeat_policy, claim_policy, progress_mode, limited_winner_count, criteria_json, rewards_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, a.code, a.name, a.description, a.category, a.tier, a.icon, a.icon_color, a.is_active ? 1 : 0, a.is_hidden ? 1 : 0, a.hidden_hint, a.sort_order, startsAt, endsAt, a.repeat_policy, a.claim_policy, a.progress_mode, a.limited_winner_count, JSON.stringify(a.criteria_json), JSON.stringify(a.rewards_json), createdBy);
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
             progress_mode = ?, limited_winner_count = ?, criteria_json = ?, rewards_json = ?, updated_at = datetime('now')
       WHERE id = ?
    `).run(a.name, a.description, a.category, a.tier, a.icon, a.icon_color, a.is_active ? 1 : 0, a.is_hidden ? 1 : 0, a.hidden_hint, a.sort_order, a.starts_at, a.ends_at, a.repeat_policy, a.claim_policy, a.progress_mode, a.limited_winner_count, JSON.stringify(a.criteria_json), JSON.stringify(a.rewards_json), id);
  } else if (getDbMode() === 'MYSQL') {
    const startsAt = toMysqlDateTime(a.starts_at);
    const endsAt = toMysqlDateTime(a.ends_at);
    await getMysqlDb().run(`
      UPDATE achievements
         SET name = ?, description = ?, category = ?, tier = ?, icon = ?, icon_color = ?, is_active = ?, is_hidden = ?,
             hidden_hint = ?, sort_order = ?, starts_at = ?, ends_at = ?, repeat_policy = ?, claim_policy = ?,
             progress_mode = ?, limited_winner_count = ?, criteria_json = ?, rewards_json = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ?
    `, a.name, a.description, a.category, a.tier, a.icon, a.icon_color, a.is_active ? 1 : 0, a.is_hidden ? 1 : 0, a.hidden_hint, a.sort_order, startsAt, endsAt, a.repeat_policy, a.claim_policy, a.progress_mode, a.limited_winner_count, JSON.stringify(a.criteria_json), JSON.stringify(a.rewards_json), id);
  } else return { ok: false as const, message: '현재 DB 모드에서는 관리자 업적 수정을 지원하지 않습니다.' };
  invalidateAchievementCache();
  return { ok: true as const };
};

export const adminListAchievementProgress = async () => {
  await ensureAchievementTables();
  const achievements = await enrichAchievementsWithRewardLabels(await listAchievements({ includeInactive: true }));
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
