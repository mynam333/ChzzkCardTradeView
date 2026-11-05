/** External profile/title lookups must never hold up the session used to open pages. */
export const createUserSessionEnrichment = <T>(
  synchronize: (userId: string, value: T) => Promise<void>,
  onError: (error: unknown) => void,
  concurrency = 2
) => {
  const pending = new Set<string>();
  const queued: Array<{ userId: string; value: T }> = [];
  let running = 0;
  const drain = () => {
    while (running < concurrency && queued.length) {
      const { userId, value } = queued.shift()!;
      running++;
      Promise.resolve().then(() => synchronize(userId, value)).catch(onError).finally(() => {
        pending.delete(userId);
        running--;
        drain();
      });
    }
  };
  return (userId: string, value: T) => {
    if (pending.has(userId)) return;
    pending.add(userId);
    queued.push({ userId, value });
    queueMicrotask(drain);
  };
};
