import cron from 'node-cron';
import { settleExpiredAuctions } from '../controllers/marketController';
import { acquireSchedulerLock } from '../services/schedulerLock';

let isSettling = false;
const MARKET_SCHEDULER_LOCK_TTL_MS = Math.max(10_000, Number(process.env.MARKET_SCHEDULER_LOCK_TTL_MS || 55_000));

const runMarketSettlementOnce = async (reason: 'startup' | 'cron') => {
  if (isSettling) return;
  isSettling = true;
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireSchedulerLock('scheduler:market_settlement', MARKET_SCHEDULER_LOCK_TTL_MS);
    if (!releaseLock) return;
    await settleExpiredAuctions();
  } catch (err: any) {
    console.error(`[MarketScheduler] 마켓 예약 정리 실패(${reason}):`, err?.message || err);
  } finally {
    if (releaseLock) {
      await releaseLock().catch(() => undefined);
    }
    isSettling = false;
  }
};

export const startMarketSettlementScheduler = () => {
  console.log('[MarketScheduler] 오픈마켓 만료 경매/오래된 고정가 매물 정리 스케줄러가 구동되었습니다. (1분 간격)');
  void runMarketSettlementOnce('startup');
  cron.schedule('* * * * *', () => {
    void runMarketSettlementOnce('cron');
  });
};
