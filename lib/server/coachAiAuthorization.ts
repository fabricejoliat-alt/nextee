import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canCoachAccessEvent, requireCoachEventPlayer } from "../coachAccess.ts";
import { isCoachTrainingAssistanceEnabled } from "./coachTrainingAssistance.ts";
import { minorRewriteProvider } from "./coachAiRewrite.ts";

export class CoachAiAuthorizationError extends Error {
  readonly code = "ai_authorization_required";
  constructor() { super("AI assistance is unavailable for this player. Manual entry remains available."); }
}

function hasReachedAge(birthDate: unknown, years: number, now: Date) {
  if (typeof birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const parsed = new Date(`${birthDate}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate
    || !Number.isFinite(now.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const anniversary = `${Number(birthDate.slice(0, 4)) + years}${birthDate.slice(4)}`;
  return birthDate <= today && anniversary <= today;
}

// Separate the launch's ZDR threshold from majority/representation rules.
export function isCoachAiAtLeast13(birthDate: unknown, now = new Date()) {
  return hasReachedAge(birthDate, 13, now);
}

export function isCoachAiAdult(birthDate: unknown, now = new Date()) {
  return hasReachedAge(birthDate, 18, now);
}

async function representativeChoice(db: SupabaseClient, documentId: string, versionId: string, playerId: string, clubId: string) {
  const seen = new Set<string>();
  let latest = null;
  // Inspect each representative's latest choice. Another parent's consent must
  // not erase a refusal. Page through history rather than trusting a truncated list.
  for (let offset = 0; offset < 10_000; offset += 500) {
    const page = await db.from("legal_decisions").select("id,actor_id,decision,decided_at,authority_snapshot")
      .eq("document_id", documentId).eq("version_id", versionId).eq("beneficiary_id", playerId)
      .eq("club_id", clubId).eq("source", "user_flow").neq("actor_id", playerId)
      .order("decided_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 499);
    if (page.error) throw new Error("AI authorization unavailable");
    for (const choice of page.data ?? []) {
      if (seen.has(choice.actor_id)) continue;
      seen.add(choice.actor_id);
      if (choice.decision !== "consented") return { data: null, error: null };
      latest ??= choice;
    }
    if ((page.data?.length ?? 0) < 500) return { data: latest, error: null };
  }
  throw new Error("AI authorization unavailable");
}

/** Called only after access to the event is authorized. No global legal flag bypass. */
export async function loadCoachAiPlayerGrant(db: SupabaseClient, clubId: string, playerId: string, usage: "preparation" | "rewrite" = "preparation") {
  const [profile, membership] = await Promise.all([
    db.from("profiles").select("birth_date").eq("id", playerId).maybeSingle(),
    db.from("club_members").select("user_id").eq("user_id", playerId)
      .eq("club_id", clubId).eq("role", "player").eq("is_active", true).limit(1).maybeSingle(),
  ]);
  if (profile.error || membership.error) throw new Error("AI authorization unavailable");
  if (!membership.data) return null;
  const adult = isCoachAiAdult(profile.data?.birth_date);
  const birthDate = profile.data?.birth_date;
  const born = typeof birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? new Date(`${birthDate}T12:00:00Z`) : null;
  if (!born || !Number.isFinite(born.getTime()) || born.toISOString().slice(0, 10) !== birthDate || born > new Date()) return null;
  const requiresZdr = !isCoachAiAtLeast13(birthDate);
  const provider = !adult && usage === "rewrite" ? minorRewriteProvider(requiresZdr) : null;
  if (!adult && !provider) return null;

  const docs = await db.from("legal_documents")
    .select("id,kind,action_kind,required,audience_roles,applicability")
    .eq("scope", "club").eq("club_id", clubId).eq("purpose_key", adult ? "coaching.ai" : "coaching.rewrite").eq("active", true);
  if (docs.error) throw new Error("AI authorization unavailable");
  // An ambiguous or incomplete purpose configuration never silently chooses a document.
  if (docs.data?.length !== 1) return null;
  const doc = docs.data[0];
  if (doc.kind !== "specific_consent" || doc.action_kind !== "consent" || doc.required !== false
    || !doc.audience_roles?.includes("player") || (!adult && !doc.audience_roles?.includes("parent")) || doc.applicability?.status !== "approved"
    || doc.applicability?.rule !== "all_members") return null;
  const [version, state] = await Promise.all([
    db.from("legal_versions").select("id").eq("document_id", doc.id)
      .order("version_number", { ascending: false }).limit(1).maybeSingle(),
    db.from("legal_current_state").select("version_id,decision_id,decision,conflict")
      .eq("document_id", doc.id).eq("beneficiary_id", playerId).eq("club_scope", clubId).maybeSingle(),
  ]);
  if (version.error || state.error) throw new Error("AI authorization unavailable");
  if (!version.data || !state.data || state.data.decision !== "consented"
    || state.data.conflict !== false || state.data.version_id !== version.data.id) return null;
  const decisionQuery = db.from("legal_decisions").select("id,actor_id,decision,decided_at,authority_snapshot")
    .eq("document_id", doc.id).eq("version_id", version.data.id)
    .eq("beneficiary_id", playerId).eq("club_id", clubId).eq("source", "user_flow").eq("id", state.data.decision_id);
  const [decision, matching] = await Promise.all([
    adult ? decisionQuery.maybeSingle() : representativeChoice(db, doc.id, version.data.id, playerId, clubId),
    db.rpc("legal_version_matches_document", { p_document: doc.id, p_version: version.data.id }),
  ]);
  if (decision.error || matching.error) throw new Error("AI authorization unavailable");
  const at = new Date(decision.data?.decided_at ?? "");
  if (matching.data !== true || !decision.data || decision.data.decision !== "consented"
    || !Number.isFinite(at.getTime()) || at.getTime() > Date.now()) return null;
  if (adult) {
    if (decision.data.actor_id !== playerId || !isCoachAiAdult(birthDate, at)
      || decision.data.authority_snapshot?.authority !== "self"
      || decision.data.authority_snapshot?.role !== "player") return null;
  } else {
    if (born > at || isCoachAiAdult(birthDate, at) || decision.data.actor_id === playerId
      || decision.data.authority_snapshot?.authority !== "verified_representative"
      || decision.data.authority_snapshot?.role !== "parent"
      || decision.data.authority_snapshot?.parent_email_confirmed !== true) return null;
    const [authority, childChoice] = await Promise.all([
      db.rpc("legal_actor_allowed", { p_actor: decision.data.actor_id, p_beneficiary: playerId, p_club: clubId, p_role: "parent" }),
      // Conservative product rule: both current choices are needed, in either order.
      db.from("legal_decisions").select("id,decision,version_id,decided_at,authority_snapshot").eq("document_id", doc.id).eq("beneficiary_id", playerId)
        .eq("actor_id", playerId).eq("club_id", clubId).eq("source", "user_flow")
        .order("decided_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (authority.error || childChoice.error) throw new Error("AI authorization unavailable");
    const childAt = new Date(childChoice.data?.decided_at ?? "");
    if (authority.data !== true || childChoice.data?.decision !== "consented" || childChoice.data?.version_id !== version.data.id
      || childChoice.data.authority_snapshot?.authority !== "self" || childChoice.data.authority_snapshot?.role !== "player"
      || !Number.isFinite(childAt.getTime()) || childAt > new Date() || childAt < born) return null;
    return `rewrite-minor:${requiresZdr ? "under13" : "13plus"}:${provider!.project}:${version.data.id}:${decision.data.id}:${childChoice.data.id}`;
  }
  return `${version.data.id}:${decision.data.id}`;
}

/** Revalidate immediately before transport and before returning/reusing its output. */
export async function requireCoachAiGrant(
  db: SupabaseClient, coachId: string, target: { id: string; club_id: string; group_id: string }, playerId: string, expected?: string,
  usage: "preparation" | "rewrite" = "preparation"
) {
  const eventId = target.id;
  const event = await db.from("club_events").select("club_id,group_id,event_type,status")
    .eq("id", eventId).maybeSingle();
  if (event.error) throw new Error("AI authorization unavailable");
  if (!event.data || event.data.event_type !== "training" || event.data.status === "cancelled"
    || event.data.club_id !== target.club_id || event.data.group_id !== target.group_id) {
    throw new CoachAiAuthorizationError();
  }
  const { club_id: clubId, group_id: groupId } = event.data;
  if (!(await canCoachAccessEvent(db, coachId, eventId, groupId, clubId))
    || !(await isCoachTrainingAssistanceEnabled(db, clubId, coachId))) throw new CoachAiAuthorizationError();
  const attendee = await db.from("club_event_attendees").select("player_id")
    .eq("event_id", eventId).eq("player_id", playerId).maybeSingle();
  if (attendee.error) throw new Error("AI authorization unavailable");
  if (!attendee.data) throw new CoachAiAuthorizationError();
  try { await requireCoachEventPlayer(db, eventId, playerId, coachId, clubId); }
  catch { throw new CoachAiAuthorizationError(); }
  const grant = await loadCoachAiPlayerGrant(db, clubId, playerId, usage);
  if (!grant || (expected !== undefined && expected !== grant)) throw new CoachAiAuthorizationError();
  return grant;
}

export function coachAiSourceFingerprint(sourceHash: string, grant: string) {
  return createHash("sha256").update(JSON.stringify(["coaching.ai.v1", sourceHash, grant])).digest("hex");
}
