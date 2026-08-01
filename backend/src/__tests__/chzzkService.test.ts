import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchChzzkChannelProfile,
  fetchChzzkLiveStatus,
  isPlaceholderProfileImageUrl
} from '../services/chzzkService';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chzzkService profile image validation', () => {
  it('기본 아이콘과 대체 이미지는 프로필 미설정으로 처리한다', () => {
    expect(isPlaceholderProfileImageUrl(null)).toBe(true);
    expect(isPlaceholderProfileImageUrl('')).toBe(true);
    expect(isPlaceholderProfileImageUrl('/icon.png')).toBe(true);
    expect(isPlaceholderProfileImageUrl('https://chikapo.yuaru.com/icon.png')).toBe(true);
    expect(isPlaceholderProfileImageUrl('https://ssl.pstatic.net/static/nng/glive/icon.png?type=f120')).toBe(true);
    expect(isPlaceholderProfileImageUrl('https://api.dicebear.com/10.x/fun-emoji/png?seed=test')).toBe(true);
  });

  it('실제 외부 프로필 이미지 URL은 허용한다', () => {
    expect(isPlaceholderProfileImageUrl('https://example-cdn.invalid/chzzk/profile_123.webp')).toBe(false);
  });
});

describe('chzzkService live status probe', () => {
  it('프로필 API 없이 방송 상태·채팅 채널·시청자 수를 조회한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        content: {
          status: 'OPEN',
          chatChannelId: 'chat-123',
          concurrentUserCount: 321
        }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchChzzkLiveStatus('channel-123', true);

    expect(result).toMatchObject({
      openLive: true,
      chatChannelId: 'chat-123',
      concurrentUserCount: 321,
      lastLiveAt: expect.any(String)
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/polling/v2/channels/channel-123/live-status');
  });

  it('probe 결과를 전체 프로필 조회에서 재사용해 live-status 중복 호출을 막는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 200,
        content: {
          channelName: '라이브 스트리머',
          channelImageUrl: 'https://example.com/profile.webp',
          followerCount: 1234
        }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchChzzkChannelProfile('channel-123', true, {
      openLive: true,
      lastLiveAt: '2026-07-17T00:00:00.000Z',
      chatChannelId: 'chat-123',
      concurrentUserCount: 42
    });

    expect(result).toMatchObject({
      name: '라이브 스트리머',
      followerCount: 1234,
      openLive: true,
      chatChannelId: 'chat-123',
      concurrentUserCount: 42
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain('/service/v1/channels/channel-123');
  });

  it('워커용 엄격 모드에서는 live-status 실패를 OFFLINE으로 오인하지 않고 전파한다', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string) => {
      if (input.includes('/live-status')) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          content: { channelName: '스트리머', followerCount: 100 }
        })
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchChzzkChannelProfile('channel-error', true, undefined, true)
    ).rejects.toThrow('HTTP 상태 코드: 503');
  });

  it('live-status 응답 본문이 멈춰도 제한 시간 뒤 요청을 중단한다', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation(async (_input: string, init?: RequestInit) => {
      requestSignal = init?.signal || undefined;
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
        })
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchChzzkLiveStatus('channel-timeout', true);
    const rejection = expect(request).rejects.toMatchObject({
      name: 'ChzzkApiTimeoutError',
      code: 'CHZZK_API_TIMEOUT'
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('프로필 응답 본문이 멈춰도 제한 시간 뒤 워커용 요청을 중단한다', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation(async (_input: string, init?: RequestInit) => {
      requestSignal = init?.signal || undefined;
      return {
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
        })
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = fetchChzzkChannelProfile('profile-timeout', true, {
      openLive: false,
      lastLiveAt: null,
      chatChannelId: null,
      concurrentUserCount: 0
    }, true);
    const rejection = expect(request).rejects.toMatchObject({
      name: 'ChzzkApiTimeoutError',
      code: 'CHZZK_API_TIMEOUT'
    });

    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });
});
