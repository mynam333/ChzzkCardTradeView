import { chatManager } from './chatManager';
import { getNotificationStreamStats } from './notificationStream';
import { getRealtimeStreamStats } from './realtimeStream';
import { getPlayControllerStats } from '../controllers/playController';
import { getSoftBanStats } from '../middlewares/softBan';

export const getRuntimeStats = () => {
  const memory = process.memoryUsage();
  return {
    uptime_seconds: Math.round(process.uptime()),
    memory: {
      rss_mb: Math.round(memory.rss / 1024 / 1024),
      heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(memory.heapTotal / 1024 / 1024),
      external_mb: Math.round(memory.external / 1024 / 1024)
    },
    streams: {
      realtime: getRealtimeStreamStats(),
      notifications: getNotificationStreamStats()
    },
    chat: chatManager.getStats(),
    caches: {
      play: getPlayControllerStats()
    },
    protection: {
      softBan: getSoftBanStats()
    }
  };
};
