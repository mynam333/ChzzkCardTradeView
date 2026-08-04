export const CROP_DETECTIVE_RECOVERY_POLICY = Object.freeze({
  primaryRequestTimeoutMs: 13_000,
  blobDecodeTimeoutMs: 3_000,
  activeSessionRecoveryTimeoutMs: 5_000,
  backendNegativeCacheRetryDelayMs: 1_100,
  maxAutomaticSessionRefreshes: 1
});

export type AbortableTaskResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'timed-out' }
  | { status: 'failed'; error: unknown };

export function canAutomaticallyRefreshCropDetectiveSession(completedRefreshes: number): boolean {
  return Number.isInteger(completedRefreshes)
    && completedRefreshes >= 0
    && completedRefreshes < CROP_DETECTIVE_RECOVERY_POLICY.maxAutomaticSessionRefreshes;
}

export function waitForAbortableDelay(signal: AbortSignal, delayMs: number): Promise<boolean> {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    return Promise.reject(new RangeError('delayMs must be a finite, non-negative number'));
  }
  if (signal.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (elapsed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', handleAbort);
      resolve(elapsed);
    };
    const handleAbort = () => finish(false);
    const timeoutId = setTimeout(() => finish(true), delayMs);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export async function runAbortableTaskWithTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<AbortableTaskResult<T>> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError('timeoutMs must be a finite, non-negative number');
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const taskResult = Promise.resolve()
    .then(() => task(controller.signal))
    .then(
      (value): AbortableTaskResult<T> => ({ status: 'completed', value }),
      (error: unknown): AbortableTaskResult<T> => ({ status: 'failed', error })
    );

  const timeoutResult = new Promise<AbortableTaskResult<T>>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve({ status: 'timed-out' });
    }, timeoutMs);
  });

  const result = await Promise.race([taskResult, timeoutResult]);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  return result;
}
