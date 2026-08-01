import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queueEnv = vi.hoisted(() => {
  const keys = [
    'LINK_PREVIEW_CONCURRENCY',
    'LINK_PREVIEW_QUEUE_MAX_PENDING',
    'LINK_PREVIEW_QUEUE_MAX_PENDING_PER_SENDER',
    'LINK_PREVIEW_QUEUE_JOB_TTL_MS'
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.LINK_PREVIEW_CONCURRENCY = '1';
  process.env.LINK_PREVIEW_QUEUE_MAX_PENDING = '2';
  process.env.LINK_PREVIEW_QUEUE_MAX_PENDING_PER_SENDER = '1';
  process.env.LINK_PREVIEW_QUEUE_JOB_TTL_MS = '1000';
  return { keys, previous };
});

const mocks = vi.hoisted(() => ({
  extractFirstUrl: vi.fn((body: string) => body.includes('https://') ? 'https://example.com' : null),
  getLinkPreviewForText: vi.fn()
}));

vi.mock('../services/db', () => ({
  getDbMode: () => 'MYSQL',
  getMysqlDb: vi.fn(),
  getSqliteDb: vi.fn(),
  getSupabaseClient: vi.fn()
}));

vi.mock('../repositories', () => ({
  notificationRepository: { create: vi.fn() }
}));

vi.mock('../services/imageService', () => ({
  deleteLocalUploadByUrl: vi.fn(),
  formatUploadUrl: (url: string | null | undefined) => url || null
}));

vi.mock('../services/linkPreviewService', () => ({
  extractFirstUrl: mocks.extractFirstUrl,
  getLinkPreviewForText: mocks.getLinkPreviewForText,
  sanitizeChatLinkPreviewForDelivery: (preview: any) => (
    preview?.kind === 'link' ? { ...preview, image_url: null } : preview
  )
}));

import { enqueueLinkPreviewForMessage } from '../services/friendChatService';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('friend chat link preview queue limits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.useRealTimers();
    for (const key of queueEnv.keys) {
      const previous = queueEnv.previous[key];
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  });

  it('전체·발신자 한도를 지키고 만료된 대기 작업의 계수를 반환한다', async () => {
    const firstPreview = deferred<null>();
    mocks.getLinkPreviewForText
      .mockImplementationOnce(() => firstPreview.promise)
      .mockResolvedValue(null);

    expect(enqueueLinkPreviewForMessage(7, 101, 'sender-a', 'https://example.com/a')).toBe(true);
    expect(enqueueLinkPreviewForMessage(7, 101, 'sender-a', 'https://example.com/a')).toBe(false);
    expect(enqueueLinkPreviewForMessage(7, 102, 'sender-a', 'https://example.com/b')).toBe(false);
    expect(enqueueLinkPreviewForMessage(7, 103, 'sender-b', 'https://example.com/c')).toBe(true);
    expect(enqueueLinkPreviewForMessage(7, 104, 'sender-c', 'https://example.com/d')).toBe(false);

    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getLinkPreviewForText).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_001);
    // 첫 외부 조회가 아직 끝나지 않았어도 대기 작업 TTL은 독립적으로 계수를 반환합니다.
    expect(enqueueLinkPreviewForMessage(7, 105, 'sender-b', 'https://example.com/e')).toBe(true);
    firstPreview.resolve(null);
    await vi.runAllTimersAsync();

    // 기존 sender-b 작업은 외부 조회 없이 버려지고 새 작업만 실행됩니다.
    expect(mocks.getLinkPreviewForText).toHaveBeenCalledTimes(2);
  });
});
