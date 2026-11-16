import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const brevoAttributes = {
  ACTIVITEE_FIRSTNAME: "text", ACTIVITEE_LASTNAME: "text", ACTIVITEE_ACTIVE: "boolean",
  ACTIVITEE_ROLES: "text", ACTIVITEE_CLUBS: "text", ACTIVITEE_CLUB_IDS: "text",
  ACTIVITEE_PLAYER_CLUBS: "text", ACTIVITEE_PARENT_CLUBS: "text",
  ACTIVITEE_COACH_CLUBS: "text", ACTIVITEE_MANAGER_CLUBS: "text",
} as const;
export type ContactAttributes = Record<string, string | boolean>;
type SyncRow = { email: string; user_ids: string[]; attributes: ContactAttributes; desired_hash: string; attempts: number };

export function brevoContactConfig(env: Record<string, string | undefined> = process.env) {
  const listId = Number(env.BREVO_CONTACTS_LIST_ID);
  return { enabled: env.BREVO_CONTACTS_SYNC_ENABLED === "true", apiKeyConfigured: Boolean(env.BREVO_API_KEY),
    listId: Number.isSafeInteger(listId) && listId > 0 ? listId : null,
    webhookConfigured: Boolean(env.BREVO_CONTACTS_WEBHOOK_SECRET) };
}
export function secretMatches(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function contactEmailHash(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
export function suppressionEvent(value: unknown): { email: string; reason: "unsubscribe" | "spam" | "deleted" } | null {
  if (!value || typeof value !== "object") return null;
  const { email: raw, event } = value as Record<string, unknown>;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const reason = event === "unsubscribe" || event === "unsubscribed" ? "unsubscribe"
    : event === "spam" ? "spam" : event === "contact_deleted" || event === "contactDeleted" ? "deleted" : null;
  return reason ? { email, reason } : null;
}

export class BrevoContactError extends Error {
  status: number;
  retryAfter: number;
  constructor(status: number, retryAfter = 0) {
    // Do not retain the Brevo response body: it may contain personal data.
    super(`BREVO_HTTP_${status}`); this.status = status; this.retryAfter = retryAfter;
  }
}
export function retryDelay(attempts: number, retryAfter = 0) {
  return Math.min(86400, Math.max(60 * 2 ** Math.min(attempts, 10), retryAfter));
}

export function brevoContactClient(apiKey: string, listId: number, transport: typeof fetch = fetch) {
  async function request(path: string, method = "GET", body?: object) {
    let response: Response;
    try {
      response = await transport(`https://api.brevo.com/v3${path}`, { method,
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(6000), cache: "no-store" });
    } catch { throw new Error("BREVO_NETWORK_ERROR"); }
    if (!response.ok) {
      const raw = response.headers.get("retry-after") ?? "0";
      const seconds = /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
      throw new BrevoContactError(response.status, Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
    }
    return response.status === 204 ? {} : await response.json();
  }
  async function prepare() {
    await request(`/contacts/lists/${listId}`); // Never create an unintended list.
    const data = await request("/contacts/attributes") as { attributes: { name: string; type: string; category: string }[] };
    if (!Array.isArray(data.attributes)) throw new Error("BREVO_ATTRIBUTES_INVALID");
    for (const [name, type] of Object.entries(brevoAttributes)) {
      const existing = data.attributes.find(a => a.name === name);
      if (existing && (existing.type !== type || existing.category !== "normal")) throw new Error(`BREVO_ATTRIBUTE_TYPE_${name}`);
    }
    for (const [name, type] of Object.entries(brevoAttributes)) {
      if (!data.attributes.some(a => a.name === name)) await request(`/contacts/attributes/normal/${name}`, "POST", { type });
    }
  }
  async function sync(email: string, attributes: ContactAttributes, suppressed: boolean) {
    const path = `/contacts/${encodeURIComponent(email)}`;
    let existing: { emailBlacklisted?: boolean; listIds?: number[] } | null;
    try { existing = await request(path); }
    catch (cause) { if (cause instanceof BrevoContactError && cause.status === 404) existing = null; else throw cause; }
    const active = attributes.ACTIVITEE_ACTIVE === true;
    const blacklisted = existing?.emailBlacklisted === true;
    if (!active) {
      if (!existing) return { blacklisted };
      const cleared = Object.fromEntries(Object.keys(brevoAttributes).map(key => [key, key === "ACTIVITEE_ACTIVE" ? false : ""]));
      await request(path, "PUT", { attributes: cleared, unlinkListIds: [listId] });
      return { blacklisted };
    }
    // Never rename a Brevo email: doing so can reset its blocklisting. Never
    // send emailBlacklisted=false, SMS preferences, consent or forceMerge.
    if (!existing && suppressed) return { blacklisted };
    if (existing) {
      const membership = suppressed || blacklisted ? { unlinkListIds: [listId] }
        : existing.listIds?.includes(listId) ? {} : { listIds: [listId] };
      await request(path, "PUT", { attributes, ...membership });
    } else {
      // A competing create fails safely and is retried; no implicit merge.
      await request("/contacts", "POST", { email, attributes, listIds: [listId], updateEnabled: false });
    }
    return { blacklisted };
  }
  return { prepare, sync };
}

function databaseError(error: unknown) { if (error) throw new Error("BREVO_SYNC_DATABASE_ERROR"); }
function safeError(cause: unknown) {
  return cause instanceof Error && /^BREVO_[A-Z0-9_]+$/.test(cause.message) ? cause.message : "BREVO_SYNC_FAILED";
}

export async function runBrevoContactSync(db: SupabaseClient, transport: typeof fetch = fetch) {
  const config = brevoContactConfig();
  if (!config.enabled) return { status: "disabled", processed: 0, failed: 0 };
  if (!config.apiKeyConfigured || !config.listId || !config.webhookConfigured) throw new Error("BREVO_SYNC_CONFIGURATION_MISSING");
  const token = randomUUID(), started = Date.now();
  const lease = await db.rpc("prepare_brevo_contact_sync", { p_token: token, p_list_id: config.listId });
  databaseError(lease.error);
  if (!lease.data) return { status: "busy", processed: 0, failed: 0 };
  let runError: string | null = null, cooldownUntil: string | null = null;
  let processed = 0, failed = 0;
  try {
    const client = brevoContactClient(process.env.BREVO_API_KEY!, config.listId, transport);
    await client.prepare();
    const due = await db.rpc("due_brevo_contact_sync", { p_token: token, p_limit: 25 });
    databaseError(due.error);
    for (const row of (due.data ?? []) as SyncRow[]) {
      if (Date.now() - started > 80000) break;
      try {
        const suppressed = await db.from("brevo_contact_suppressions").select("email_hash")
          .or(`email_hash.eq.${contactEmailHash(row.email)},user_ids.ov.{${row.user_ids.join(",")}}`).limit(1);
        databaseError(suppressed.error);
        const outcome = await client.sync(row.email, row.attributes, Boolean(suppressed.data?.length));
        if (outcome.blacklisted) {
          const recorded = await db.rpc("suppress_brevo_contact", { p_email: row.email,
            p_hash: contactEmailHash(row.email), p_reason: "unsubscribe" });
          databaseError(recorded.error);
        }
        const saved = row.attributes.ACTIVITEE_ACTIVE === false
          ? await db.from("brevo_contact_sync_state").delete().eq("email", row.email).eq("desired_hash", row.desired_hash)
          : await db.from("brevo_contact_sync_state").update({ synced_hash: row.desired_hash, last_synced_at: new Date().toISOString(),
            attempts: 0, last_error: null }).eq("email", row.email).eq("desired_hash", row.desired_hash);
        databaseError(saved.error);
        processed++;
      } catch (cause) {
        failed++; runError = safeError(cause);
        const delay = retryDelay(row.attempts, cause instanceof BrevoContactError ? cause.retryAfter : 0);
        if (cause instanceof BrevoContactError && cause.status === 429) cooldownUntil = new Date(Date.now() + delay * 1000).toISOString();
        const saved = await db.from("brevo_contact_sync_state").update({ attempts: row.attempts + 1,
          last_error: runError, next_attempt_at: new Date(Date.now() + delay * 1000).toISOString() })
          .eq("email", row.email).eq("desired_hash", row.desired_hash);
        databaseError(saved.error);
        if (cause instanceof BrevoContactError && [401, 403, 429].includes(cause.status)) break;
      }
    }
    return { status: failed ? "partial" : "ok", processed, failed };
  } catch (cause) {
    runError = safeError(cause);
    if (cause instanceof BrevoContactError && cause.status === 429) cooldownUntil = new Date(Date.now() + retryDelay(0, cause.retryAfter) * 1000).toISOString();
    throw new Error(runError);
  }
  finally {
    const released = await db.from("brevo_contact_sync_control").update({ lease_token: null, lease_until: null,
      last_finished_at: new Date().toISOString(), last_error: runError, cooldown_until: cooldownUntil }).eq("singleton", true).eq("lease_token", token);
    databaseError(released.error);
  }
}
