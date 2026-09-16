import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import {
  COMPETITION_CATEGORIES,
  COMPETITION_LEVELS,
  REMINDER_CHANNELS,
  competitionTournamentYear,
  isHttpUrl,
  type CompetitionCategory,
  type CompetitionLevel,
  type ReminderChannel,
} from "@/lib/competitions";

type CompetitionUpdatePayload = {
  eventType?: string;
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  competitionStartDate?: string | null;
  competitionEndDate?: string | null;
  locationText?: string | null;
  competitionLevel?: CompetitionLevel | null;
  competitionCategory?: CompetitionCategory | null;
  externalRegistrationUrl?: string | null;
  competitionNote?: string | null;
  playerTarget?: { ids?: string[] };
  coachTarget?: { ids?: string[] };
  reminder?: {
    enabled?: boolean;
    scheduledFor?: string | null;
    channel?: ReminderChannel | null;
    messageTemplate?: string | null;
  };
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

async function managerEventContext(req: NextRequest, eventId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const eventRes = await supabaseAdmin
    .from("club_events")
    .select("id,group_id,club_id,event_type,title,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status,competition_level,competition_category,external_registration_url,competition_note")
    .eq("id", eventId)
    .maybeSingle();
  if (eventRes.error) return { ok: false as const, status: 400, error: eventRes.error.message };
  if (!eventRes.data?.id) return { ok: false as const, status: 404, error: "Event not found" };

  const callerId = String(callerData.user.id ?? "").trim();
  const clubId = String(eventRes.data.club_id ?? "").trim();
  const managerRes = await supabaseAdmin
    .from("club_members")
    .select("id")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("role", "manager")
    .eq("is_active", true)
    .maybeSingle();
  if (managerRes.error) return { ok: false as const, status: 400, error: managerRes.error.message };
  if (!managerRes.data?.id) return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, supabaseAdmin, callerId, clubId, event: eventRes.data };
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

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const context = await managerEventContext(req, eventId);
    if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
    if (String(context.event.event_type ?? "") !== "competition") {
      return NextResponse.json({ error: "This editor is only available for competitions" }, { status: 400 });
    }

    const [attendeesRes, coachesRes, reminderRes] = await Promise.all([
      context.supabaseAdmin.from("club_event_attendees").select("player_id").eq("event_id", eventId),
      context.supabaseAdmin.from("club_event_coaches").select("coach_id").eq("event_id", eventId),
      context.supabaseAdmin
        .from("club_event_reminders")
        .select("id,scheduled_for,channel,message_template,status,sent_at,last_error")
        .eq("event_id", eventId)
        .maybeSingle(),
    ]);
    if (attendeesRes.error) return NextResponse.json({ error: attendeesRes.error.message }, { status: 400 });
    if (coachesRes.error) return NextResponse.json({ error: coachesRes.error.message }, { status: 400 });
    if (reminderRes.error) return NextResponse.json({ error: reminderRes.error.message }, { status: 400 });

    return NextResponse.json({
      event: context.event,
      player_ids: uniq(((attendeesRes.data ?? []) as Array<{ player_id: string | null }>).map((row) => String(row.player_id ?? ""))),
      coach_ids: uniq(((coachesRes.data ?? []) as Array<{ coach_id: string | null }>).map((row) => String(row.coach_id ?? ""))),
      reminder: reminderRes.data ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const context = await managerEventContext(req, eventId);
    if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status });
    if (String(context.event.event_type ?? "") !== "competition") {
      return NextResponse.json({ error: "Seules les compétitions peuvent être modifiées ici." }, { status: 400 });
    }

    const payload = (await req.json().catch(() => ({}))) as CompetitionUpdatePayload;
    const title = String(payload.title ?? "").trim();
    const level = String(payload.competitionLevel ?? "") as CompetitionLevel;
    const category = String(payload.competitionCategory ?? "") as CompetitionCategory;
    const locationText = String(payload.locationText ?? "").trim();
    const note = String(payload.competitionNote ?? "").trim();
    const externalUrl = String(payload.externalRegistrationUrl ?? "").trim();
    const startInput = String(payload.startsAt ?? "");
    const endInput = String(payload.endsAt ?? "");
    const startsAt = new Date(startInput);
    const endsAt = new Date(endInput);

    if (!title) return NextResponse.json({ error: "Le nom de la compétition est obligatoire." }, { status: 400 });
    if (!COMPETITION_LEVELS.includes(level)) return NextResponse.json({ error: "Niveau invalide." }, { status: 400 });
    if (!COMPETITION_CATEGORIES.includes(category)) return NextResponse.json({ error: "Catégorie invalide." }, { status: 400 });
    if (!isHttpUrl(externalUrl)) return NextResponse.json({ error: "Lien externe invalide." }, { status: 400 });
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt < startsAt) {
      return NextResponse.json({ error: "Période de compétition invalide." }, { status: 400 });
    }
    const yearCheck = competitionTournamentYear(
      String(payload.competitionStartDate ?? "").trim(),
      String(payload.competitionEndDate ?? "").trim(),
    );
    if (yearCheck.error) return NextResponse.json({ error: yearCheck.error }, { status: 400 });

    const playerIds = uniq(payload.playerTarget?.ids ?? []);
    const coachIds = uniq(payload.coachTarget?.ids ?? []);
    if (playerIds.length === 0) return NextResponse.json({ error: "Sélectionnez au moins un joueur." }, { status: 400 });

    const membersRes = await context.supabaseAdmin
      .from("club_members")
      .select("user_id,role")
      .eq("club_id", context.clubId)
      .eq("is_active", true)
      .in("user_id", uniq([...playerIds, ...coachIds]));
    if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
    const memberRows = (membersRes.data ?? []) as Array<{ user_id: string | null; role: string | null }>;
    const validPlayers = new Set(memberRows.filter((row) => row.role === "player").map((row) => String(row.user_id)));
    const validCoaches = new Set(memberRows.filter((row) => row.role === "coach").map((row) => String(row.user_id)));
    if (playerIds.some((id) => !validPlayers.has(id)) || coachIds.some((id) => !validCoaches.has(id))) {
      return NextResponse.json({ error: "Un participant n’appartient pas au club de la compétition." }, { status: 400 });
    }

    const reminderRes = await context.supabaseAdmin
      .from("club_event_reminders")
      .select("id,status,sent_at")
      .eq("event_id", eventId)
      .maybeSingle();
    if (reminderRes.error) return NextResponse.json({ error: reminderRes.error.message }, { status: 400 });
    const existingReminder = reminderRes.data as { id: string; status: string; sent_at: string | null } | null;
    const reminderCanChange = !existingReminder || existingReminder.status === "pending";
    const nextReminder = reminderCanChange && payload.reminder?.enabled
      ? {
          scheduledFor: new Date(String(payload.reminder.scheduledFor ?? "")),
          channel: String(payload.reminder.channel ?? "") as ReminderChannel,
          message: String(payload.reminder.messageTemplate ?? "").trim(),
        }
      : null;
    if (
      nextReminder &&
      (Number.isNaN(nextReminder.scheduledFor.getTime()) ||
        nextReminder.scheduledFor.getTime() <= Date.now() ||
        nextReminder.scheduledFor >= startsAt ||
        !REMINDER_CHANNELS.includes(nextReminder.channel) ||
        !nextReminder.message)
    ) {
      return NextResponse.json({ error: "Configuration du rappel invalide." }, { status: 400 });
    }

    const groupId = String(context.event.group_id ?? "").trim();
    if (groupId) {
      const [deleteGroupPlayersRes, deleteGroupCoachesRes] = await Promise.all([
        context.supabaseAdmin.from("coach_group_players").delete().eq("group_id", groupId),
        context.supabaseAdmin.from("coach_group_coaches").delete().eq("group_id", groupId),
      ]);
      if (deleteGroupPlayersRes.error) return NextResponse.json({ error: deleteGroupPlayersRes.error.message }, { status: 400 });
      if (deleteGroupCoachesRes.error) return NextResponse.json({ error: deleteGroupCoachesRes.error.message }, { status: 400 });
      const groupPlayersInsert = await context.supabaseAdmin.from("coach_group_players").insert(
        playerIds.map((playerId) => ({ group_id: groupId, player_user_id: playerId })),
      );
      if (groupPlayersInsert.error) return NextResponse.json({ error: groupPlayersInsert.error.message }, { status: 400 });
      if (coachIds.length > 0) {
        const groupCoachesInsert = await context.supabaseAdmin.from("coach_group_coaches").insert(
          coachIds.map((coachId, index) => ({ group_id: groupId, coach_user_id: coachId, is_head: index === 0 })),
        );
        if (groupCoachesInsert.error) return NextResponse.json({ error: groupCoachesInsert.error.message }, { status: 400 });
      }
      const groupUpdate = await context.supabaseAdmin.from("coach_groups").update({
        name: `Compétition · ${title}`,
        head_coach_user_id: coachIds[0] ?? null,
      }).eq("id", groupId);
      if (groupUpdate.error) return NextResponse.json({ error: groupUpdate.error.message }, { status: 400 });
    }

    const updateRes = await context.supabaseAdmin
      .from("club_events")
      .update({
        title,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        duration_minutes: Math.min(300, Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000))),
        location_text: locationText || null,
        competition_level: level,
        competition_category: category,
        external_registration_url: externalUrl || null,
        competition_note: note || null,
        requires_evaluation: false,
      })
      .eq("id", eventId);
    if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 400 });

    const [deleteAttendeesRes, deleteCoachesRes] = await Promise.all([
      context.supabaseAdmin.from("club_event_attendees").delete().eq("event_id", eventId),
      context.supabaseAdmin.from("club_event_coaches").delete().eq("event_id", eventId),
    ]);
    if (deleteAttendeesRes.error) return NextResponse.json({ error: deleteAttendeesRes.error.message }, { status: 400 });
    if (deleteCoachesRes.error) return NextResponse.json({ error: deleteCoachesRes.error.message }, { status: 400 });

    const attendeeInsert = await context.supabaseAdmin.from("club_event_attendees").insert(
      playerIds.map((playerId) => ({ event_id: eventId, player_id: playerId, status: "expected" })),
    );
    if (attendeeInsert.error) return NextResponse.json({ error: attendeeInsert.error.message }, { status: 400 });
    if (coachIds.length > 0) {
      const coachInsert = await context.supabaseAdmin.from("club_event_coaches").insert(
        coachIds.map((coachId) => ({ event_id: eventId, coach_id: coachId })),
      );
      if (coachInsert.error) return NextResponse.json({ error: coachInsert.error.message }, { status: 400 });
    }

    if (existingReminder?.status === "pending") {
      if (nextReminder) {
        const reminderUpdate = await context.supabaseAdmin.from("club_event_reminders").update({
          scheduled_for: nextReminder.scheduledFor.toISOString(),
          channel: nextReminder.channel,
          message_template: nextReminder.message,
          last_error: null,
        }).eq("id", existingReminder.id).eq("status", "pending");
        if (reminderUpdate.error) return NextResponse.json({ error: reminderUpdate.error.message }, { status: 400 });
      } else {
        const reminderDelete = await context.supabaseAdmin.from("club_event_reminders").delete().eq("id", existingReminder.id).eq("status", "pending");
        if (reminderDelete.error) return NextResponse.json({ error: reminderDelete.error.message }, { status: 400 });
      }
    } else if (!existingReminder && nextReminder) {
      const reminderInsert = await context.supabaseAdmin.from("club_event_reminders").insert({
        event_id: eventId,
        scheduled_for: nextReminder.scheduledFor.toISOString(),
        channel: nextReminder.channel,
        message_template: nextReminder.message,
        status: "pending",
        created_by: context.callerId,
      });
      if (reminderInsert.error) return NextResponse.json({ error: reminderInsert.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, firstEventId: eventId });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
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
