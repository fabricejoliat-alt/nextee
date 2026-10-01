/* eslint-disable @typescript-eslint/no-explicit-any -- Existing service-side notification adapter. */
import webpush from "web-push";

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
  opts: { title: string; body: string; url: string; recipientUserIds: string[] }
) {
  const recipients = uniq(opts.recipientUserIds);
  if (recipients.length === 0) return;

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) return;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:contact@activitee.app";
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const subsRes = await supabaseAdmin
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .in("user_id", recipients);
  if (subsRes.error) return;

  const payload = JSON.stringify({
    title: opts.title,
    body: opts.body,
    url: opts.url,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    timestamp: Date.now(),
  });

  const staleIds: number[] = [];
  await Promise.all(
    (subsRes.data ?? []).map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
      } catch (err: unknown) {
        const statusCode = Number((err as { statusCode?: number } | null)?.statusCode ?? 0);
        if (statusCode === 404 || statusCode === 410) staleIds.push(Number(sub.id));
      }
    })
  );

  if (staleIds.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", staleIds);
  }
}

export async function notifyPlanningDeletion(
  supabaseAdmin: any,
  actorUserId: string,
  event: { id: string; event_type: string | null; starts_at: string; location_text: string | null },
  recipientUserIds: string[],
  seriesCount?: number,
  seriesId?: string | null,
  guardianChildId?: string
) {
  const recipients = uniq(recipientUserIds).filter((id) => id !== actorUserId);
  if (recipients.length === 0) return;

  const type = String(event.event_type ?? "training");
  const isTraining = type === "training";
  const isInterclub = type === "interclub";
  const isTrainingOrInterclub = isTraining || isInterclub;
  const moment = formatTrainingMoment(event.starts_at);
  const location = String(event.location_text ?? "").trim() || "Lieu à définir";
  const title = seriesCount !== undefined ? "Récurrence supprimée" : isInterclub
    ? `L'interclub du ${moment} a été annulé`
    : isTraining
      ? `L'entrainement du ${moment} a été annulé`
      : "Une activité prévue a été annulée";
  const body = seriesCount !== undefined ? `${seriesCount} activités annulées · ${moment}` : isTrainingOrInterclub ? "" : `Le ${moment} • ${location}`;
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
        event_id: event.id,
        ...(seriesId ? { series_id: seriesId } : {}),
        url,
      },
    })
    .select("id")
    .single();
  if (ins.error || !ins.data?.id) throw new Error(ins.error?.message ?? "Notification insert failed");

  const notificationId = String(ins.data.id);
  const recIns = await supabaseAdmin
    .from("notification_recipients")
    .upsert(
      recipients.map((userId) => ({ notification_id: notificationId, user_id: userId })),
      { onConflict: "notification_id,user_id" }
    );
  if (recIns.error) throw new Error(recIns.error.message);

  await dispatchPushForRecipients(supabaseAdmin, {
    title,
    body,
    url,
    recipientUserIds: recipients,
  });

  // Preserve parent delivery when the edit screen delegates deletion to the API.
  // Keep one child context per notification and exclude revoked viewing links.
  if (!guardianChildId) {
    const parents = new Map<string, Set<string>>();
    for (let offset = 0; offset < recipients.length; offset += 150) {
      const batch = recipients.slice(offset, offset + 150);
      for (let from = 0; ; from += 500) {
        const links = await supabaseAdmin.from("player_guardians").select("player_id,guardian_user_id,can_view")
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
