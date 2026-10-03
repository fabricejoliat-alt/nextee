/** Camp occurrences already counted through a group or competition must not be counted twice. */
export function additionalManagerCampCounts(events: Array<{ id: string; group_id: string | null; event_type: string | null; starts_at: string; status: string | null }>, groupIds: string[], now: string) {
  const groups = new Set(groupIds);
  let planned = 0, past = 0;
  for (const event of new Map(events.map((row) => [row.id, row])).values()) {
    if (event.status !== "scheduled" || event.event_type === "competition" || (event.group_id && groups.has(event.group_id))) continue;
    if (Date.parse(event.starts_at) >= Date.parse(now)) planned++;
    else past++;
  }
  return { planned, past };
}
