import cron from 'node-cron';
import { settleExpiredAuctions } from '../controllers/marketController';

let isSettling = false;

export const startMarketSettlementScheduler = () => {
  cron.schedule('* * * * *', async () => {
    if (isSettling) return;
    isSettling = true;
    try {
      await settleExpiredAuctions();
    } catch (err: any) {
      console.error('[MarketScheduler] 만료 경매 정산 실패:', err?.message || err);
    } finally {
      isSettling = false;
    }
  });
};
