import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/admin';
import { IS_PRODUCTION } from '../config';
import { listAssetEvents, listAssetEventSuspects } from '../services/assetEventLog';

const parseLimit = (value: unknown, fallback = 80, max = 200) =>
  Math.max(1, Math.min(max, Math.floor(Number(value || fallback))));

const parseBeforeId = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeFilter = (value: unknown) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'ALL';
};

const summarizePage = (entries: Awaited<ReturnType<typeof listAssetEvents>>['entries']) => {
  const summary = {
    point_income: 0,
    point_expense: 0,
    cards: 0,
    cosmetics: 0,
    tickets: 0
  };
  for (const entry of entries) {
    if (entry.asset_type === 'point') {
      if ((entry.amount || 0) > 0) summary.point_income += entry.amount || 0;
      if ((entry.amount || 0) < 0) summary.point_expense += Math.abs(entry.amount || 0);
    } else if (entry.asset_type === 'card') {
      summary.cards += Math.max(1, Number(entry.quantity || 1));
    } else if (entry.asset_type === 'cosmetic') {
      summary.cosmetics += Math.max(1, Number(entry.quantity || 1));
    } else if (entry.asset_type === 'ticket') {
      summary.tickets += Math.max(1, Number(entry.quantity || 1));
    }
  }
  return summary;
};

export const getMyAssetEvents = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: '로그인이 필요합니다.' });
  }

  try {
    const { entries, next_before_id } = await listAssetEvents({
      userId,
      limit: parseLimit(req.query.limit, 60, 100),
      beforeId: parseBeforeId(req.query.before_id),
      assetType: normalizeFilter(req.query.asset_type),
      action: normalizeFilter(req.query.action),
      sourceType: normalizeFilter(req.query.source_type)
    });
    return res.status(200).json({
      entries,
      page_summary: summarizePage(entries),
      next_before_id
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '내 기록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const getAdminAssetEvents = async (req: Request, res: Response) => {
  try {
    const { entries, next_before_id } = await listAssetEvents({
      limit: parseLimit(req.query.limit, 80, 200),
      beforeId: parseBeforeId(req.query.before_id),
      assetType: normalizeFilter(req.query.asset_type),
      action: normalizeFilter(req.query.action),
      sourceType: normalizeFilter(req.query.source_type),
      search: typeof req.query.search === 'string' ? req.query.search : ''
    });
    return res.status(200).json({
      entries,
      page_summary: summarizePage(entries),
      next_before_id
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '자산 기록 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};

export const getAdminAssetEventSuspects = async (req: Request, res: Response) => {
  try {
    const days = Math.max(1, Math.min(90, Math.floor(Number(req.query.days || 7))));
    const limit = parseLimit(req.query.limit, 50, 100);
    const result = await listAssetEventSuspects({ days, limit });
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ error: 'InternalServerError', message: '의심 계정 요약 조회 실패', details: IS_PRODUCTION ? undefined : err.message });
  }
};
