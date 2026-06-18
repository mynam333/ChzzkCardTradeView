import { Coupon, CouponReward, CouponRewardType } from '../repositories/interfaces';

export const COUPON_REWARD_TYPES: CouponRewardType[] = [
  'point',
  'card',
  'cosmetic',
  'minigame_ticket',
  'free_draw_ticket',
  'title'
];

export const parseCouponRewards = (value: unknown): CouponReward[] => {
  if (!value) return [];
  const parsed = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((reward) => normalizeStoredReward(reward))
    .filter((reward): reward is CouponReward => reward !== null);
};

export const couponToRewards = (coupon: Coupon): CouponReward[] => {
  const stored = parseCouponRewards(coupon.rewards);
  if (stored.length > 0) return stored;

  if (coupon.reward_type === 'point') {
    return [{ type: 'point', points: Number(coupon.points || 0) }];
  }
  if (coupon.reward_type === 'card') {
    return [{
      type: 'card',
      channel_id: coupon.reward_channel_id,
      quantity: Number(coupon.reward_quantity || 0)
    }];
  }
  if (coupon.reward_type === 'cosmetic') {
    return [{
      type: 'cosmetic',
      item_id: coupon.reward_item_id ?? null,
      quantity: Number(coupon.reward_quantity || 0)
    }];
  }
  if (coupon.reward_type === 'title') {
    return [{
      type: 'title',
      title_id: coupon.reward_item_id ?? null
    }];
  }
  return [{
    type: coupon.reward_type,
    quantity: Number(coupon.reward_quantity || 0)
  }];
};

export const rewardsToJson = (rewards: CouponReward[]) => JSON.stringify(rewards.map((reward) => ({
  type: reward.type,
  points: reward.type === 'point' ? Number(reward.points || 0) : undefined,
  channel_id: reward.type === 'card' ? reward.channel_id || null : undefined,
  item_id: reward.type === 'cosmetic' ? Number(reward.item_id || 0) : undefined,
  title_id: reward.type === 'title' ? Number(reward.title_id || 0) : undefined,
  quantity: reward.type === 'point' || reward.type === 'title' ? undefined : Number(reward.quantity || 0)
})));

const safeJsonParse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeStoredReward = (value: any): CouponReward | null => {
  const type = value?.type as CouponRewardType;
  if (!COUPON_REWARD_TYPES.includes(type)) return null;
  if (type === 'point') return { type, points: Number(value.points || 0) };
  if (type === 'card') return { type, channel_id: value.channel_id || null, quantity: Number(value.quantity || 0) };
  if (type === 'cosmetic') return { type, item_id: value.item_id ?? null, quantity: Number(value.quantity || 0) };
  if (type === 'title') return { type, title_id: value.title_id ?? value.item_id ?? null };
  return { type, quantity: Number(value.quantity || 0) };
};
