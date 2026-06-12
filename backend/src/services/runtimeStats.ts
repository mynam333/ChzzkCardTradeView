import { getNotificationStreamStats } from './notificationStream';
import { getRealtimeStreamStats } from './realtimeStream';
import { getPlayControllerStats } from '../controllers/playController';
import { getSoftBanStats } from '../middlewares/softBan';
import { isLiveWorkerProcess } from './processRole';
import { getMysqlQueryStats } from './mysqlDb';

let chatStatsProvider: (() => any) | null = null;

const getChatStats = () => {
  if (!isLiveWorkerProcess()) {
    return {
      connections: 0,
      desired: 0,
      reconnectTimers: 0,
      backedOff: 0,
      pendingChatChannels: 0,
      pendingChatTotal: 0,
      isFlushing: false,
      disabled: true
    };
  }

  if (!chatStatsProvider) {
    const { chatManager } = require('./chatManager') as typeof import('./chatManager');
    chatStatsProvider = () => chatManager.getStats();
  }

  return chatStatsProvider();
};

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
    chat: getChatStats(),
    caches: {
      play: getPlayControllerStats()
    },
    db: {
      mysql: getMysqlQueryStats()
    },
    protection: {
      softBan: getSoftBanStats()
    }
  };
};
