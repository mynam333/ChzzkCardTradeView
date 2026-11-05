import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchChzzkChannelProfile,
  fetchChzzkLiveStatus,
  fetchChzzkUserProfile,
  refreshChzzkToken,
  isPlaceholderProfileImageUrl
} from '../services/chzzkService';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('session external lookup deadlines', () => {
  it('aborts a stalled user profile body', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init.signal;
      return { ok: true, json: () => new Promise(() => {}) };
    }));
    const request = fetchChzzkUserProfile('owner', 'test-token');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(request).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('preserves the stored image when the external image service fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ code: 200, content: { nickname: 'updated name' } }) })
      .mockResolvedValueOnce({ ok: false, status: 503 }));
    await expect(fetchChzzkUserProfile('owner', 'test-token')).resolves.toEqual({ nickname: 'updated name', profileImageUrl: undefined });
  });

  it('aborts stalled token refresh without clearing tokens as revoked', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('CHZZK_CLIENT_ID', 'test-id');
    vi.stubEnv('CHZZK_CLIENT_SECRET', 'test-secret');
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    }));
    const request = refreshChzzkToken('test-refresh-token');
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(request).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
    vi.unstubAllEnvs();
  });
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
