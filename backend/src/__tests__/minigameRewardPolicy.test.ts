import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MINIGAME_REWARD_CONFIG,
  isAllowedMinigameReward,
  parseMinigameRewardConfig,
  resolveMinigameRewardConfigFromTargetData,
  serializeMinigameRewardConfig
} from '../services/minigameRewardPolicy';

describe('minigame reward policy', () => {
  it('parses camelCase and snake_case integer pairs and serializes one atomic value', () => {
    expect(parseMinigameRewardConfig({ successPoints: 1500, bonusPoints: 350 })).toEqual({
      successPoints: 1500,
      bonusPoints: 350
    });
    expect(parseMinigameRewardConfig({ success_points: '2500', bonus_points: '500' })).toEqual({
      successPoints: 2500,
      bonusPoints: 500
    });
    expect(serializeMinigameRewardConfig({ successPoints: 1500, bonusPoints: 350 }))
      .toBe('{"success_points":1500,"bonus_points":350}');
  });

  it.each([
    null,
    {},
    { success_points: -1, bonus_points: 0 },
    { success_points: 1.5, bonus_points: 0 },
    { success_points: '1e3', bonus_points: '200' },
    { success_points: 10_000_000, bonus_points: 1 },
    { success_points: Number.MAX_SAFE_INTEGER, bonus_points: 0 }
  ])('rejects malformed or unsafe configuration %j', (value) => {
    expect(parseMinigameRewardConfig(value)).toBeNull();
  });

  it('uses the legacy 1000/200 policy only when a session has no reward snapshot', () => {
    expect(resolveMinigameRewardConfigFromTargetData({ practice_mode: false }))
      .toEqual(DEFAULT_MINIGAME_REWARD_CONFIG);
    expect(resolveMinigameRewardConfigFromTargetData({ reward_config: 'broken' })).toBeNull();
    expect(resolveMinigameRewardConfigFromTargetData('{not-json')).toBeNull();
  });

  it('accepts only zero, success, or success plus bonus from the session snapshot', () => {
    const target = JSON.stringify({ reward_config: { success_points: 1500, bonus_points: 350 } });
    expect(isAllowedMinigameReward(0, target)).toBe(true);
    expect(isAllowedMinigameReward(1500, target)).toBe(true);
    expect(isAllowedMinigameReward(1850, target)).toBe(true);
    expect(isAllowedMinigameReward(1200, target)).toBe(false);
    expect(isAllowedMinigameReward(1500.5, target)).toBe(false);
  });

  it('keeps zero-point success configurations valid without opening arbitrary rewards', () => {
    const target = { reward_config: { success_points: 0, bonus_points: 200 } };
    expect(isAllowedMinigameReward(0, target)).toBe(true);
    expect(isAllowedMinigameReward(200, target)).toBe(true);
    expect(isAllowedMinigameReward(1000, target)).toBe(false);
  });
});
