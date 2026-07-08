import { Request, Response } from 'express';
import { recordSiteInsightEvent } from '../services/siteInsightsService';

export const collectSiteInsightEvent = async (req: Request, res: Response) => {
  try {
    await recordSiteInsightEvent(req.body || {}, req);
  } catch (err: any) {
    console.warn('[AnalyticsController] 사이트 인사이트 이벤트 수집 실패:', err?.message || err);
  }
  return res.status(204).end();
};
