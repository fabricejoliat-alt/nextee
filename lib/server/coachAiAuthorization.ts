import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canCoachAccessEvent } from "../coachAccess.ts";
import { isCoachTrainingAssistanceEnabled } from "./coachTrainingAssistance.ts";

export class CoachAiAuthorizationError extends Error {
  readonly code = "ai_authorization_required";
  constructor() { super("AI assistance is unavailable for this player. Manual entry remains available."); }
}

// Temporary product boundary, not a statement about Swiss legal capacity:
// minors stay excluded until provider controls and representative rules are reviewed.
export function isCoachAiAdult(birthDate: unknown, now = new Date()) {
  if (typeof birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const parsed = new Date(`${birthDate}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== birthDate
    || !Number.isFinite(now.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const anniversary = `${Number(birthDate.slice(0, 4)) + 18}${birthDate.slice(4)}`;
  return birthDate <= today && anniversary <= today;
}

/** Called only after access to the event is authorized. No global legal flag bypass. */
export async function loadCoachAiPlayerGrant(db: SupabaseClient, clubId: string, playerId: string) {
  const [profile, membership] = await Promise.all([
    db.from("profiles").select("birth_date").eq("id", playerId).maybeSingle(),
    db.from("club_members").select("user_id").eq("user_id", playerId)
      .eq("club_id", clubId).eq("role", "player").eq("is_active", true).limit(1).maybeSingle(),
  ]);
  if (profile.error || membership.error) throw new Error("AI authorization unavailable");
  if (!membership.data || !isCoachAiAdult(profile.data?.birth_date)) return null;

  const docs = await db.from("legal_documents")
    .select("id,kind,action_kind,required,audience_roles,applicability")
    .eq("scope", "club").eq("club_id", clubId).eq("purpose_key", "coaching.ai").eq("active", true);
  if (docs.error) throw new Error("AI authorization unavailable");
  // An ambiguous or incomplete purpose configuration never silently chooses a document.
  if (docs.data?.length !== 1) return null;
  const doc = docs.data[0];
  if (doc.kind !== "specific_consent" || doc.action_kind !== "consent" || doc.required !== false
    || !doc.audience_roles?.includes("player") || doc.applicability?.status !== "approved"
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
  const [decision, matching] = await Promise.all([
    db.from("legal_decisions").select("id,decided_at,authority_snapshot")
      .eq("id", state.data.decision_id).eq("document_id", doc.id).eq("version_id", version.data.id)
      .eq("actor_id", playerId).eq("beneficiary_id", playerId).eq("club_id", clubId)
      .eq("decision", "consented").eq("source", "user_flow").maybeSingle(),
    db.rpc("legal_version_matches_document", { p_document: doc.id, p_version: version.data.id }),
  ]);
  if (decision.error || matching.error) throw new Error("AI authorization unavailable");
  const at = new Date(decision.data?.decided_at ?? "");
  if (matching.data !== true || !decision.data || at.getTime() > Date.now()
    || !isCoachAiAdult(profile.data.birth_date, at)
    || decision.data.authority_snapshot?.authority !== "self"
    || decision.data.authority_snapshot?.role !== "player") return null;
  return `${version.data.id}:${decision.data.id}`;
}

/** Revalidate immediately before transport and before returning/reusing its output. */
export async function requireCoachAiGrant(
  db: SupabaseClient, coachId: string, target: { id: string; club_id: string; group_id: string }, playerId: string, expected?: string
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
  const grant = await loadCoachAiPlayerGrant(db, clubId, playerId);
  if (!grant || (expected !== undefined && expected !== grant)) throw new CoachAiAuthorizationError();
  return grant;
}

export function coachAiSourceFingerprint(sourceHash: string, grant: string) {
  return createHash("sha256").update(JSON.stringify(["coaching.ai.v1", sourceHash, grant])).digest("hex");
}
