import type { Request, Response } from 'express';
import { marketRepository, userCardRepository } from '../repositories';
import { recordAchievementEvent } from '../services/achievementService';
import {
  applyBulkCardSettings,
  MAX_BULK_CARD_SETTINGS_UPDATES,
  type BulkCardSetting,
  type BulkCardSettingUpdate
} from '../services/bulkCardSettingsService';
import { clearUserCardsInFlight, scheduleUserRankingRefresh } from './playController';

const SETTINGS = new Set<BulkCardSetting>(['favorite', 'hidden', 'locked']);

const parseRequest = (body: unknown): { setting: BulkCardSetting; updates: BulkCardSettingUpdate[] } | null => {
  if (!body || typeof body !== 'object') return null;
  const setting = (body as any).setting;
  const updates = (body as any).updates;
  if (!SETTINGS.has(setting) || !Array.isArray(updates) || updates.length < 1 || updates.length > MAX_BULK_CARD_SETTINGS_UPDATES) {
    return null;
  }

  const seen = new Set<number>();
  const normalized: BulkCardSettingUpdate[] = [];
  for (const update of updates) {
    const cardId = update?.card_id;
    if (!Number.isSafeInteger(cardId) || cardId <= 0 || typeof update?.value !== 'boolean' || seen.has(cardId)) {
      return null;
    }
    seen.add(cardId);
    normalized.push({ card_id: cardId, value: update.value });
  }
  return { setting, updates: normalized };
};

const achievementEventType = (setting: BulkCardSetting) => {
  if (setting === 'favorite') return 'card.favorite.update';
  if (setting === 'locked') return 'card.lock.update';
  return 'card.visibility.update';
};

export const updateMyCardSettingsBulk = async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });

  const parsed = parseRequest(req.body);
  if (!parsed) {
    return res.status(400).json({
      error: 'BadRequest',
      message: `설정과 카드 목록을 확인해 주세요. 한 번에 1~${MAX_BULK_CARD_SETTINGS_UPDATES}장까지 변경할 수 있습니다.`
    });
  }

  try {
    clearUserCardsInFlight(userId);
    const result = await applyBulkCardSettings(userId, parsed.setting, parsed.updates, {
      userCardRepository,
      marketRepository
    });
    const succeeded = result.succeededIds.length;

    if (succeeded > 0) {
      if (parsed.setting === 'hidden') scheduleUserRankingRefresh('card_visibility_bulk');
      const succeededSet = new Set(result.succeededIds);
      const succeededUpdates = parsed.updates.filter((update) => succeededSet.has(update.card_id));
      recordAchievementEvent({
        eventKey: `card:${parsed.setting}-bulk:${userId}:${Date.now()}`,
        userId,
        eventType: achievementEventType(parsed.setting),
        sourceType: 'card_bulk',
        sourceId: parsed.setting,
        value: succeeded,
        metadata: {
          setting: parsed.setting,
          enabled_count: succeededUpdates.filter((update) => update.value).length,
          disabled_count: succeededUpdates.filter((update) => !update.value).length
        },
        refreshSnapshots: true
      }).catch(() => undefined);
    }

    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[BulkCardSettingsController] 카드 일괄 설정 실패:', err?.message || err);
    return res.status(500).json({ error: 'InternalServerError', message: '카드 일괄 설정에 실패했습니다.' });
  } finally {
    clearUserCardsInFlight(userId);
  }
};
