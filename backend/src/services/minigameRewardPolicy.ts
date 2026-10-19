export type MinigameRewardConfig = {
  successPoints: number;
  bonusPoints: number;
};

export const MINIGAME_REWARD_CONFIG_KEY = 'minigame_reward_config';
export const DEFAULT_MINIGAME_SUCCESS_POINTS = 1000;
export const DEFAULT_MINIGAME_BONUS_POINTS = 200;
export const MIN_MINIGAME_REWARD_POINTS = 0;
export const MAX_MINIGAME_REWARD_POINTS = 10_000_000;

export const DEFAULT_MINIGAME_REWARD_CONFIG: Readonly<MinigameRewardConfig> = Object.freeze({
  successPoints: DEFAULT_MINIGAME_SUCCESS_POINTS,
  bonusPoints: DEFAULT_MINIGAME_BONUS_POINTS
});

const parseRewardInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed)
    || parsed < MIN_MINIGAME_REWARD_POINTS
    || parsed > MAX_MINIGAME_REWARD_POINTS
  ) {
    return null;
  }
  return parsed;
};

export const parseMinigameRewardConfig = (value: unknown): MinigameRewardConfig | null => {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;

  const record = source as Record<string, unknown>;
  const successPoints = parseRewardInteger(record.successPoints ?? record.success_points);
  const bonusPoints = parseRewardInteger(record.bonusPoints ?? record.bonus_points);
  if (
    successPoints === null
    || bonusPoints === null
    || successPoints + bonusPoints > MAX_MINIGAME_REWARD_POINTS
  ) {
    return null;
  }
  return { successPoints, bonusPoints };
};

export const serializeMinigameRewardConfig = (config: MinigameRewardConfig): string => JSON.stringify({
  success_points: config.successPoints,
  bonus_points: config.bonusPoints
});

export const resolveMinigameRewardConfigFromTargetData = (targetData: unknown): MinigameRewardConfig | null => {
  let target = targetData;
  if (typeof target === 'string') {
    try {
      target = JSON.parse(target);
    } catch {
      return null;
    }
  }
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return null;
  }
  const record = target as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'reward_config')) {
    return { ...DEFAULT_MINIGAME_REWARD_CONFIG };
  }
  return parseMinigameRewardConfig(record.reward_config);
};

export const readMinigameRewardConfigFromTargetData = (targetData: unknown): MinigameRewardConfig =>
  resolveMinigameRewardConfigFromTargetData(targetData) ?? { ...DEFAULT_MINIGAME_REWARD_CONFIG };

export const isAllowedMinigameReward = (earnedPoints: unknown, targetData: unknown): boolean => {
  if (!Number.isSafeInteger(earnedPoints)) return false;
  if (earnedPoints === 0) return true;
  const config = resolveMinigameRewardConfigFromTargetData(targetData);
  if (!config) return false;
  return earnedPoints === config.successPoints
    || earnedPoints === config.successPoints + config.bonusPoints;
};

export const toPublicMinigameRewardConfig = (config: MinigameRewardConfig) => ({
  success_points: config.successPoints,
  bonus_points: config.bonusPoints
});
