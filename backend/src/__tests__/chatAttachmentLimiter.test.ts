import { describe, expect, it } from 'vitest';
import {
  assertChatAttachmentDecodeBudget,
  CHAT_GIF_MAX_PAGES,
  CHAT_IMAGE_MAX_INPUT_PIXELS,
  createChatAttachmentTaskLimiter,
  createChatAttachmentWorkBudget,
  getChatAttachmentSharpOptions
} from '../services/chatAttachmentService';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('chat attachment conversion admission', () => {
  it('shares the pending-job budget across static and GIF queues', async () => {
    const budget = createChatAttachmentWorkBudget(2, 10);
    const staticLimiter = createChatAttachmentTaskLimiter(1, budget);
    const gifLimiter = createChatAttachmentTaskLimiter(1, budget);
    const staticGate = deferred();
    const gifGate = deferred();

    const staticJob = staticLimiter(4, async () => {
      await staticGate.promise;
      return 'static';
    });
    const gifJob = gifLimiter(5, async () => {
      await gifGate.promise;
      return 'gif';
    });

    await expect(staticLimiter(1, async () => 'overflow')).rejects.toMatchObject({
      code: 'ChatAttachmentProcessingOverloaded',
      reason: 'pending_jobs'
    });
    expect(budget.snapshot()).toEqual({ pendingJobs: 2, retainedBytes: 9 });

    staticGate.resolve();
    gifGate.resolve();
    await expect(Promise.all([staticJob, gifJob])).resolves.toEqual(['static', 'gif']);
    expect(budget.snapshot()).toEqual({ pendingJobs: 0, retainedBytes: 0 });
  });

  it('rejects retained bytes above the aggregate budget without allocating buffers', async () => {
    const budget = createChatAttachmentWorkBudget(3, 10);
    const limiter = createChatAttachmentTaskLimiter(2, budget);
    const gate = deferred();
    const admitted = limiter(6, async () => {
      await gate.promise;
      return 'ok';
    });

    await expect(limiter(5, async () => 'overflow')).rejects.toMatchObject({
      code: 'ChatAttachmentProcessingOverloaded',
      reason: 'retained_bytes'
    });
    expect(budget.snapshot()).toEqual({ pendingJobs: 1, retainedBytes: 6 });

    gate.resolve();
    await expect(admitted).resolves.toBe('ok');
    await expect(limiter(10, async () => 'control')).resolves.toBe('control');
    expect(budget.snapshot()).toEqual({ pendingJobs: 0, retainedBytes: 0 });
  });

  it('releases job and byte accounting once when conversion fails', async () => {
    const budget = createChatAttachmentWorkBudget(1, 5);
    const limiter = createChatAttachmentTaskLimiter(1, budget);

    await expect(limiter(5, async () => {
      throw new Error('conversion failed');
    })).rejects.toThrow('conversion failed');
    expect(budget.snapshot()).toEqual({ pendingJobs: 0, retainedBytes: 0 });
    await expect(limiter(5, async () => 'recovered')).resolves.toBe('recovered');
    expect(budget.snapshot()).toEqual({ pendingJobs: 0, retainedBytes: 0 });
  });
});

describe('chat attachment decode budget', () => {
  it('passes a hard pixel limit to every static and animated Sharp decoder', () => {
    expect(CHAT_IMAGE_MAX_INPUT_PIXELS).toBeLessThanOrEqual(64_000_000);
    expect(getChatAttachmentSharpOptions()).toEqual({
      limitInputPixels: CHAT_IMAGE_MAX_INPUT_PIXELS
    });
    expect(getChatAttachmentSharpOptions(true)).toEqual({
      limitInputPixels: CHAT_IMAGE_MAX_INPUT_PIXELS,
      animated: true
    });
  });

  it('rejects static images whose decoded pixel count exceeds the hard budget', () => {
    expect(() => assertChatAttachmentDecodeBudget({
      width: CHAT_IMAGE_MAX_INPUT_PIXELS,
      height: 1
    }, false)).not.toThrow();
    expect(() => assertChatAttachmentDecodeBudget({
      width: CHAT_IMAGE_MAX_INPUT_PIXELS,
      height: 2
    }, false)).toThrow('전체 픽셀 수');
  });

  it('rejects animated images with excessive pages or aggregate decoded pixels', () => {
    expect(CHAT_GIF_MAX_PAGES).toBeLessThanOrEqual(300);
    expect(() => assertChatAttachmentDecodeBudget({
      width: 1,
      height: CHAT_GIF_MAX_PAGES + 1,
      pageHeight: 1,
      pages: CHAT_GIF_MAX_PAGES + 1
    }, true)).toThrow('최대');

    const pages = Math.min(CHAT_GIF_MAX_PAGES, 10);
    const pageHeight = Math.floor(CHAT_IMAGE_MAX_INPUT_PIXELS / pages) + 1;
    expect(() => assertChatAttachmentDecodeBudget({
      width: 1,
      height: pageHeight * pages,
      pageHeight,
      pages
    }, true)).toThrow('전체 픽셀 수');
  });

  it('fails closed when multi-page metadata omits per-page dimensions', () => {
    expect(() => assertChatAttachmentDecodeBudget({
      width: 320,
      height: 640,
      pages: 2
    }, true)).toThrow('프레임 크기 정보');
  });
});
