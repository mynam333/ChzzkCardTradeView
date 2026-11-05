import { describe, expect, it, vi } from 'vitest';
import { createUserSessionEnrichment } from '../services/userSessionEnrichment';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('background session enrichment', () => {
  it('returns immediately, coalesces a user, and bounds external synchronization concurrency', async () => {
    const releases: Array<() => void> = [];
    const sync = vi.fn(() => new Promise<void>(resolve => { releases.push(resolve); }));
    const schedule = createUserSessionEnrichment(sync, vi.fn());
    expect(schedule('a', {})).toBeUndefined();
    schedule('a', {});
    schedule('b', {});
    schedule('c', {});
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    releases[0]();
    await flush();
    expect(sync).toHaveBeenCalledTimes(3);
    releases[1]();
    releases[2]();
    await flush();
    schedule('a', {});
    await flush();
    expect(sync).toHaveBeenCalledTimes(4);
    releases[3]();
    await flush();
  });

  it('releases the queue after failure and reports it without rejecting the session response', async () => {
    const error = new Error('external service unavailable');
    const sync = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const onError = vi.fn();
    const schedule = createUserSessionEnrichment(sync, onError, 1);
    schedule('a', {});
    schedule('b', {});
    await flush();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });
});
