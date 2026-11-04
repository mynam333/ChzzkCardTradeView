import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import { applyBulkCardSettings } from '../services/bulkCardSettingsService';

const controllerMocks = vi.hoisted(() => ({
  userCardRepository: {
    updateVisibility: vi.fn(),
    setFavorite: vi.fn(),
    setLocked: vi.fn()
  },
  marketRepository: {
    findPendingCardIdsByUser: vi.fn()
  },
  recordAchievementEvent: vi.fn(),
  clearUserCardsInFlight: vi.fn(),
  scheduleUserRankingRefresh: vi.fn()
}));

vi.mock('../repositories', () => ({
  userCardRepository: controllerMocks.userCardRepository,
  marketRepository: controllerMocks.marketRepository
}));
vi.mock('../services/achievementService', () => ({
  recordAchievementEvent: controllerMocks.recordAchievementEvent
}));
vi.mock('../controllers/playController', () => ({
  clearUserCardsInFlight: controllerMocks.clearUserCardsInFlight,
  scheduleUserRankingRefresh: controllerMocks.scheduleUserRankingRefresh
}));

import { updateMyCardSettingsBulk } from '../controllers/bulkCardSettingsController';

const createResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
  return response as typeof response & Response;
};

describe('applyBulkCardSettings', () => {
  it('200장 요청은 repository bulk fast path를 한 번만 호출한다', async () => {
    const updates = Array.from({ length: 200 }, (_, index) => ({ card_id: index + 1, value: index % 2 === 0 }));
    const updateSettingsBulk = vi.fn(async (_userId: string, _setting: string, entries: typeof updates) =>
      entries.filter((entry) => entry.card_id !== 199).map((entry) => entry.card_id));
    const updateVisibility = vi.fn();

    const result = await applyBulkCardSettings('user-1', 'hidden', updates, {
      userCardRepository: {
        updateSettingsBulk,
        updateVisibility,
        setFavorite: vi.fn(),
        setLocked: vi.fn()
      },
      marketRepository: { findPendingCardIdsByUser: vi.fn() }
    } as any);

    expect(updateSettingsBulk).toHaveBeenCalledOnce();
    expect(updateSettingsBulk).toHaveBeenCalledWith('user-1', 'hidden', updates);
    expect(updateVisibility).not.toHaveBeenCalled();
    expect(result.succeededIds).toHaveLength(199);
    expect(result.failedIds).toEqual([199]);
  });

  it('bulk fast path 앞에서도 마켓 대기 잠금 카드를 제외하고 실패 ID 순서를 보존한다', async () => {
    const updateSettingsBulk = vi.fn(async (_userId: string, _setting: string, entries: Array<{ card_id: number }>) =>
      entries.map((entry) => entry.card_id));
    const updates = [
      { card_id: 1, value: true },
      { card_id: 2, value: true },
      { card_id: 3, value: false }
    ];

    const result = await applyBulkCardSettings('user-1', 'locked', updates, {
      userCardRepository: {
        updateSettingsBulk,
        updateVisibility: vi.fn(),
        setFavorite: vi.fn(),
        setLocked: vi.fn()
      },
      marketRepository: { findPendingCardIdsByUser: vi.fn(async () => [2]) }
    } as any);

    expect(updateSettingsBulk).toHaveBeenCalledWith('user-1', 'locked', [updates[0], updates[2]]);
    expect(result).toEqual({ succeededIds: [1, 3], failedIds: [2] });
  });

  it('잠금 시 마켓 대기 카드를 건너뛰고 해제와 소유권 검증은 기존 repository 결과를 따른다', async () => {
    const setLocked = vi.fn(async (_userId: string, cardId: number) => cardId !== 4);
    const findPendingCardIdsByUser = vi.fn(async () => [2, 3]);

    const result = await applyBulkCardSettings('user-1', 'locked', [
      { card_id: 1, value: true },
      { card_id: 2, value: true },
      { card_id: 3, value: false },
      { card_id: 4, value: false }
    ], {
      userCardRepository: {
        setLocked,
        setFavorite: vi.fn(),
        updateVisibility: vi.fn()
      },
      marketRepository: { findPendingCardIdsByUser }
    } as any);

    expect(findPendingCardIdsByUser).toHaveBeenCalledOnce();
    expect(setLocked).toHaveBeenCalledTimes(3);
    expect(setLocked).not.toHaveBeenCalledWith('user-1', 2, true);
    expect(setLocked).toHaveBeenCalledWith('user-1', 3, false);
    expect(result).toEqual({ succeededIds: [1, 3], failedIds: [2, 4] });
  });

  it('즐겨찾기 MAX+1 정책의 순서를 보존하도록 동시 실행하지 않는다', async () => {
    let active = 0;
    let maxActive = 0;
    const callOrder: number[] = [];
    const setFavorite = vi.fn(async (_userId: string, cardId: number, value: boolean) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      callOrder.push(cardId);
      active -= 1;
      return value || cardId !== 2;
    });

    const result = await applyBulkCardSettings('user-1', 'favorite', [
      { card_id: 1, value: true },
      { card_id: 2, value: false },
      { card_id: 3, value: true }
    ], {
      userCardRepository: {
        setFavorite,
        setLocked: vi.fn(),
        updateVisibility: vi.fn()
      },
      marketRepository: { findPendingCardIdsByUser: vi.fn() }
    } as any);

    expect(maxActive).toBe(1);
    expect(callOrder).toEqual([1, 2, 3]);
    expect(result).toEqual({ succeededIds: [1, 3], failedIds: [2] });
  });

  it('항목 하나의 저장 실패가 나머지 visibility 변경을 중단시키지 않는다', async () => {
    const updateVisibility = vi.fn(async (_userId: string, cardId: number) => {
      if (cardId === 2) throw new Error('temporary database error');
      return cardId !== 3;
    });

    const result = await applyBulkCardSettings('user-1', 'hidden', [
      { card_id: 1, value: true },
      { card_id: 2, value: false },
      { card_id: 3, value: true }
    ], {
      userCardRepository: {
        updateVisibility,
        setFavorite: vi.fn(),
        setLocked: vi.fn()
      },
      marketRepository: { findPendingCardIdsByUser: vi.fn() }
    } as any);

    expect(result).toEqual({ succeededIds: [1], failedIds: [2, 3] });
    expect(updateVisibility).toHaveBeenCalledTimes(3);
  });
});

describe('updateMyCardSettingsBulk controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controllerMocks.marketRepository.findPendingCardIdsByUser.mockResolvedValue([]);
    controllerMocks.userCardRepository.updateVisibility.mockResolvedValue(true);
    controllerMocks.userCardRepository.setFavorite.mockResolvedValue(true);
    controllerMocks.userCardRepository.setLocked.mockResolvedValue(true);
    controllerMocks.recordAchievementEvent.mockResolvedValue(undefined);
  });

  it('로그인과 요청 크기, 중복 ID, boolean 값을 검증한다', async () => {
    const unauthorized = createResponse();
    await updateMyCardSettingsBulk({ body: {} } as any, unauthorized);
    expect(unauthorized.statusCode).toBe(401);

    for (const body of [
      { setting: 'unknown', updates: [{ card_id: 1, value: true }] },
      { setting: 'hidden', updates: [] },
      { setting: 'hidden', updates: Array.from({ length: 201 }, (_, index) => ({ card_id: index + 1, value: true })) },
      { setting: 'locked', updates: [{ card_id: 1, value: true }, { card_id: 1, value: false }] },
      { setting: 'favorite', updates: [{ card_id: 1, value: 1 }] }
    ]) {
      const response = createResponse();
      await updateMyCardSettingsBulk({ user: { id: 'user-1' }, body } as any, response);
      expect(response.statusCode).toBe(400);
    }
    expect(controllerMocks.userCardRepository.updateVisibility).not.toHaveBeenCalled();
  });

  it('혼합 hidden 값을 적용하고 성공 건수 하나로 achievement와 ranking refresh를 기록한다', async () => {
    controllerMocks.userCardRepository.updateVisibility.mockImplementation(async (_userId: string, cardId: number) => cardId !== 2);
    const response = createResponse();

    await updateMyCardSettingsBulk({
      user: { id: 'user-1' },
      body: {
        setting: 'hidden',
        updates: [
          { card_id: 1, value: true },
          { card_id: 2, value: false },
          { card_id: 3, value: false }
        ]
      }
    } as any, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ succeededIds: [1, 3], failedIds: [2] });
    expect(controllerMocks.userCardRepository.updateVisibility.mock.calls).toEqual([
      ['user-1', 1, true],
      ['user-1', 2, false],
      ['user-1', 3, false]
    ]);
    expect(controllerMocks.scheduleUserRankingRefresh).toHaveBeenCalledWith('card_visibility_bulk');
    expect(controllerMocks.recordAchievementEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      eventType: 'card.visibility.update',
      value: 2,
      metadata: {
        setting: 'hidden',
        enabled_count: 1,
        disabled_count: 1
      }
    }));
  });

  it('모두 실패하면 성공 이벤트나 랭킹 갱신을 만들지 않는다', async () => {
    controllerMocks.userCardRepository.setFavorite.mockResolvedValue(false);
    const response = createResponse();

    await updateMyCardSettingsBulk({
      user: { id: 'user-1' },
      body: { setting: 'favorite', updates: [{ card_id: 999, value: true }] }
    } as any, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ succeededIds: [], failedIds: [999] });
    expect(controllerMocks.recordAchievementEvent).not.toHaveBeenCalled();
    expect(controllerMocks.scheduleUserRankingRefresh).not.toHaveBeenCalled();
  });
});
