/** Share concurrent reads only. Results and failures are discarded immediately. */
export function createInFlightRead() {
  const pending = new Map<string, Promise<unknown>>();
  return function readOnce<T>(key: string, read: () => Promise<T>): Promise<T> {
    const existing = pending.get(key);
    if (existing) return existing as Promise<T>;
    const task = Promise.resolve().then(read);
    pending.set(key, task);
    const clear = () => { if (pending.get(key) === task) pending.delete(key); };
    void task.then(clear, clear);
    return task;
  };
}

export const inFlightRead = createInFlightRead();
