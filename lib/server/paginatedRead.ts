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

export async function readRelatedRows<T>(ids: string[], query: (ids: string[], from: number, to: number) => PromiseLike<ReadResult>) {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let offset = 0; offset < unique.length; offset += 100) {
    rows.push(...await readAllRows<T>((from, to) => query(unique.slice(offset, offset + 100), from, to)));
  }
  return rows;
}
