import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

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

async function notifyEventDeletion(
  supabaseAdmin: any,
  actorUserId: string,
  event: { id: string; event_type: string | null; starts_at: string; location_text: string | null },
  recipientUserIds: string[]
) {
  const recipients = uniq(recipientUserIds).filter((id) => id !== actorUserId);
  if (recipients.length === 0) return;

  const type = String(event.event_type ?? "training");
  const isTraining = type === "training";
  const isInterclub = type === "interclub";
  const isTrainingOrInterclub = isTraining || isInterclub;
  const moment = formatTrainingMoment(event.starts_at);
  const location = String(event.location_text ?? "").trim() || "Lieu à définir";
  const title = isInterclub
    ? `L'interclub du ${moment} a été annulé`
    : isTraining
    ? `L'entrainement du ${moment} a été annulé`
    : "Une activité prévue a été annulée";
  const body = isTrainingOrInterclub ? "" : `Le ${moment} • ${location}`;
  const url = "/player/golf/trainings";

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
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = String(callerData.user.id ?? "").trim();
    const eventRes = await supabaseAdmin
      .from("club_events")
      .select("id,club_id,series_id,event_type,starts_at,location_text")
      .eq("id", eventId)
      .maybeSingle();
    if (eventRes.error) return NextResponse.json({ error: eventRes.error.message }, { status: 400 });
    if (!eventRes.data?.id) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const clubId = String((eventRes.data as { club_id?: string | null }).club_id ?? "").trim();
    const seriesId = String((eventRes.data as { series_id?: string | null }).series_id ?? "").trim();
    const scope = String(new URL(req.url).searchParams.get("scope") ?? "").trim();
    if (!clubId) return NextResponse.json({ error: "Event club missing" }, { status: 400 });
    if (seriesId && scope !== "occurrence") {
      return NextResponse.json({ error: "Événement récurrent : suppression uniquement depuis l’éditeur de récurrence." }, { status: 400 });
    }

    const managerRes = await supabaseAdmin
      .from("club_members")
      .select("id")
      .eq("club_id", clubId)
      .eq("user_id", callerId)
      .eq("role", "manager")
      .eq("is_active", true)
      .maybeSingle();
    if (managerRes.error) return NextResponse.json({ error: managerRes.error.message }, { status: 400 });
    if (!managerRes.data?.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const eventType = String((eventRes.data as { event_type?: string | null }).event_type ?? "training").trim();
    const startsAt = String((eventRes.data as { starts_at?: string | null }).starts_at ?? "").trim();
    const locationText = String((eventRes.data as { location_text?: string | null }).location_text ?? "").trim() || null;

    const attendeesRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id,status")
      .eq("event_id", eventId);
    if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });
    const recipientUserIds = uniq(
      ((attendeesRes.data ?? []) as Array<{ player_id: string | null; status: string | null }>)
        .filter((row) => String(row.status ?? "expected") !== "absent")
        .map((row) => String(row.player_id ?? "").trim())
    );

    const ignoreMissingTable = (err: any) => String(err?.code ?? "") === "42P01";
    const deleteByEventId = async (table: string) => {
      const res = await supabaseAdmin.from(table).delete().eq("event_id", eventId);
      if (res.error && !ignoreMissingTable(res.error)) return res.error;
      return null;
    };

    // Remove known dependent rows first to avoid FK blocks on club_events delete.
    for (const table of [
      "club_event_attendees",
      "club_event_coaches",
      "club_event_structure_items",
      "club_event_player_structure_items",
      "club_event_player_feedback",
      "club_event_coach_feedback",
    ]) {
      const err = await deleteByEventId(table);
      if (err) return NextResponse.json({ error: err.message }, { status: 400 });
    }

    const trainingSessionIdsRes = await supabaseAdmin
      .from("training_sessions")
      .select("id")
      .eq("club_event_id", eventId);
    if (trainingSessionIdsRes.error && !ignoreMissingTable(trainingSessionIdsRes.error)) {
      return NextResponse.json({ error: trainingSessionIdsRes.error.message }, { status: 400 });
    }
    const trainingSessionIds = (trainingSessionIdsRes.data ?? [])
      .map((r: any) => String(r.id ?? "").trim())
      .filter(Boolean);
    if (trainingSessionIds.length > 0) {
      const delSessionItemsRes = await supabaseAdmin
        .from("training_session_items")
        .delete()
        .in("session_id", trainingSessionIds);
      if (delSessionItemsRes.error && !ignoreMissingTable(delSessionItemsRes.error)) {
        return NextResponse.json({ error: delSessionItemsRes.error.message }, { status: 400 });
      }
    }

    const trainingSessionsRes = await supabaseAdmin.from("training_sessions").delete().eq("club_event_id", eventId);
    if (trainingSessionsRes.error && !ignoreMissingTable(trainingSessionsRes.error)) {
      return NextResponse.json({ error: trainingSessionsRes.error.message }, { status: 400 });
    }

    const deleteThreadsRes = await supabaseAdmin.from("message_threads").delete().eq("event_id", eventId);
    if (deleteThreadsRes.error && !ignoreMissingTable(deleteThreadsRes.error)) {
      return NextResponse.json({ error: deleteThreadsRes.error.message }, { status: 400 });
    }

    const delRes = await supabaseAdmin.from("club_events").delete().eq("id", eventId);
    if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

    if (startsAt) {
      try {
        await notifyEventDeletion(
          supabaseAdmin,
          callerId,
          {
            id: eventId,
            event_type: eventType,
            starts_at: startsAt,
            location_text: locationText,
          },
          recipientUserIds
        );
      } catch {
        // Ignore notification failures: activity deletion must remain successful.
      }
    }

    return NextResponse.json({ ok: true, deleted_event_id: eventId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
