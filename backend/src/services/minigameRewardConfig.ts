import { systemConfigRepository } from '../repositories';
import {
  DEFAULT_MINIGAME_REWARD_CONFIG,
  MINIGAME_REWARD_CONFIG_KEY,
  MinigameRewardConfig,
  parseMinigameRewardConfig,
  serializeMinigameRewardConfig
} from './minigameRewardPolicy';

export const getMinigameRewardConfig = async (): Promise<MinigameRewardConfig> => {
  const stored = await systemConfigRepository.get(
    MINIGAME_REWARD_CONFIG_KEY,
    serializeMinigameRewardConfig({ ...DEFAULT_MINIGAME_REWARD_CONFIG }),
    { fresh: true }
  );
  return parseMinigameRewardConfig(stored) ?? { ...DEFAULT_MINIGAME_REWARD_CONFIG };
};

export const saveMinigameRewardConfig = async (config: MinigameRewardConfig): Promise<void> => {
  await systemConfigRepository.set(MINIGAME_REWARD_CONFIG_KEY, serializeMinigameRewardConfig(config));
};
