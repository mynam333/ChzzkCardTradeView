import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAll: vi.fn(),
  bulkApplyScheduleResults: vi.fn(),
  bulkRecordValueHistory: vi.fn(),
  pruneValueHistory: vi.fn(),
  fetchLiveStatus: vi.fn(),
  fetchChannelProfile: vi.fn(),
  acquireSchedulerLock: vi.fn(),
  publishRealtimeEvent: vi.fn(),
  clearLiveStatusCache: vi.fn(),
  clearStreamerRankingCaches: vi.fn(),
  scheduleUserRankingRefresh: vi.fn(),
  chatConnect: vi.fn(),
  chatDisconnect: vi.fn(),
  settleStreamerCardDeletion: vi.fn()
}));

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../repositories', () => ({
  streamerRepository: {
    findAll: mocks.findAll,
    bulkApplyScheduleResults: mocks.bulkApplyScheduleResults,
    bulkRecordValueHistory: mocks.bulkRecordValueHistory,
    pruneValueHistory: mocks.pruneValueHistory,
    delete: vi.fn()
  },
  userCardRepository: { findByChannel: vi.fn() }
}));
vi.mock('../services/chzzkService', () => ({
  fetchChzzkLiveStatus: mocks.fetchLiveStatus,
  fetchChzzkChannelProfile: mocks.fetchChannelProfile,
  getValidUserAccessToken: vi.fn()
}));
vi.mock('../services/chatManager', () => ({
  chatManager: {
    connect: mocks.chatConnect,
    disconnect: mocks.chatDisconnect,
    isConnected: vi.fn(() => true)
  }
}));
vi.mock('../services/schedulerLock', () => ({ acquireSchedulerLock: mocks.acquireSchedulerLock }));
vi.mock('../services/realtimeStream', () => ({ publishRealtimeEvent: mocks.publishRealtimeEvent }));
vi.mock('../controllers/playController', () => ({
  clearStreamerLiveStatusCache: mocks.clearLiveStatusCache,
  clearStreamerRankingCaches: mocks.clearStreamerRankingCaches,
  scheduleUserRankingRefresh: mocks.scheduleUserRankingRefresh
}));
vi.mock('../controllers/pushController', () => ({ sendPushToUser: vi.fn() }));
vi.mock('../services/cardDeletionCompensation', () => ({
  formatCardDeletionCompensationReward: vi.fn(),
  formatCardDeletionCompensationSummary: vi.fn()
}));
vi.mock('../services/cardDeletionSettlement', () => ({
  settleStreamerCardDeletion: mocks.settleStreamerCardDeletion
}));
vi.mock('../services/notificationDelivery', () => ({ createRealtimeNotification: vi.fn() }));

import { syncAllStreamersLiveStatus } from '../cron/streamerScheduler';

describe('streamerScheduler live-status probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireSchedulerLock.mockResolvedValue(async () => undefined);
    mocks.bulkApplyScheduleResults.mockResolvedValue(undefined);
    mocks.bulkRecordValueHistory.mockResolvedValue(undefined);
    mocks.pruneValueHistory.mockResolvedValue(undefined);
    mocks.settleStreamerCardDeletion.mockResolvedValue({
      already_settled: false,
      draw_cost: 10_000,
      affected_users: 0,
      cards_removed: 0,
      total_point_refunded: 0,
      total_free_draw_tickets_granted: 0,
      high_value_cards_refunded: 0,
      ticket_compensated_cards: 0,
      cancelled_trades: 0,
      cancelled_listings: 0,
      refunded_market_bid_points: 0,
      cancelled_trade_participant_ids: [],
      market_bid_refunds: [],
      users: []
    });
  });

  it('경량 probe에서 OPEN인 오프라인 채널을 같은 주기 전체 프로필 폴링으로 승격한다', async () => {
    const streamer = {
      channel_id: 'full-zero', // 해시: mod 10 = 6, mod 2 = 0 (첫 주기는 probe 대상)
      name: '테스트 스트리머',
      logo_url: 'https://example.com/old.webp',
      custom_image_url: null,
      custom_images: [],
      is_image_banned: false,
      follower_count: 1000,
      activity_score: 0,
      base_value: 1000,
      prev_value: 1000,
      is_active: false,
      chat_count: 0,
      broadcast_minutes: 0,
      broadcast_multiplier: 1
    };
    const liveStatus = {
      openLive: true,
      lastLiveAt: '2026-07-17T00:00:00.000Z',
      chatChannelId: 'chat-live',
      concurrentUserCount: 55
    };
    mocks.findAll.mockResolvedValue([streamer]);
    mocks.fetchLiveStatus.mockResolvedValue(liveStatus);
    mocks.fetchChannelProfile.mockResolvedValue({
      name: '새 스트리머 이름',
      logoUrl: 'https://example.com/new.webp',
      followerCount: 1100,
      ...liveStatus
    });

    await syncAllStreamersLiveStatus();

    expect(mocks.fetchLiveStatus).toHaveBeenCalledWith(streamer.channel_id, true);
    expect(mocks.fetchChannelProfile).toHaveBeenCalledWith(streamer.channel_id, true, liveStatus, true);
    expect(mocks.bulkApplyScheduleResults).toHaveBeenCalledWith([
      expect.objectContaining({
        channel_id: streamer.channel_id,
        is_active: true,
        polled: true,
        follower_count: 1100,
        name: '새 스트리머 이름',
        logo_url: 'https://example.com/new.webp',
        add_broadcast_count: 1
      })
    ]);
    expect(mocks.clearLiveStatusCache).toHaveBeenCalledOnce();
    expect(mocks.publishRealtimeEvent).toHaveBeenCalledWith('ranking', expect.objectContaining({
      live_statuses: [{ channel_id: streamer.channel_id, is_active: true }]
    }));
  });
});
