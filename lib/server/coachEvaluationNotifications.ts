import { serverNotificationMessage, notificationTemplateData } from "@/lib/server/notificationTemplates";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWebPush } from "@/lib/server/webPush";

/** Called only after the authorized evaluation transaction has committed. */
export async function notifyCoachPlayerEvaluation(db: SupabaseClient, input: {
  actorUserId: string; playerId: string; event: { id: string; club_id: string; starts_at: string };
  recordedAt: string;
}) {
  const { event, playerId, actorUserId, recordedAt } = input;
  if (!recordedAt) throw new Error("Evaluation version unavailable");
  const identity = { event_id: event.id, player_id: playerId, evaluation_recorded_at: recordedAt };
  const existing = await db.from("notifications").select("id").eq("kind", "coach_player_evaluated")
    .contains("data", identity).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { created: false, duplicate: true };

  const moment = new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Zurich" })
    .format(new Date(event.starts_at));
  const profile = await db.from("profiles").select("first_name,last_name").eq("id", playerId).maybeSingle();
  const template = { templateKey: "notif.coachPlayerEvaluated", templateParams: {
    playerName: [profile.data?.first_name, profile.data?.last_name].filter(Boolean).join(" ") || "Joueur",
    eventType: "Entraînement", dateTime: moment,
  } };
  const { title, body } = await serverNotificationMessage(db, template.templateKey, "fr", template.templateParams);
  const url = `/player/golf/trainings/new?club_event_id=${encodeURIComponent(event.id)}&mode=view&child_id=${encodeURIComponent(playerId)}`;
  const notification = await db.from("notifications").insert({
    actor_user_id: actorUserId, club_id: event.club_id, type: "coach_player_evaluated", kind: "coach_player_evaluated",
    title, body, data: { ...notificationTemplateData(template), ...identity, organization_id: event.club_id, child_id: playerId, url },
  }).select("id").single();
  if (notification.error || !notification.data?.id) throw new Error("Evaluation notification unavailable");

  const guardians = await db.from("player_guardian_scopes").select("guardian_user_id")
    .eq("organization_id", event.club_id).eq("player_id", playerId).eq("status", "active").eq("can_view", true);
  if (guardians.error) throw guardians.error;
  const candidates = [...new Set([playerId, ...(guardians.data ?? []).map(row => row.guardian_user_id)])]
    .filter(id => id && id !== actorUserId);
  const checked = await Promise.all(candidates.map(async userId => {
    const access = await db.rpc("organization_notification_visible", { p_notification: notification.data.id, p_actor: userId });
    if (access.error) throw access.error;
    return access.data === true ? userId : null;
  }));
  const recipients = checked.filter((id): id is string => id !== null);
  if (!recipients.length) return { created: true, recipients: 0 };
  const delivered = await db.from("notification_recipients").upsert(
    recipients.map(userId => ({ notification_id: notification.data.id, user_id: userId })), { onConflict: "notification_id,user_id" });
  if (delivered.error) throw delivered.error;
  // Await the provider call so the server invocation cannot end before sending.
  const push = await sendWebPush(db, { recipientUserIds: recipients, kind: "coach_player_evaluated", title, body, url, ...template });
  return { created: true, recipients: recipients.length, push };
}
