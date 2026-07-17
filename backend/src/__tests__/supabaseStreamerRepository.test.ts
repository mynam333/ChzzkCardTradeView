import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamerScheduleResult } from '../repositories/interfaces';

const mocks = vi.hoisted(() => ({
  getSupabaseClient: vi.fn()
}));

vi.mock('../services/db', () => ({
  getSupabaseClient: mocks.getSupabaseClient
}));

import { SupabaseStreamerRepository } from '../repositories/supabase/streamer.repository';

const createScheduleResult = (channelId: string): StreamerScheduleResult => ({
  channel_id: channelId,
  prev_value: 100,
  base_value: 110,
  activity_score: 3,
  broadcast_multiplier: 1,
  add_minutes: 0,
  add_broadcast_count: 0,
  consumed_chats: 0,
  polled: false,
  is_active: false,
  follower_count: 0
});

describe('SupabaseStreamerRepository.bulkApplyScheduleResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when any row update in the RPC fallback fails', async () => {
    const rpcError = { message: 'statement timeout' };
    const rowUpdateError = { message: 'row update failed', code: 'PGRST001' };
    const eq = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: rowUpdateError });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const rpc = vi.fn().mockResolvedValue({ error: rpcError });
    mocks.getSupabaseClient.mockReturnValue({ from, rpc });

    const repository = new SupabaseStreamerRepository();
    const results = [createScheduleResult('channel-1'), createScheduleResult('channel-2')];

    await expect(repository.bulkApplyScheduleResults(results)).rejects.toBe(rowUpdateError);
    expect(rpc).toHaveBeenCalledWith('bulk_apply_streamer_schedule', { p_updates: results });
    expect(from).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
    expect(eq).toHaveBeenNthCalledWith(1, 'channel_id', 'channel-1');
    expect(eq).toHaveBeenNthCalledWith(2, 'channel_id', 'channel-2');
  });
});
