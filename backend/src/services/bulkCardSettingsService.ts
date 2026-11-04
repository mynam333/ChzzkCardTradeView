import type {
  IMarketRepository,
  IUserCardRepository,
  UserCardBulkSetting,
  UserCardBulkSettingUpdate
} from '../repositories/interfaces';

export const MAX_BULK_CARD_SETTINGS_UPDATES = 200;

export type BulkCardSetting = UserCardBulkSetting;

export interface BulkCardSettingUpdate extends UserCardBulkSettingUpdate {}

export interface BulkCardSettingsResult {
  succeededIds: number[];
  failedIds: number[];
}

interface BulkCardSettingsDependencies {
  userCardRepository: Pick<IUserCardRepository, 'updateVisibility' | 'setFavorite' | 'setLocked' | 'updateSettingsBulk'>;
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
  const eligibleUpdates = updates.filter((update) => !(setting === 'locked' && update.value && pendingMarketCardIds.has(update.card_id)));

  if (dependencies.userCardRepository.updateSettingsBulk) {
    try {
      const updatedIds = new Set(await dependencies.userCardRepository.updateSettingsBulk(userId, setting, eligibleUpdates));
      const succeededIds: number[] = [];
      const failedIds: number[] = [];
      for (const update of updates) {
        (updatedIds.has(update.card_id) ? succeededIds : failedIds).push(update.card_id);
      }
      return { succeededIds, failedIds };
    } catch {
      return { succeededIds: [], failedIds: updates.map((update) => update.card_id) };
    }
  }

  const succeededIds: number[] = [];
  const failedIds = updates
    .filter((update) => setting === 'locked' && update.value && pendingMarketCardIds.has(update.card_id))
    .map((update) => update.card_id);

  for (let offset = 0; offset < eligibleUpdates.length; offset += concurrency) {
    const batch = eligibleUpdates.slice(offset, offset + concurrency);
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
