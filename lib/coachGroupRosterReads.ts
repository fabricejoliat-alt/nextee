/** Keep each roster read below the API deadline. Group RLS includes the group's
 * legal and organization checks, which otherwise repeat for every roster row
 * across all groups in one large query. All reads still use the caller's RLS. */
export async function readCoachGroupRosters<T>(
  groupIds: readonly string[],
  readGroup: (groupId: string) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const ids = [...new Set(groupIds)];
  const data: T[] = [];
  // Bound concurrency so a coach with many groups does not flood the database.
  for (let offset = 0; offset < ids.length; offset += 3) {
    const results = await Promise.all(ids.slice(offset, offset + 3).map((id) => readGroup(id)));
    for (const result of results) {
      if (result.error) return { data: [], error: result.error };
      data.push(...(result.data ?? []));
    }
  }
  return { data, error: null };
}
