import type { SupabaseClient } from "@supabase/supabase-js";
import { serverNotificationMessage, notificationTemplateData } from "@/lib/server/notificationTemplates";
import { sendWebPush } from "@/lib/server/webPush";
/** Runs after a confirmed attendance change, with a server-resolved player identity. */
export async function notifyPlayerAttendance(db: SupabaseClient, input: { actorId: string; playerId: string; eventId: string; status: "present" | "absent" }) {
  const event = await db.from("club_events").select("id,club_id,group_id,starts_at,event_type").eq("id", input.eventId).single();
  if (event.error) throw event.error;
  const [coaches, profile] = await Promise.all([
    db.from("club_event_coaches").select("coach_id").eq("event_id", input.eventId),
    db.from("profiles").select("first_name,last_name").eq("id", input.playerId).maybeSingle(),
  ]);
  if (coaches.error || profile.error) throw new Error("Attendance notification unavailable");
  let ids = (coaches.data ?? []).map(row => row.coach_id);
  if (!ids.length && event.data.group_id) {
    const [group, extra] = await Promise.all([
      db.from("coach_groups").select("head_coach_user_id").eq("id", event.data.group_id).maybeSingle(),
      db.from("coach_group_coaches").select("coach_user_id").eq("group_id", event.data.group_id),
    ]);
    if (group.error || extra.error) throw new Error("Attendance recipients unavailable");
    ids = [group.data?.head_coach_user_id, ...(extra.data ?? []).map(row => row.coach_user_id)].filter(Boolean);
  }
  ids = [...new Set(ids)].filter(id => id !== input.actorId);
  if (!ids.length) return;
  const kind = input.status === "absent" ? "player_marked_absent" : "player_marked_present";
  const template = { templateKey: input.status === "absent" ? "notif.playerMarkedAbsent" : "notif.playerMarkedPresent", templateParams: {
    playerName: [profile.data?.first_name, profile.data?.last_name].filter(Boolean).join(" ") || "Joueur",
    eventType: "Entraînement", dateTime: new Intl.DateTimeFormat("fr-CH", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(new Date(event.data.starts_at)),
  } };
  const { title, body } = await serverNotificationMessage(db, template.templateKey, "fr", template.templateParams);
  const url = `/coach/groups/${event.data.group_id}/planning/${input.eventId}`;
  const notification = await db.from("notifications").insert({ actor_user_id: input.actorId, club_id: event.data.club_id,
    kind, type: kind, title, body, data: { ...notificationTemplateData(template), event_id: input.eventId, player_id: input.playerId, group_id: event.data.group_id, url },
  }).select("id").single();
  if (notification.error) throw notification.error;
  const checks = await Promise.all(ids.map(async id => {
    const allowed = await db.rpc("organization_notification_visible", { p_notification: notification.data.id, p_actor: id });
    if (allowed.error) throw allowed.error;
    return allowed.data === true ? id : null;
  }));
  const recipients = checks.filter((id): id is string => Boolean(id));
  if (!recipients.length) return;
  const result = await db.from("notification_recipients").upsert(recipients.map(user_id => ({ notification_id: notification.data.id, user_id })), { onConflict: "notification_id,user_id" });
  if (result.error) throw result.error;
  return sendWebPush(db, { ...template, recipientUserIds: recipients, kind, title, body, url });
}
