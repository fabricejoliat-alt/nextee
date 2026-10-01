/** Empty historically means all. A non-kind sentinel represents an explicit
 * empty selection without a schema migration or re-enabling deliveries. */
export const NO_NOTIFICATION_KINDS = "__none__";

export function nextNotificationKinds(current: string[], kind: string, enabled: boolean, available: string[]) {
  if (!available.includes(kind)) return current;
  const selected = new Set(current.length ? current.filter((value) => value !== NO_NOTIFICATION_KINDS) : available);
  if (enabled) selected.add(kind);
  else selected.delete(kind);
  return selected.size ? [...selected] : [NO_NOTIFICATION_KINDS];
}
