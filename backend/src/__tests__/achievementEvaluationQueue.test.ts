import { describe, expect, it, vi } from 'vitest';
import { createAchievementEvaluationQueue } from '../services/achievementEvaluationQueue';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('achievement evaluation queue', () => {
  it('merges a burst before processing starts', async () => {
    const evaluate = vi.fn(async () => undefined);
    const enqueue = createAchievementEvaluationQueue(evaluate);
    await Promise.all(Array.from({ length: 15 }, () => enqueue('owner')));
    expect(evaluate).toHaveBeenCalledExactlyOnceWith('owner');
  });

  it('refreshes changes received during a pass before resolving callers, without overlapping that user', async () => {
    const first = deferred();
    const second = deferred();
    const evaluate = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const enqueue = createAchievementEvaluationQueue(evaluate);
    let resolved = false;
    const initial = enqueue('owner').then(() => { resolved = true; });
    await tick();
    const later = Array.from({ length: 14 }, () => enqueue('owner'));
    expect(evaluate).toHaveBeenCalledTimes(1);
    first.resolve();
    await tick();
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(resolved).toBe(false);
    second.resolve();
    await Promise.all([initial, ...later]);
    expect(resolved).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('bounds concurrency and gives waiting users a turn before repeating one user', async () => {
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let running = 0;
    let peak = 0;
    let call = 0;
    const evaluate = vi.fn(async () => {
      running++;
      peak = Math.max(peak, running);
      await gates[call++].promise;
      running--;
    });
    const enqueue = createAchievementEvaluationQueue(evaluate, 2);
    const work = [enqueue('a'), enqueue('b'), enqueue('c')];
    await tick();
    work.push(enqueue('a'));
    expect(evaluate.mock.calls).toHaveLength(2);
    gates[0].resolve();
    await tick();
    expect(evaluate.mock.calls[2]).toEqual(['c']);
    gates[1].resolve();
    await tick();
    expect(evaluate.mock.calls[3]).toEqual(['a']);
    gates[2].resolve();
    gates[3].resolve();
    await Promise.all(work);
    expect(peak).toBe(2);
  });

  it('releases a failed user and queue capacity so later work can retry', async () => {
    const error = new Error('database temporarily unavailable');
    const evaluate = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const enqueue = createAchievementEvaluationQueue(evaluate, 1);
    const failed = expect(enqueue('a')).rejects.toBe(error);
    const waiting = enqueue('b');
    await failed;
    await Promise.all([waiting, enqueue('a')]);
    expect(evaluate.mock.calls).toEqual([['a'], ['b'], ['a']]);
  });

  it('does not discard new events when the pass already running fails', async () => {
    let fail!: (error: Error) => void;
    const evaluate = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }))
      .mockResolvedValue(undefined);
    const enqueue = createAchievementEvaluationQueue(evaluate, 1);
    const initial = enqueue('a');
    await tick();
    const newer = enqueue('a');
    fail(new Error('old snapshot failed'));
    await Promise.all([initial, newer]);
    expect(evaluate.mock.calls).toEqual([['a'], ['a']]);
  });
});
