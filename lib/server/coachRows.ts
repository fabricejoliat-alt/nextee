/** Stable ordering belongs to the query; never silently stop at PostgREST's row cap. */
export async function coachRows<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await query(from, from + 499);
    if (result.error) throw new Error(result.error.message);
    rows.push(...(result.data ?? []) as T[]);
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}
