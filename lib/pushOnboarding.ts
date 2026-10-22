export type PushDecision = "accepted" | "declined";
const memory = new Map<string, PushDecision>();
const key = (userId: string) => `activitee:push-choice:v1:${userId}`;

/** The choice belongs to this account on this device, not to its other devices. */
export function readPushDecision(userId: string): PushDecision | null {
  try {
    const value = localStorage.getItem(key(userId));
    if (value === "accepted" || value === "declined") return value;
  } catch { /* Keep the choice in memory when browser storage is unavailable. */ }
  return memory.get(userId) ?? null;
}

export function rememberPushDecision(userId: string, decision: PushDecision) {
  memory.set(userId, decision);
  try { localStorage.setItem(key(userId), decision); } catch { /* In-memory fallback. */ }
}
