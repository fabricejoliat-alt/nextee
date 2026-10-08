import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { managerActivityClient, managerActivityError } from "@/lib/server/managerActivityWrites";

type EventType = "training" | "interclub" | "camp" | "session" | "event" | "competition";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

function formatDateTimeLabel(startsAtIso: string, endsAtIso: string | null) {
  const start = new Date(startsAtIso);
  const d = new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(start);
  const s = new Intl.DateTimeFormat("fr-CH", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Zurich",
  })
    .format(start)
    .replace(":", "h");
  if (!endsAtIso) return `${d} à ${s}`;
  const endDate = new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Zurich",
  }).format(new Date(endsAtIso));
  return d === endDate ? `${d} à ${s}` : `${d} au ${endDate}`;
}

async function dispatchPushForRecipients(
  supabaseAdmin: SupabaseClient,
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
    (subsRes.data ?? []).map(async (sub: { id: number; endpoint: string; p256dh: string; auth: string }) => {
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

async function createEventNotification(
  supabaseAdmin: SupabaseClient,
  actorUserId: string,
  eventId: string,
  eventType: EventType,
  startsAtIso: string,
  endsAtIso: string | null,
  locationText: string | null,
  recipientUserIds: string[],
  eventTitle?: string | null,
) {
  const recipients = uniq(recipientUserIds).filter((id) => id && id !== actorUserId);
  if (recipients.length === 0) return;

  const dateTime = formatDateTimeLabel(startsAtIso, endsAtIso);
  const location = String(locationText ?? "").trim() || "Lieu à définir";

  const isTrainingOrInterclub = eventType === "training" || eventType === "interclub";
  const isCompetition = eventType === "competition";
  const title =
    isCompetition
      ? `Nouvelle compétition · ${String(eventTitle ?? "").trim() || "Compétition"}`
      : eventType === "interclub"
      ? "Nouvel interclub prévu"
      : isTrainingOrInterclub
      ? "Nouvel entrainement prévu"
      : "Nouvelle activité prévue";
  const body = isCompetition
    ? `Du ${dateTime} · ${location}\nL’inscription se fait sur une plateforme externe.`
    : isTrainingOrInterclub
      ? `Le ${dateTime} • ${location}`
      : `Date Heure: ${dateTime}\nLieu: ${location}`;
  const url = isCompetition ? "/player/golf/trainings?type=competition" : `/player/golf/trainings/new?club_event_id=${eventId}`;

  const ins = await supabaseAdmin
    .from("notifications")
    .insert({
      actor_user_id: actorUserId,
      type: "coach_event_created",
      kind: "coach_event_created",
      title,
      body,
      data: {
        event_id: eventId,
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

  // Best-effort web push dispatch.
  await dispatchPushForRecipients(supabaseAdmin, {
    title,
    body,
    url,
    recipientUserIds: recipients,
  });
}

async function getManagerContext(req: NextRequest, supabaseAdmin: SupabaseClient) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const callerId = callerData.user.id;
  const { data: memberships, error: membershipsError } = await supabaseAdmin
    .from("club_members")
    .select("club_id")
    .eq("user_id", callerId)
    .eq("role", "manager")
    .eq("is_active", true);

  if (membershipsError) return { ok: false as const, status: 400, error: membershipsError.message };

  const clubIds = uniq((memberships ?? []).map((m: { club_id: string }) => String(m?.club_id ?? "")));
  return { ok: true as const, callerId, clubIds };
}

export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const ctx = await getManagerContext(req, supabaseAdmin);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

    if (ctx.clubIds.length === 0) {
      return NextResponse.json({ clubs: [], groups: [], players: [], coaches: [], parents: [] });
    }

    const [clubsRes, groupsRes, membersRes] = await Promise.all([
      supabaseAdmin.from("organizations").select("id,name").in("id", ctx.clubIds),
      supabaseAdmin
        .from("coach_groups")
        .select("id,name,club_id,is_active,head_coach_user_id")
        .in("club_id", ctx.clubIds)
        .neq("name", "__ARCHIVE_HISTORIQUE__")
        .not("club_season_id", "is", null)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("club_members")
        .select("club_id,user_id,role,is_active")
        .in("club_id", ctx.clubIds)
        .eq("is_active", true)
        .in("role", ["player", "coach", "parent"]),
    ]);

    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });

    const groups = (groupsRes.data ?? []) as Array<{
      id: string;
      name: string | null;
      club_id: string;
      is_active: boolean | null;
      head_coach_user_id: string | null;
    }>;
    const allGroupIds = uniq(groups.map((g) => g.id));

    const memberRows = (membersRes.data ?? []) as Array<{
      club_id: string;
      user_id: string;
      role: "player" | "coach" | "parent";
      is_active: boolean;
    }>;

    const [groupPlayersRes, groupCoachesRes] = await Promise.all([
      allGroupIds.length > 0
        ? supabaseAdmin.from("coach_group_players").select("group_id,player_user_id").in("group_id", allGroupIds)
        : Promise.resolve({ data: [], error: null }),
      allGroupIds.length > 0
        ? supabaseAdmin.from("coach_group_coaches").select("group_id,coach_user_id").in("group_id", allGroupIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (groupPlayersRes.error) return NextResponse.json({ error: groupPlayersRes.error.message }, { status: 400 });
    if (groupCoachesRes.error) return NextResponse.json({ error: groupCoachesRes.error.message }, { status: 400 });

    const userIds = uniq(memberRows.map((r) => r.user_id));
    const headCoachIds = uniq(groups.map((g) => String(g.head_coach_user_id ?? "")));
    const profileIds = uniq([...userIds, ...headCoachIds]);

    let profileById = new Map<string, { first_name: string | null; last_name: string | null; birth_date: string | null }>();
    if (profileIds.length > 0) {
      const profilesRes = await supabaseAdmin.from("profiles").select("id,first_name,last_name,birth_date").in("id", profileIds);
      if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
      profileById = new Map(
        (profilesRes.data ?? []).map((p) => [
          String(p.id),
          {
            first_name: (p.first_name ?? null) as string | null,
            last_name: (p.last_name ?? null) as string | null,
            birth_date: (p.birth_date ?? null) as string | null,
          },
        ])
      );
    }

    const fullName = (id: string) => {
      const p = profileById.get(id);
      const first = String(p?.first_name ?? "").trim();
      const last = String(p?.last_name ?? "").trim();
      return `${first} ${last}`.trim() || id;
    };

    const usersByRole: Record<"player" | "coach" | "parent", Array<{ id: string; club_id: string; name: string; birth_date: string | null }>> = {
      player: [],
      coach: [],
      parent: [],
    };

    const seenByRole = {
      player: new Set<string>(),
      coach: new Set<string>(),
      parent: new Set<string>(),
    };

    for (const row of memberRows) {
      const key = `${row.role}:${row.club_id}:${row.user_id}`;
      if (seenByRole[row.role].has(key)) continue;
      seenByRole[row.role].add(key);
      usersByRole[row.role].push({
        id: row.user_id,
        club_id: row.club_id,
        name: fullName(row.user_id),
        birth_date: profileById.get(row.user_id)?.birth_date ?? null,
      });
    }

    const groupsOut = groups.map((g) => {
      const headId = String(g.head_coach_user_id ?? "").trim();
      return {
        id: g.id,
        name: g.name,
        club_id: g.club_id,
        head_coach_user_id: g.head_coach_user_id,
        head_coach_name: headId ? fullName(headId) : null,
      };
    });

    const groupPlayers = ((groupPlayersRes.data ?? []) as Array<{ group_id: string; player_user_id: string }>)
      .map((r) => ({ group_id: String(r.group_id ?? "").trim(), player_id: String(r.player_user_id ?? "").trim() }))
      .filter((r) => r.group_id && r.player_id);

    const groupCoachesRaw = ((groupCoachesRes.data ?? []) as Array<{ group_id: string; coach_user_id: string }>)
      .map((r) => ({ group_id: String(r.group_id ?? "").trim(), coach_id: String(r.coach_user_id ?? "").trim() }))
      .filter((r) => r.group_id && r.coach_id);

    const headCoachLinks = groups
      .map((g) => ({ group_id: String(g.id ?? "").trim(), coach_id: String(g.head_coach_user_id ?? "").trim() }))
      .filter((r) => r.group_id && r.coach_id);

    const seenGroupCoach = new Set<string>();
    const groupCoaches = [...groupCoachesRaw, ...headCoachLinks].filter((r) => {
      const key = `${r.group_id}:${r.coach_id}`;
      if (seenGroupCoach.has(key)) return false;
      seenGroupCoach.add(key);
      return true;
    });

    return NextResponse.json({
      clubs: clubsRes.data ?? [],
      groups: groupsOut,
      players: usersByRole.player.sort((a, b) => a.name.localeCompare(b.name, "fr-CH")),
      coaches: usersByRole.coach.sort((a, b) => a.name.localeCompare(b.name, "fr-CH")),
      parents: usersByRole.parent.sort((a, b) => a.name.localeCompare(b.name, "fr-CH")),
      group_players: groupPlayers,
      group_coaches: groupCoaches,
    });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const ctx = await getManagerContext(req, admin);
    if (!ctx.ok) return NextResponse.json({ error: ctx.status === 401 ? "session" : "forbidden", outcome: "rejected" }, { status: ctx.status });
    if (!ctx.clubIds.length) return NextResponse.json({ error: "forbidden", outcome: "rejected" }, { status: 403 });
    const body = await req.json().catch(() => null);
    if (!body || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.requestId ?? "")) {
      return NextResponse.json({ error: "invalid_request", outcome: "rejected" }, { status: 400 });
    }
    const { requestId, ...payload } = body;
    const result = await managerActivityClient(req).rpc("create_manager_activity_batch_v1", { p_request_id: requestId, p_payload: payload });
    if (result.error) {
      const { status, ...error } = managerActivityError(result.error);
      return NextResponse.json(error, { status });
    }
    const data = result.data;
    if (data?.ok !== true || !data.firstEventId || !Array.isArray(data.events) || !data.events.length) {
      return NextResponse.json({ error: "unconfirmed", outcome: "unknown" }, { status: 503 });
    }
    // Every event, participant and reminder is committed before notification delivery.
    let notificationWarning = Boolean(data.replayed);
    if (!data.replayed) {
      for (const event of data.events) {
        try {
          await createEventNotification(admin, ctx.callerId, event.id, event.event_type, event.starts_at,
            event.ends_at, event.location_text, event.recipient_ids, event.title);
        } catch { notificationWarning = true; }
      }
    }
    return NextResponse.json({ ok: true, firstEventId: data.firstEventId, createdEvents: data.createdEvents,
      createdSeries: data.createdSeries, replayed: Boolean(data.replayed), notificationWarning });
  } catch {
    return NextResponse.json({ error: "unconfirmed", outcome: "unknown" }, { status: 503 });
  }
}
