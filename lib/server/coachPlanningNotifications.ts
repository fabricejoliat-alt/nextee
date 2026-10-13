import { notifyEventCoaches, type StaffNotificationEvent } from "@/lib/server/notificationStaff";
import { serverNotificationMessage, notificationTemplateData, type NotificationTemplateInput } from "@/lib/server/notificationTemplates";
/* eslint-disable @typescript-eslint/no-explicit-any -- Existing service-side notification adapter. */
import { sendWebPush } from "@/lib/server/webPush";

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

function formatTrainingMoment(iso: string) {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("fr-CH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Zurich",
  })
    .format(d)
    .replace(":", "h");
  return `${datePart} à ${timePart}`;
}

async function dispatchPushForRecipients(
  supabaseAdmin: any,
  opts: { title: string; body: string; url: string; recipientUserIds: string[] } & NotificationTemplateInput
) {
  await sendWebPush(supabaseAdmin, { ...opts, kind: "coach_event_deleted" }).catch(() => {});
}

export async function notifyPlanningDeletion(
  supabaseAdmin: any,
  actorUserId: string,
  event: { id: string; club_id?: string | null; event_type: string | null; starts_at: string; location_text: string | null },
  recipientUserIds: string[],
  seriesCount?: number,
  seriesId?: string | null,
  guardianChildId?: string,
  staffSnapshot?: { event: StaffNotificationEvent; coachIds: string[] }
) {
  const recipients = uniq(recipientUserIds).filter((id) => id !== actorUserId);
  if (recipients.length === 0 && !staffSnapshot?.coachIds.length) return;

  const type = String(event.event_type ?? "training");
  const isTraining = type === "training";
  const isInterclub = type === "interclub";
  const moment = formatTrainingMoment(event.starts_at);
  const location = String(event.location_text ?? "").trim() || "Lieu à définir";
  const template = { templateKey: seriesCount !== undefined ? "notif.coachSeriesDeleted" : "notif.coachEventDeleted", templateParams: {
    eventType: isTraining ? "Entraînement" : isInterclub ? "Interclub" : "Activité", dateTime: moment, locationPart: ` · ${location}`,
    changesSummary: `${seriesCount ?? 1} activités annulées · ${moment}`,
  } };
  const { title, body } = await serverNotificationMessage(supabaseAdmin, template.templateKey, "fr", template.templateParams);
  const url = "/player/golf/trainings" + (guardianChildId ? `?child_id=${encodeURIComponent(guardianChildId)}` : "");

  const ins = await supabaseAdmin
    .from("notifications")
    .insert({
      actor_user_id: actorUserId,
      type: "coach_event_deleted",
      kind: "coach_event_deleted",
      title,
      body,
      data: {
        ...notificationTemplateData(template),
        event_id: event.id,
        organization_id: event.club_id,
        ...(guardianChildId ? { child_id: guardianChildId } : {}),
        ...(seriesId ? { series_id: seriesId } : {}),
        url,
      },
    })
    .select("id")
    .single();
  if (ins.error || !ins.data?.id) throw new Error(ins.error?.message ?? "Notification insert failed");

  const notificationId = String(ins.data.id);
  if (!guardianChildId && staffSnapshot) await notifyEventCoaches(supabaseAdmin, { id: notificationId, actor_user_id: actorUserId,
    kind: "coach_event_deleted", title, body, data: { event_id: event.id, ...notificationTemplateData(template) } }, staffSnapshot);
  const deliveryChecks=await Promise.all(recipients.map(async userId=>{
    const allowed=await supabaseAdmin.rpc("organization_notification_visible",{p_notification:notificationId,p_actor:userId});
    if(allowed.error)throw allowed.error;return allowed.data===true?userId:null;
  }));
  const deliverable=deliveryChecks.filter((id):id is string=>id!==null);
  if(!deliverable.length)return;
  const recIns = await supabaseAdmin
    .from("notification_recipients")
    .upsert(
      deliverable.map((userId) => ({ notification_id: notificationId, user_id: userId })),
      { onConflict: "notification_id,user_id" }
    );
  if (recIns.error) throw new Error(recIns.error.message);

  await dispatchPushForRecipients(supabaseAdmin, {
    title,
    body,
    url,
    recipientUserIds: deliverable,
    ...template,
  });

  // Preserve parent delivery when the edit screen delegates deletion to the API.
  // Keep one child context per notification and exclude revoked viewing links.
  if (!guardianChildId && event.club_id) {
    const parents = new Map<string, Set<string>>();
    for (let offset = 0; offset < recipients.length; offset += 150) {
      const batch = recipients.slice(offset, offset + 150);
      for (let from = 0; ; from += 500) {
        const links = await supabaseAdmin.from("player_guardian_scopes").select("player_id,guardian_user_id,can_view")
          .eq("organization_id",event.club_id).eq("status","active")
          .in("player_id", batch).order("player_id").order("guardian_user_id").range(from, from + 499);
        if (links.error) throw new Error("guardian_notification_failed");
        for (const link of links.data ?? []) {
          if (!link.player_id || !link.guardian_user_id || link.can_view === false || link.guardian_user_id === actorUserId) continue;
          const targets = parents.get(link.player_id) ?? new Set<string>();
          targets.add(link.guardian_user_id); parents.set(link.player_id, targets);
        }
        if ((links.data?.length ?? 0) < 500) break;
      }
    }
    for (const [childId, targets] of parents) await notifyPlanningDeletion(supabaseAdmin, actorUserId, event,
      [...targets], seriesCount, seriesId, childId);
  }
}
