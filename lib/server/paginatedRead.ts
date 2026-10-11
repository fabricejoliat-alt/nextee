type ReadResult = { data: unknown[] | null; error: { message: string } | null };

/** Stable ordering is supplied by the caller; do not truncate at PostgREST's row limit. */
export async function readAllRows<T>(query: (from: number, to: number) => PromiseLike<ReadResult>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export async function readRelatedRows<T>(ids: string[], query: (ids: string[], from: number, to: number) => PromiseLike<ReadResult>, maxConcurrentBatches = 1) {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  const concurrency = Math.max(1, Math.min(4, Math.floor(maxConcurrentBatches) || 1));
  for (let offset = 0; offset < unique.length; offset += 100 * concurrency) {
    const batches = Array.from({ length: Math.min(concurrency, Math.ceil((unique.length - offset) / 100)) }, (_, index) => unique.slice(offset + index * 100, offset + (index + 1) * 100));
    const results = await Promise.all(batches.map(batch => readAllRows<T>((from, to) => query(batch, from, to))));
    for (const result of results) rows.push(...result);
  }
  return rows;
}
