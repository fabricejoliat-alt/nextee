/** Per-request timings only: constant phase names, no identities or payloads. */
export function createRequestTiming(clock = () => performance.now()) {
  const started = clock();
  const phases: Array<{ name: string; duration: number }> = [];
  return {
    async measure<T>(name: string, read: () => PromiseLike<T>): Promise<T> {
      const from = clock();
      try { return await read(); }
      finally { phases.push({ name, duration: clock() - from }); }
    },
    headers() {
      return { "Server-Timing": [{ name: "total", duration: clock() - started }, ...phases]
        .map(phase => `${phase.name.replace(/[^a-z0-9_-]/gi, "_")};dur=${Math.max(0, phase.duration).toFixed(1)}`).join(", ") };
    },
  };
}
