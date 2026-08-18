import { describe, expect, it } from 'vitest';
import {
  hasNewlyLiveOwnedStreamer,
  hasOwnedLiveStreamer
} from './streamerLiveStatus';

describe('streamer live profile refresh selection', () => {
  const owned = [{ channel_id: 'owned-channel', is_active: false }];

  it('보유 카드가 OFFLINE에서 LIVE로 바뀔 때만 프로필 갱신 대상으로 잡는다', () => {
    expect(hasNewlyLiveOwnedStreamer(
      owned,
      { 'owned-channel': true },
      { 'owned-channel': false }
    )).toBe(true);

    expect(hasNewlyLiveOwnedStreamer(
      owned,
      { 'owned-channel': true },
      { 'owned-channel': true }
    )).toBe(false);
  });

  it('보유하지 않은 스트리머의 라이브 전환에는 카드 프로필을 다시 요청하지 않는다', () => {
    expect(hasNewlyLiveOwnedStreamer(
      owned,
      { 'other-channel': true, 'owned-channel': false },
      { 'other-channel': false, 'owned-channel': false }
    )).toBe(false);
  });

  it('보유 카드 중 방송 중인 스트리머가 있는지 판별한다', () => {
    expect(hasOwnedLiveStreamer(owned, { 'owned-channel': true })).toBe(true);
    expect(hasOwnedLiveStreamer(owned, { 'owned-channel': false })).toBe(false);
  });
});
