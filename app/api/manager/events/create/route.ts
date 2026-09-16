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

type EventType = "training" | "interclub" | "camp" | "session" | "event" | "competition";
type TargetMode = "none" | "all" | "selected";
type CreateMode = "single" | "series";

type TargetScope = {
  mode: TargetMode;
  ids?: string[];
};

type CreatePayload = {
  mode: CreateMode;
  eventType: EventType;
  title?: string | null;
  startsAt?: string;
  endsAt?: string;
  durationMinutes?: number;
  locationText?: string | null;
  coachNote?: string | null;
  requiresEvaluation?: boolean;
  evaluationCriterionIds?: string[];
  competitionClubId?: string | null;
  competitionStartDate?: string | null;
  competitionEndDate?: string | null;
  competitionLevel?: CompetitionLevel | null;
  competitionCategory?: CompetitionCategory | null;
  externalRegistrationUrl?: string | null;
  competitionNote?: string | null;
  reminder?: {
    enabled: boolean;
    scheduledFor?: string | null;
    channel?: ReminderChannel | null;
    messageTemplate?: string | null;
  };
  series?: {
    weekday: number;
    timeOfDay: string;
    intervalWeeks: number;
    startDate: string;
    endDate: string;
  };
  groupTarget: { mode: "all" | "selected"; ids?: string[] };
  playerTarget: TargetScope;
  coachTarget: TargetScope;
  parentTarget: TargetScope;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

function parseLocalDateTime(date: string, hhmm: string) {
  const hhmmss = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  return new Date(`${date}T${hhmmss}`);
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function toYMD(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextWeekdayOnOrAfter(start: Date, targetWeekday: number) {
  const d = new Date(start);
  const w = d.getDay();
  const diff = (targetWeekday - w + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
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

async function createEventNotification(
  supabaseAdmin: any,
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

async function getManagerContext(req: NextRequest, supabaseAdmin: any) {
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

  const clubIds = uniq((memberships ?? []).map((m: any) => String(m?.club_id ?? "")));
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
      supabaseAdmin.from("clubs").select("id,name").in("id", ctx.clubIds),
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
        : Promise.resolve({ data: [], error: null } as any),
      allGroupIds.length > 0
        ? supabaseAdmin.from("coach_group_coaches").select("group_id,coach_user_id").in("group_id", allGroupIds)
        : Promise.resolve({ data: [], error: null } as any),
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
        (profilesRes.data ?? []).map((p: any) => [
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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const ctx = await getManagerContext(req, supabaseAdmin);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    if (ctx.clubIds.length === 0) return NextResponse.json({ error: "No managed clubs" }, { status: 403 });

    const payload = (await req.json().catch(() => ({}))) as CreatePayload;
    if (!payload?.mode || !payload?.eventType || !payload?.groupTarget) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const allowedEventTypes: EventType[] = ["training", "interclub", "camp", "session", "event", "competition"];
    if (!allowedEventTypes.includes(payload.eventType)) {
      return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
    }

    const isCompetition = payload.eventType === "competition";
    const competitionClubId = String(payload.competitionClubId ?? "").trim();
    const competitionLevel = String(payload.competitionLevel ?? "").trim() as CompetitionLevel;
    const competitionCategory = String(payload.competitionCategory ?? "").trim() as CompetitionCategory;
    const externalRegistrationUrl = String(payload.externalRegistrationUrl ?? "").trim();
    const competitionNote = String(payload.competitionNote ?? "").trim();

    if (isCompetition) {
      if (payload.mode !== "single") {
        return NextResponse.json({ error: "Une compétition doit être une activité unique." }, { status: 400 });
      }
      if (!String(payload.title ?? "").trim()) {
        return NextResponse.json({ error: "Le nom de la compétition est obligatoire." }, { status: 400 });
      }
      if (!ctx.clubIds.includes(competitionClubId)) {
        return NextResponse.json({ error: "Club de la compétition invalide." }, { status: 400 });
      }
      if (!COMPETITION_LEVELS.includes(competitionLevel)) {
        return NextResponse.json({ error: "Le niveau de la compétition est obligatoire." }, { status: 400 });
      }
      if (!COMPETITION_CATEGORIES.includes(competitionCategory)) {
        return NextResponse.json({ error: "La catégorie d’âge est obligatoire." }, { status: 400 });
      }
      if (!isHttpUrl(externalRegistrationUrl)) {
        return NextResponse.json({ error: "Le lien d’inscription externe doit être une URL HTTP ou HTTPS valide." }, { status: 400 });
      }
      const startDate = String(payload.competitionStartDate ?? "").trim();
      const endDate = String(payload.competitionEndDate ?? "").trim();
      const yearCheck = competitionTournamentYear(startDate, endDate);
      if (yearCheck.error) return NextResponse.json({ error: yearCheck.error }, { status: 400 });

      if (payload.reminder?.enabled) {
        const scheduledFor = new Date(String(payload.reminder.scheduledFor ?? ""));
        const channel = String(payload.reminder.channel ?? "") as ReminderChannel;
        const messageTemplate = String(payload.reminder.messageTemplate ?? "").trim();
        const competitionStartsAt = new Date(String(payload.startsAt ?? ""));
        if (
          Number.isNaN(scheduledFor.getTime()) ||
          scheduledFor.getTime() <= Date.now() ||
          Number.isNaN(competitionStartsAt.getTime()) ||
          scheduledFor >= competitionStartsAt
        ) {
          return NextResponse.json({ error: "Le rappel doit être planifié dans le futur et avant le début de la compétition." }, { status: 400 });
        }
        if (!REMINDER_CHANNELS.includes(channel)) {
          return NextResponse.json({ error: "Canal de rappel invalide." }, { status: 400 });
        }
        if (!messageTemplate) {
          return NextResponse.json({ error: "Le texte du rappel est obligatoire." }, { status: 400 });
        }
      }
    }

    const [groupsRes, membersRes, guardiansRes] = await Promise.all([
      supabaseAdmin
        .from("coach_groups")
        .select("id,name,club_id,head_coach_user_id")
        .in("club_id", ctx.clubIds)
        .neq("name", "__ARCHIVE_HISTORIQUE__")
        .not("club_season_id", "is", null)
        .eq("is_active", true),
      supabaseAdmin
        .from("club_members")
        .select("club_id,user_id,role")
        .in("club_id", ctx.clubIds)
        .eq("is_active", true)
        .in("role", ["player", "coach", "parent"]),
      supabaseAdmin.from("player_guardians").select("player_id,guardian_user_id").or("can_view.is.null,can_view.eq.true"),
    ]);

    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
    if (guardiansRes.error) return NextResponse.json({ error: guardiansRes.error.message }, { status: 400 });

    const groups = (groupsRes.data ?? []) as Array<{ id: string; name: string | null; club_id: string; head_coach_user_id: string | null }>;
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const allGroupIds = uniq(groups.map((g) => g.id));

    const [groupPlayersRes, groupCoachesRes] = await Promise.all([
      allGroupIds.length > 0
        ? supabaseAdmin.from("coach_group_players").select("group_id,player_user_id").in("group_id", allGroupIds)
        : Promise.resolve({ data: [], error: null } as any),
      allGroupIds.length > 0
        ? supabaseAdmin.from("coach_group_coaches").select("group_id,coach_user_id").in("group_id", allGroupIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (groupPlayersRes.error) return NextResponse.json({ error: groupPlayersRes.error.message }, { status: 400 });
    if (groupCoachesRes.error) return NextResponse.json({ error: groupCoachesRes.error.message }, { status: 400 });

    let targetGroupIds =
      payload.groupTarget.mode === "all"
        ? allGroupIds
        : uniq((payload.groupTarget.ids ?? []).filter((id) => groupById.has(id)));

    const groupPlayersMap = new Map<string, Set<string>>();
    ((groupPlayersRes.data ?? []) as Array<{ group_id: string; player_user_id: string }>).forEach((r) => {
      if (!groupPlayersMap.has(r.group_id)) groupPlayersMap.set(r.group_id, new Set());
      groupPlayersMap.get(r.group_id)!.add(r.player_user_id);
    });

    const groupCoachesMap = new Map<string, Set<string>>();
    ((groupCoachesRes.data ?? []) as Array<{ group_id: string; coach_user_id: string }>).forEach((r) => {
      if (!groupCoachesMap.has(r.group_id)) groupCoachesMap.set(r.group_id, new Set());
      groupCoachesMap.get(r.group_id)!.add(r.coach_user_id);
    });
    groups.forEach((g) => {
      if (!groupCoachesMap.has(g.id)) groupCoachesMap.set(g.id, new Set());
      if (g.head_coach_user_id) groupCoachesMap.get(g.id)!.add(g.head_coach_user_id);
    });

    const members = (membersRes.data ?? []) as Array<{
      club_id: string;
      user_id: string;
      role: "player" | "coach" | "parent";
    }>;

    const roleByClub: Record<string, { players: Set<string>; coaches: Set<string>; parents: Set<string> }> = {};
    members.forEach((m) => {
      if (!roleByClub[m.club_id]) {
        roleByClub[m.club_id] = { players: new Set(), coaches: new Set(), parents: new Set() };
      }
      if (m.role === "player") roleByClub[m.club_id].players.add(m.user_id);
      if (m.role === "coach") roleByClub[m.club_id].coaches.add(m.user_id);
      if (m.role === "parent") roleByClub[m.club_id].parents.add(m.user_id);
    });

    const selectedPlayers = new Set(uniq(payload.playerTarget.ids ?? []));
    const selectedCoaches = new Set(uniq(payload.coachTarget.ids ?? []));
    const selectedParents = new Set(uniq(payload.parentTarget.ids ?? []));

    if (isCompetition) targetGroupIds = [];

    // Direct selections are supported even when people belong to different
    // groups. We create an activity-only group so existing event, attendance
    // and evaluation permissions keep their group-based invariant.
    if (targetGroupIds.length === 0 && selectedPlayers.size > 0 && (selectedCoaches.size > 0 || isCompetition)) {
      const compatibleClubIds = ctx.clubIds.filter((clubId) => {
        if (isCompetition && clubId !== competitionClubId) return false;
        const roles = roleByClub[clubId];
        if (!roles) return false;
        return (
          Array.from(selectedPlayers).every((id) => roles.players.has(id)) &&
          Array.from(selectedCoaches).every((id) => roles.coaches.has(id))
        );
      });
      if (compatibleClubIds.length !== 1) {
        return NextResponse.json({ error: "Les joueurs et coachs sélectionnés doivent appartenir à un seul club." }, { status: 400 });
      }

      const clubId = compatibleClubIds[0];
      const supportGroupName = isCompetition
        ? `Compétition · ${String(payload.title ?? "").trim()}`
        : "Groupe spécifique";
      const supportGroupIns = await supabaseAdmin
        .from("coach_groups")
        .insert({
          club_id: clubId,
          club_season_id: null,
          name: supportGroupName,
          is_active: true,
          head_coach_user_id: Array.from(selectedCoaches)[0] ?? null,
        })
        .select("id,club_id,head_coach_user_id")
        .single();
      if (supportGroupIns.error || !supportGroupIns.data) {
        throw new Error(supportGroupIns.error?.message ?? "Could not create the activity group");
      }

      const supportGroup = { ...(supportGroupIns.data as { id: string; club_id: string; head_coach_user_id: string | null }), name: supportGroupName };
      const playersIns = await supabaseAdmin
        .from("coach_group_players")
        .insert(Array.from(selectedPlayers).map((player_user_id) => ({ group_id: supportGroup.id, player_user_id })));
      const coachesIns = selectedCoaches.size > 0
        ? await supabaseAdmin.from("coach_group_coaches").insert(Array.from(selectedCoaches).map((coach_user_id) => ({ group_id: supportGroup.id, coach_user_id, is_head: coach_user_id === supportGroup.head_coach_user_id })))
        : ({ error: null } as const);
      if (playersIns.error || coachesIns.error) {
        await supabaseAdmin.from("coach_groups").delete().eq("id", supportGroup.id);
        throw new Error(playersIns.error?.message ?? coachesIns.error?.message ?? "Could not assign activity participants");
      }

      targetGroupIds = [supportGroup.id];
      groupById.set(supportGroup.id, supportGroup);
      groupPlayersMap.set(supportGroup.id, new Set(selectedPlayers));
      groupCoachesMap.set(supportGroup.id, new Set(selectedCoaches));
    }

    if (targetGroupIds.length === 0) return NextResponse.json({ error: "Aucun groupe ou joueur sélectionné." }, { status: 400 });

    const guardiansByPlayer = new Map<string, Set<string>>();
    ((guardiansRes.data ?? []) as Array<{ player_id: string; guardian_user_id: string }>).forEach((r) => {
      if (!guardiansByPlayer.has(r.player_id)) guardiansByPlayer.set(r.player_id, new Set());
      guardiansByPlayer.get(r.player_id)!.add(r.guardian_user_id);
    });

    const nowIso = new Date().toISOString();

    const createdEvents: string[] = [];
    const createdSeries: string[] = [];
    const attendeeRows: Array<{ event_id: string; player_id: string; status: "present" | "expected" }> = [];
    const coachRows: Array<{ event_id: string; coach_id: string }> = [];

    const duration = Math.max(1, Number(payload.durationMinutes ?? 60));

    const createOneEvent = async (groupId: string, startsAtIso: string, endsAtIso: string, seriesId: string | null) => {
      const group = groupById.get(groupId);
      if (!group) return;

      const eventIns = await supabaseAdmin
        .from("club_events")
        .insert({
          group_id: group.id,
          club_id: group.club_id,
          event_type: payload.eventType,
          title: String(payload.title ?? "").trim() || (group.name === "Groupe spécifique" ? "Activité spécifique" : null),
          starts_at: startsAtIso,
          ends_at: endsAtIso,
          duration_minutes: Math.min(duration, 240),
          location_text: String(payload.locationText ?? "").trim() || null,
          coach_note: String(payload.coachNote ?? "").trim() || null,
          competition_level: isCompetition ? competitionLevel : null,
          competition_category: isCompetition ? competitionCategory : null,
          external_registration_url: isCompetition ? externalRegistrationUrl || null : null,
          competition_note: isCompetition ? competitionNote || null : null,
          series_id: seriesId,
          created_by: ctx.callerId,
          status: "scheduled",
          requires_evaluation: Boolean(payload.requiresEvaluation),
        })
        .select("id")
        .single();

      if (eventIns.error) throw new Error(eventIns.error.message);
      const eventId = String(eventIns.data.id);
      createdEvents.push(eventId);

      const evaluationCriterionIds = uniq(Array.isArray(payload.evaluationCriterionIds) ? payload.evaluationCriterionIds : []);
      if (Boolean(payload.requiresEvaluation) && evaluationCriterionIds.length) {
        if (evaluationCriterionIds.length > 3) throw new Error("Trois critères personnalisés maximum par activité.");
        const links = await supabaseAdmin.from("club_event_evaluation_criteria").insert(evaluationCriterionIds.map((criterionId, index) => ({ event_id: eventId, criterion_id: criterionId, position: index + 1 })));
        if (links.error) throw new Error(links.error.message);
      }

      const groupPlayers = groupPlayersMap.get(groupId) ?? new Set<string>();
      const groupCoaches = groupCoachesMap.get(groupId) ?? new Set<string>();
      const clubRoles = roleByClub[group.club_id] ?? { players: new Set<string>(), coaches: new Set<string>(), parents: new Set<string>() };

      const playerTargetIds = new Set<string>();
      if (payload.playerTarget.mode === "all") {
        groupPlayers.forEach((id) => playerTargetIds.add(id));
      } else if (payload.playerTarget.mode === "selected") {
        selectedPlayers.forEach((id) => {
          if (groupPlayers.has(id)) playerTargetIds.add(id);
        });
      }

      const coachTargetIds = new Set<string>();
      if (payload.coachTarget.mode === "all") {
        clubRoles.coaches.forEach((id) => coachTargetIds.add(id));
      } else if (payload.coachTarget.mode === "selected") {
        selectedCoaches.forEach((id) => {
          if (groupCoaches.has(id)) coachTargetIds.add(id);
        });
      } else {
        groupCoaches.forEach((id) => coachTargetIds.add(id));
      }

      const parentTargetIds = new Set<string>();
      if (payload.parentTarget.mode === "all") {
        clubRoles.parents.forEach((id) => parentTargetIds.add(id));
      } else if (payload.parentTarget.mode === "selected") {
        selectedParents.forEach((id) => {
          if (clubRoles.parents.has(id)) parentTargetIds.add(id);
        });
      }

      // If parents were explicitly targeted by player selection, include linked guardians.
      if (payload.parentTarget.mode !== "none") {
        playerTargetIds.forEach((pid) => {
          const linked = guardiansByPlayer.get(pid);
          if (!linked) return;
          linked.forEach((gid) => {
            if (clubRoles.parents.has(gid)) parentTargetIds.add(gid);
          });
        });
      }

      if (isCompetition) {
        playerTargetIds.forEach((pid) => {
          const linked = guardiansByPlayer.get(pid);
          if (!linked) return;
          linked.forEach((guardianId) => {
            if (clubRoles.parents.has(guardianId)) parentTargetIds.add(guardianId);
          });
        });
      }

      playerTargetIds.forEach((id) => attendeeRows.push({
        event_id: eventId,
        player_id: id,
        status: isCompetition ? "expected" : "present",
      }));
      coachTargetIds.forEach((id) => coachRows.push({ event_id: eventId, coach_id: id }));

      if (!isCompetition) {
        parentTargetIds.forEach((id) => attendeeRows.push({ event_id: eventId, player_id: id, status: "present" }));
      }

      // Best-effort notifications for attendees (players + targeted parents).
      // Do not fail event creation if notification delivery fails.
      try {
        await createEventNotification(
          supabaseAdmin,
          ctx.callerId,
          eventId,
          payload.eventType,
          startsAtIso,
          endsAtIso,
          String(payload.locationText ?? "").trim() || null,
          [...playerTargetIds, ...parentTargetIds],
          String(payload.title ?? "").trim() || null,
        );
      } catch {
        // silent: activity creation must remain successful even if notifications fail
      }
    };

    if (payload.mode === "single") {
      const startsAt = new Date(String(payload.startsAt ?? ""));
      if (Number.isNaN(startsAt.getTime())) return NextResponse.json({ error: "Invalid startsAt" }, { status: 400 });

      let endsAt = new Date(String(payload.endsAt ?? ""));
      if (payload.eventType === "training") {
        endsAt = new Date(startsAt.getTime() + duration * 60000);
      } else if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
        return NextResponse.json({ error: "Invalid endsAt" }, { status: 400 });
      }

      for (const groupId of targetGroupIds) {
        await createOneEvent(groupId, startsAt.toISOString(), endsAt.toISOString(), null);
      }
    } else {
      const s = payload.series;
      if (!s) return NextResponse.json({ error: "Missing series payload" }, { status: 400 });
      if (s.endDate < s.startDate) return NextResponse.json({ error: "Invalid series dates" }, { status: 400 });

      for (const groupId of targetGroupIds) {
        const group = groupById.get(groupId);
        if (!group) continue;

        const seriesIns = await supabaseAdmin
          .from("club_event_series")
          .insert({
            group_id: group.id,
            club_id: group.club_id,
            event_type: payload.eventType,
            title: String(payload.title ?? "").trim() || null,
            location_text: String(payload.locationText ?? "").trim() || null,
            coach_note: String(payload.coachNote ?? "").trim() || null,
            duration_minutes: duration,
            weekday: s.weekday,
            time_of_day: s.timeOfDay.length === 5 ? `${s.timeOfDay}:00` : s.timeOfDay,
            interval_weeks: Math.max(1, Number(s.intervalWeeks ?? 1)),
            start_date: s.startDate,
            end_date: s.endDate,
            is_active: true,
            created_by: ctx.callerId,
          })
          .select("id")
          .single();
        if (seriesIns.error) throw new Error(seriesIns.error.message);
        const seriesId = String(seriesIns.data.id);
        createdSeries.push(seriesId);

        const startLocal = new Date(`${s.startDate}T00:00:00`);
        const endLocal = new Date(`${s.endDate}T23:59:59`);
        const first = nextWeekdayOnOrAfter(startLocal, s.weekday);

        let cursor = first;
        let count = 0;
        while (cursor <= endLocal && count < 80) {
          const start = parseLocalDateTime(toYMD(cursor), s.timeOfDay);
          const end = new Date(start.getTime() + duration * 60000);
          await createOneEvent(groupId, start.toISOString(), end.toISOString(), seriesId);
          cursor = addDays(cursor, Math.max(1, Number(s.intervalWeeks ?? 1)) * 7);
          count += 1;
        }
      }
    }

    if (attendeeRows.length > 0) {
      const attendeeIns = await supabaseAdmin.from("club_event_attendees").upsert(attendeeRows, {
        onConflict: "event_id,player_id",
      });
      if (attendeeIns.error) throw new Error(attendeeIns.error.message);
    }

    if (coachRows.length > 0) {
      const coachIns = await supabaseAdmin.from("club_event_coaches").upsert(coachRows, {
        onConflict: "event_id,coach_id",
      });
      if (coachIns.error) throw new Error(coachIns.error.message);
    }

    if (isCompetition && payload.reminder?.enabled && createdEvents[0]) {
      const reminderIns = await supabaseAdmin.from("club_event_reminders").insert({
        event_id: createdEvents[0],
        scheduled_for: new Date(String(payload.reminder.scheduledFor)).toISOString(),
        channel: payload.reminder.channel,
        message_template: String(payload.reminder.messageTemplate ?? "").trim(),
        status: "pending",
        created_by: ctx.callerId,
      });
      if (reminderIns.error) {
        console.error("Competition reminder creation failed", reminderIns.error.message);
      }
    }

    return NextResponse.json({
      ok: true,
      createdEvents: createdEvents.length,
      createdSeries: createdSeries.length,
      firstEventId: createdEvents[0] ?? null,
      at: nowIso,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
