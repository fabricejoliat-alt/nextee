import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

type EventType = "training" | "interclub" | "camp" | "session" | "event";
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

    const memberRows = (membersRes.data ?? []) as Array<{
      club_id: string;
      user_id: string;
      role: "player" | "coach" | "parent";
      is_active: boolean;
    }>;

    const userIds = uniq(memberRows.map((r) => r.user_id));
    const headCoachIds = uniq(groups.map((g) => String(g.head_coach_user_id ?? "")));
    const profileIds = uniq([...userIds, ...headCoachIds]);

    let profileById = new Map<string, { first_name: string | null; last_name: string | null }>();
    if (profileIds.length > 0) {
      const profilesRes = await supabaseAdmin.from("profiles").select("id,first_name,last_name").in("id", profileIds);
      if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
      profileById = new Map(
        (profilesRes.data ?? []).map((p: any) => [
          String(p.id),
          {
            first_name: (p.first_name ?? null) as string | null,
            last_name: (p.last_name ?? null) as string | null,
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

    const usersByRole: Record<"player" | "coach" | "parent", Array<{ id: string; club_id: string; name: string }>> = {
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
      const key = `${row.role}:${row.user_id}`;
      if (seenByRole[row.role].has(key)) continue;
      seenByRole[row.role].add(key);
      usersByRole[row.role].push({
        id: row.user_id,
        club_id: row.club_id,
        name: fullName(row.user_id),
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

    return NextResponse.json({
      clubs: clubsRes.data ?? [],
      groups: groupsOut,
      players: usersByRole.player.sort((a, b) => a.name.localeCompare(b.name, "fr-CH")),
      coaches: usersByRole.coach.sort((a, b) => a.name.localeCompare(b.name, "fr-CH")),
      parents: usersByRole.parent.sort((a, b) => a.name.localeCompare(b.name, "fr-CH")),
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

    const [groupsRes, membersRes, guardiansRes] = await Promise.all([
      supabaseAdmin
        .from("coach_groups")
        .select("id,name,club_id,head_coach_user_id")
        .in("club_id", ctx.clubIds)
        .neq("name", "__ARCHIVE_HISTORIQUE__")
        .eq("is_active", true),
      supabaseAdmin
        .from("club_members")
        .select("club_id,user_id,role")
        .in("club_id", ctx.clubIds)
        .eq("is_active", true)
        .in("role", ["player", "coach", "parent"]),
      supabaseAdmin.from("player_guardians").select("player_id,guardian_user_id").eq("can_view", true),
    ]);

    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
    if (guardiansRes.error) return NextResponse.json({ error: guardiansRes.error.message }, { status: 400 });

    const groups = (groupsRes.data ?? []) as Array<{ id: string; club_id: string; head_coach_user_id: string | null }>;
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

    if (targetGroupIds.length === 0) {
      return NextResponse.json({ error: "No target groups selected" }, { status: 400 });
    }

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

    const guardiansByPlayer = new Map<string, Set<string>>();
    ((guardiansRes.data ?? []) as Array<{ player_id: string; guardian_user_id: string }>).forEach((r) => {
      if (!guardiansByPlayer.has(r.player_id)) guardiansByPlayer.set(r.player_id, new Set());
      guardiansByPlayer.get(r.player_id)!.add(r.guardian_user_id);
    });

    const nowIso = new Date().toISOString();

    const createdEvents: string[] = [];
    const createdSeries: string[] = [];
    const attendeeRows: Array<{ event_id: string; player_id: string; status: "present" }> = [];
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
          title: String(payload.title ?? "").trim() || null,
          starts_at: startsAtIso,
          ends_at: endsAtIso,
          duration_minutes: Math.min(duration, 240),
          location_text: String(payload.locationText ?? "").trim() || null,
          coach_note: String(payload.coachNote ?? "").trim() || null,
          series_id: seriesId,
          created_by: ctx.callerId,
          status: "scheduled",
        })
        .select("id")
        .single();

      if (eventIns.error) throw new Error(eventIns.error.message);
      const eventId = String(eventIns.data.id);
      createdEvents.push(eventId);

      const groupPlayers = groupPlayersMap.get(groupId) ?? new Set<string>();
      const groupCoaches = groupCoachesMap.get(groupId) ?? new Set<string>();
      const clubRoles = roleByClub[group.club_id] ?? { players: new Set<string>(), coaches: new Set<string>(), parents: new Set<string>() };

      let playerTargetIds = new Set<string>();
      if (payload.playerTarget.mode === "all") {
        groupPlayers.forEach((id) => playerTargetIds.add(id));
      } else if (payload.playerTarget.mode === "selected") {
        selectedPlayers.forEach((id) => {
          if (groupPlayers.has(id)) playerTargetIds.add(id);
        });
      }

      let coachTargetIds = new Set<string>();
      if (payload.coachTarget.mode === "all") {
        clubRoles.coaches.forEach((id) => coachTargetIds.add(id));
      } else if (payload.coachTarget.mode === "selected") {
        selectedCoaches.forEach((id) => {
          if (clubRoles.coaches.has(id)) coachTargetIds.add(id);
        });
      } else {
        groupCoaches.forEach((id) => coachTargetIds.add(id));
      }

      let parentTargetIds = new Set<string>();
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

      playerTargetIds.forEach((id) => attendeeRows.push({ event_id: eventId, player_id: id, status: "present" }));
      coachTargetIds.forEach((id) => coachRows.push({ event_id: eventId, coach_id: id }));

      parentTargetIds.forEach((id) => attendeeRows.push({ event_id: eventId, player_id: id, status: "present" }));
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
