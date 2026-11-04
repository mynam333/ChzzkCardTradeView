/** Merge concurrent requests while guaranteeing a fresh pass after changes made during evaluation. */
export const createAchievementEvaluationQueue = (
  evaluate: (userId: string) => Promise<void>,
  concurrency = 2
) => {
  type Work = { userId: string; version: number; promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };
  const pending = new Map<string, Work>();
  const ready: Work[] = [];
  let running = 0;
  const limit = Math.max(1, Math.floor(concurrency));

  const drain = () => {
    while (running < limit && ready.length > 0) {
      const work = ready.shift()!;
      const version = work.version;
      running += 1;
      Promise.resolve().then(() => evaluate(work.userId)).then(() => {
        if (version !== work.version) {
          // Yield to other users before processing changes received during this pass.
          ready.push(work);
        } else {
          pending.delete(work.userId);
          work.resolve();
        }
      }, error => {
        if (version !== work.version) {
          // A failed old pass must not discard events received while it was running.
          ready.push(work);
        } else {
          pending.delete(work.userId);
          work.reject(error);
        }
      }).finally(() => {
        running -= 1;
        drain();
      });
    }
  };

  return (userId: string): Promise<void> => {
    const existing = pending.get(userId);
    if (existing) {
      existing.version += 1;
      return existing.promise;
    }
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const work: Work = { userId, version: 1, promise, resolve, reject };
    pending.set(userId, work);
    ready.push(work);
    queueMicrotask(drain);
    return promise;
  };
};
