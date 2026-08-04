import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CROP_DETECTIVE_RECOVERY_POLICY,
  canAutomaticallyRefreshCropDetectiveSession,
  runAbortableTaskWithTimeout,
  waitForAbortableDelay
} from './cropDetectiveRecovery.ts';

test('protected crop recovery policy has bounded stages and one automatic session refresh', () => {
  assert.ok(CROP_DETECTIVE_RECOVERY_POLICY.primaryRequestTimeoutMs > 11_000);
  assert.equal(CROP_DETECTIVE_RECOVERY_POLICY.primaryRequestTimeoutMs, 13_000);
  assert.equal(CROP_DETECTIVE_RECOVERY_POLICY.blobDecodeTimeoutMs, 3_000);
  assert.equal(CROP_DETECTIVE_RECOVERY_POLICY.activeSessionRecoveryTimeoutMs, 5_000);
  assert.ok(CROP_DETECTIVE_RECOVERY_POLICY.backendNegativeCacheRetryDelayMs > 1_000);
  assert.equal(CROP_DETECTIVE_RECOVERY_POLICY.maxAutomaticSessionRefreshes, 1);

  assert.equal(canAutomaticallyRefreshCropDetectiveSession(0), true);
  assert.equal(canAutomaticallyRefreshCropDetectiveSession(1), false);
  assert.equal(canAutomaticallyRefreshCropDetectiveSession(-1), false);
  assert.equal(canAutomaticallyRefreshCropDetectiveSession(0.5), false);
});

test('retry delay waits beyond the backend negative cache and stops on abort', async () => {
  const elapsedController = new AbortController();
  assert.equal(await waitForAbortableDelay(elapsedController.signal, 1), true);

  const abortedController = new AbortController();
  const pending = waitForAbortableDelay(abortedController.signal, 50);
  abortedController.abort();
  assert.equal(await pending, false);
});

test('abortable task returns its value and clears the pending timeout', async () => {
  let taskSignal;
  const result = await runAbortableTaskWithTimeout(async (signal) => {
    taskSignal = signal;
    return 'ready';
  }, 5);

  assert.deepEqual(result, { status: 'completed', value: 'ready' });
  assert.equal(taskSignal?.aborted, false);

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(taskSignal?.aborted, false);
});

test('abortable task aborts and returns a finite timeout result when work never settles', async () => {
  let aborted = false;
  const result = await runAbortableTaskWithTimeout((signal) => {
    signal.addEventListener('abort', () => {
      aborted = true;
    }, { once: true });
    return new Promise(() => {});
  }, 5);

  assert.deepEqual(result, { status: 'timed-out' });
  assert.equal(aborted, true);
});

test('abortable task converts synchronous and asynchronous failures to failed results', async () => {
  const synchronousError = new Error('sync failure');
  const synchronousResult = await runAbortableTaskWithTimeout(() => {
    throw synchronousError;
  }, 20);
  assert.equal(synchronousResult.status, 'failed');
  assert.equal(synchronousResult.error, synchronousError);

  const asynchronousError = new Error('async failure');
  const asynchronousResult = await runAbortableTaskWithTimeout(
    async () => Promise.reject(asynchronousError),
    20
  );
  assert.equal(asynchronousResult.status, 'failed');
  assert.equal(asynchronousResult.error, asynchronousError);
});

test('abortable task rejects invalid timeout configuration', async () => {
  await assert.rejects(
    runAbortableTaskWithTimeout(async () => 'unused', Number.POSITIVE_INFINITY),
    RangeError
  );
  await assert.rejects(
    runAbortableTaskWithTimeout(async () => 'unused', -1),
    RangeError
  );
});
