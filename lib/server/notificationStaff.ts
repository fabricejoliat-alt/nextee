import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWebPush } from "@/lib/server/webPush";
export type StaffNotificationEvent = { id: string; club_id: string; group_id: string | null };
export async function assignedNotificationCoaches(db: SupabaseClient, event: StaffNotificationEvent) {
  const direct = await db.from("club_event_coaches").select("coach_id").eq("event_id", event.id);
  if (direct.error) throw direct.error;
  let ids = (direct.data ?? []).map(row => row.coach_id);
  if (!ids.length && event.group_id) {
    const [head, others] = await Promise.all([
      db.from("coach_groups").select("head_coach_user_id").eq("id", event.group_id).eq("club_id", event.club_id).maybeSingle(),
      db.from("coach_group_coaches").select("coach_user_id").eq("group_id", event.group_id),
    ]);
    if (head.error || others.error) throw new Error("Coach recipients unavailable");
    ids = [head.data?.head_coach_user_id, ...(others.data ?? []).map(row => row.coach_user_id)].filter(Boolean);
  }
  if (!ids.length) return [];
  const memberships = await db.from("club_members").select("user_id").eq("club_id", event.club_id).eq("role", "coach").eq("is_active", true).in("user_id", ids);
  if (memberships.error) throw memberships.error;
  return [...new Set((memberships.data ?? []).map(row => row.user_id))] as string[];
}
/** A separate row keeps the Coach destination distinct from Player/Parent links. */
export async function notifyEventCoaches(db: SupabaseClient, source: {
  id: string; actor_user_id: string; kind: string; title: string; body: string | null; data: Record<string, unknown>;
}, snapshot?: { event: StaffNotificationEvent; coachIds: string[] }) {
  if (!["coach_event_created", "coach_event_updated", "coach_event_deleted"].includes(source.kind) || source.data.staff_copy) return;
  let event = snapshot?.event;
  if (!event) {
    if (!source.data.event_id) return;
    const result = await db.from("club_events").select("id,club_id,group_id").eq("id", source.data.event_id).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return;
    event = result.data;
  }
  const coachIds = (snapshot?.coachIds ?? await assignedNotificationCoaches(db, event)).filter(id => id !== source.actor_user_id);
  if (!coachIds.length) return;
  const identity = { source_notification_id: source.id, staff_copy: true };
  const existing = await db.from("notifications").select("id").contains("data", identity).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  const url = source.kind === "coach_event_deleted" || !event.group_id ? "/coach/calendar" : `/coach/groups/${event.group_id}/planning/${event.id}`;
  const data = { ...source.data, ...identity, organization_id: event.club_id, group_id: event.group_id, url };
  // Never inherit a child-specific destination / visibility constraint.
  delete (data as Record<string, unknown>).child_id;
  const created = await db.from("notifications").insert({ actor_user_id: source.actor_user_id, club_id: event.club_id,
    type: source.kind, kind: source.kind, title: source.title, body: source.body, data }).select("id").single();
  if (created.error) throw created.error;
  const checks = await Promise.all(coachIds.map(async id => {
    const allowed = await db.rpc("organization_notification_visible", { p_notification: created.data.id, p_actor: id });
    if (allowed.error) throw allowed.error;
    return allowed.data === true ? id : null;
  }));
  const recipients = checks.filter((id): id is string => Boolean(id));
  if (!recipients.length) return;
  const saved = await db.from("notification_recipients").upsert(recipients.map(user_id => ({ notification_id: created.data.id, user_id })), { onConflict: "notification_id,user_id" });
  if (saved.error) throw saved.error;
  const result = await sendWebPush(db, { recipientUserIds: recipients, kind: source.kind, title: source.title, body: source.body, url,
    templateKey: typeof source.data.template_key === "string" ? source.data.template_key : undefined,
    templateParams: source.data.template_params as Record<string, string> });
  return result;
}
