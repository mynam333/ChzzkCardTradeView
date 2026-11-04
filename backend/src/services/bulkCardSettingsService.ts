import type { IMarketRepository, IUserCardRepository } from '../repositories/interfaces';

export const MAX_BULK_CARD_SETTINGS_UPDATES = 200;

export type BulkCardSetting = 'favorite' | 'hidden' | 'locked';

export interface BulkCardSettingUpdate {
  card_id: number;
  value: boolean;
}

export interface BulkCardSettingsResult {
  succeededIds: number[];
  failedIds: number[];
}

interface BulkCardSettingsDependencies {
  userCardRepository: Pick<IUserCardRepository, 'updateVisibility' | 'setFavorite' | 'setLocked'>;
  marketRepository: Pick<IMarketRepository, 'findPendingCardIdsByUser'>;
}

const NON_FAVORITE_WRITE_CONCURRENCY = 10;

const applyUpdate = async (
  userId: string,
  setting: BulkCardSetting,
  update: BulkCardSettingUpdate,
  dependencies: BulkCardSettingsDependencies,
  pendingMarketCardIds: ReadonlySet<number>
) => {
  if (setting === 'locked') {
    if (update.value && pendingMarketCardIds.has(update.card_id)) return false;
    return dependencies.userCardRepository.setLocked(userId, update.card_id, update.value);
  }
  if (setting === 'favorite') {
    return dependencies.userCardRepository.setFavorite(userId, update.card_id, update.value);
  }
  return dependencies.userCardRepository.updateVisibility(userId, update.card_id, update.value);
};

/**
 * 단건 카드 설정과 같은 repository 정책을 적용하되 한 HTTP 요청 안에서 제한된 동시성으로 처리합니다.
 * favorite_order는 MAX+1 방식이므로 즐겨찾기는 반드시 입력 순서대로 실행합니다.
 */
export const applyBulkCardSettings = async (
  userId: string,
  setting: BulkCardSetting,
  updates: readonly BulkCardSettingUpdate[],
  dependencies: BulkCardSettingsDependencies
): Promise<BulkCardSettingsResult> => {
  const pendingMarketCardIds = setting === 'locked' && updates.some((update) => update.value)
    ? new Set(await dependencies.marketRepository.findPendingCardIdsByUser(userId))
    : new Set<number>();
  const concurrency = setting === 'favorite' ? 1 : NON_FAVORITE_WRITE_CONCURRENCY;
  const succeededIds: number[] = [];
  const failedIds: number[] = [];

  for (let offset = 0; offset < updates.length; offset += concurrency) {
    const batch = updates.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (update) => {
      try {
        const ok = await applyUpdate(userId, setting, update, dependencies, pendingMarketCardIds);
        return { cardId: update.card_id, ok };
      } catch {
        return { cardId: update.card_id, ok: false };
      }
    }));

    for (const result of results) {
      (result.ok ? succeededIds : failedIds).push(result.cardId);
    }
  }

  return { succeededIds, failedIds };
};
