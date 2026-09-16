import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

type ManagedClub = { id: string; name: string | null };
type ProfileLite = {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};
type GroupRow = { id: string; name: string | null; club_id: string; club_season_id: string | null; is_active: boolean | null; head_coach_user_id: string | null };
type EventLite = {
  id: string;
  group_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | "competition";
  title?: string | null;
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  status: "scheduled" | "cancelled";
  label?: string;
  href?: string;
};
type MemberRow = {
  club_id: string | null;
  user_id: string | null;
  role: "manager" | "coach" | "player" | "parent";
  is_active: boolean | null;
  player_course_track: string | null;
};

function fullName(first: string | null | undefined, last: string | null | undefined) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const callerId = callerData.user.id;
    const windowParam = String(new URL(req.url).searchParams.get("window") ?? "6m").trim() as "30d" | "90d" | "6m" | "1y";
    const assiduityWindow = windowParam === "30d" || windowParam === "90d" || windowParam === "1y" ? windowParam : "6m";

    const [meRes, membershipsRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("first_name,last_name,avatar_url").eq("id", callerId).maybeSingle(),
      supabaseAdmin
        .from("club_members")
        .select("club_id")
        .eq("user_id", callerId)
        .eq("role", "manager")
        .eq("is_active", true),
    ]);

    const me = !meRes.error && meRes.data ? (meRes.data as ProfileLite) : null;
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const clubIds = uniq((membershipsRes.data ?? []).map((m: any) => m?.club_id));
    if (clubIds.length === 0) {
      return NextResponse.json({
        me,
        groupNameById: {},
        upcomingEvents: [],
        stats: {
          clubsCount: 0,
          usersCount: 0,
          activeUsersCount: 0,
          inactiveMemberships: 0,
          groupsCount: 0,
          activeGroupsCount: 0,
          archivedGroupsCount: 0,
          playersCount: 0,
          parentsCount: 0,
          juniorsWithoutParentCount: 0,
          usersWithoutUsernameCount: 0,
          groupsWithoutHeadCoachCount: 0,
          pendingAttendanceCount: 0,
          activitiesAwaitingCoachEvaluationCount: 0,
          unreadNotificationsCount: 0,
          trainingsCount: 0,
          girlsCount: 0,
          boysCount: 0,
          juniorsAverageAge: null,
          plannedEventsCount: 0,
          pastEventsCount: 0,
          roleCounts: { manager: 0, coach: 0, player: 0, parent: 0 },
          juniorsWithoutParent: [],
          topAttendance: [],
        },
      });
    }

    const [clubsRes, membersRes, groupsRes, adminsRes, seasonsRes] = await Promise.all([
      supabaseAdmin.from("clubs").select("id,name").in("id", clubIds),
      supabaseAdmin
        .from("club_members")
        .select("club_id,user_id,role,is_active,player_course_track")
        .in("club_id", clubIds),
      supabaseAdmin.from("coach_groups").select("id,name,club_id,club_season_id,is_active,head_coach_user_id").in("club_id", clubIds),
      supabaseAdmin.from("app_admins").select("user_id"),
      supabaseAdmin.from("club_seasons").select("id,club_id,is_current,starts_on").in("club_id", clubIds).order("starts_on", { ascending: false }),
    ]);
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (adminsRes.error) return NextResponse.json({ error: adminsRes.error.message }, { status: 400 });
    if (seasonsRes.error) return NextResponse.json({ error: seasonsRes.error.message }, { status: 400 });

    const clubs = (clubsRes.data ?? []) as ManagedClub[];
    const allMembers = (membersRes.data ?? []) as MemberRow[];
    const allGroups = (groupsRes.data ?? []) as GroupRow[];
    const seasons = (seasonsRes.data ?? []) as Array<{ id: string; club_id: string; is_current: boolean; starts_on: string }>;
    const seasonByClub = new Map<string, string>();
    for (const season of seasons) {
      if (!seasonByClub.has(season.club_id) || season.is_current) seasonByClub.set(season.club_id, season.id);
    }
    const groups = allGroups.filter((group) => {
      const selectedSeason = seasonByClub.get(group.club_id);
      return !selectedSeason || group.club_season_id === selectedSeason;
    });

    const superadminIds = new Set((adminsRes.data ?? []).map((row: any) => String(row.user_id ?? "").trim()).filter(Boolean));
    const countedMembers = allMembers.filter((m) => !superadminIds.has(String(m.user_id ?? "").trim()));
    const uniqueUsers = new Set(countedMembers.map((m) => String(m.user_id ?? "").trim()).filter(Boolean));
    const activeMembers = countedMembers.filter((m) => Boolean(m.is_active));
    const activeUserIds = new Set(activeMembers.map((m) => String(m.user_id ?? "").trim()).filter(Boolean));

    const roleSetByUser: Record<"manager" | "coach" | "player" | "parent", Set<string>> = {
      manager: new Set<string>(),
      coach: new Set<string>(),
      player: new Set<string>(),
      parent: new Set<string>(),
    };
    activeMembers.forEach((m) => {
      if (m.role === "manager" || m.role === "coach" || m.role === "player" || m.role === "parent") {
        roleSetByUser[m.role].add(String(m.user_id ?? "").trim());
      }
    });

    const profileIds = uniq(countedMembers.map((m) => m.user_id));
    const profilesRes =
      profileIds.length > 0
        ? await supabaseAdmin
            .from("profiles")
            .select("id,first_name,last_name,username,sex,birth_date")
            .in("id", profileIds)
        : ({ data: [], error: null } as any);
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });

    const profileById = new Map<string, any>();
    for (const row of profilesRes.data ?? []) profileById.set(String((row as any).id ?? ""), row);

    const usersWithoutUsernameCount = Array.from(activeUserIds).filter((id) => {
      const v = String(profileById.get(id)?.username ?? "").trim();
      return !v;
    }).length;

    const activePlayerMemberships = activeMembers.filter((m) => m.role === "player");
    const activePlayerIds = uniq(activePlayerMemberships.map((m) => m.user_id));
    const normalizeSex = (raw: string | null | undefined) => String(raw ?? "").trim().toLowerCase();
    const computeAge = (birthDate: string | null | undefined) => {
      if (!birthDate) return null;
      const d = new Date(birthDate);
      if (Number.isNaN(d.getTime())) return null;
      const now = new Date();
      let age = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
      return age >= 0 ? age : null;
    };

    const girlsCount = activePlayerIds.filter((id) => {
      const v = normalizeSex(profileById.get(id)?.sex);
      return v === "female" || v === "femme" || v === "f";
    }).length;
    const boysCount = activePlayerIds.filter((id) => {
      const v = normalizeSex(profileById.get(id)?.sex);
      return v === "male" || v === "homme" || v === "m";
    }).length;
    const juniorAges = activePlayerIds
      .map((id) => computeAge(profileById.get(id)?.birth_date))
      .filter((v): v is number => v != null);
    const juniorsAverageAge =
      juniorAges.length > 0 ? Number((juniorAges.reduce((sum, age) => sum + age, 0) / juniorAges.length).toFixed(1)) : null;

    const guardiansRes =
      activePlayerIds.length > 0
        ? await supabaseAdmin
            .from("player_guardians")
            .select("player_id,guardian_user_id")
            .in("player_id", activePlayerIds)
        : ({ data: [], error: null } as any);
    if (guardiansRes.error) return NextResponse.json({ error: guardiansRes.error.message }, { status: 400 });

    const linkedPlayers = new Set<string>();
    for (const row of guardiansRes.data ?? []) {
      const pid = String((row as any).player_id ?? "").trim();
      if (pid) linkedPlayers.add(pid);
    }
    const groupNameById: Record<string, string> = {};
    groups.forEach((g) => {
      groupNameById[g.id] = String(g.name ?? "").trim() || "Groupe";
    });
    const archivedGroups = groups.filter((g) => String(g.name ?? "").trim().startsWith("__ARCHIVE_"));
    const activeGroups = groups.filter((g) => Boolean(g.is_active) && !String(g.name ?? "").trim().startsWith("__ARCHIVE_"));
    const planningGroupIds = activeGroups.map((g) => g.id);

    const groupPlayersRes =
      planningGroupIds.length > 0 && activePlayerIds.length > 0
        ? await supabaseAdmin
            .from("coach_group_players")
            .select("player_user_id")
            .in("group_id", planningGroupIds)
            .in("player_user_id", activePlayerIds)
        : ({ data: [], error: null } as any);
    if (groupPlayersRes.error) return NextResponse.json({ error: groupPlayersRes.error.message }, { status: 400 });

    const playersInActiveGroups = new Set(
      ((groupPlayersRes.data ?? []) as Array<{ player_user_id: string | null }>)
        .map((row) => String(row.player_user_id ?? "").trim())
        .filter(Boolean)
    );

    const eligibleJuniorIds = activePlayerIds.filter((pid) => {
      if (!playersInActiveGroups.has(pid)) return false;
      const age = computeAge(profileById.get(pid)?.birth_date);
      return age == null || age < 18;
    });
    const juniorsWithoutParent = eligibleJuniorIds
      .filter((pid) => !linkedPlayers.has(pid))
      .map((pid) => ({
        id: pid,
        first_name: (profileById.get(pid)?.first_name ?? null) as string | null,
        last_name: (profileById.get(pid)?.last_name ?? null) as string | null,
      }))
      .sort((a, b) => `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(`${b.last_name ?? ""} ${b.first_name ?? ""}`, "fr"));

    let plannedEventsCount = 0;
    let pastEventsCount = 0;
    let trainingsCount = 0;
    let pendingAttendanceCount = 0;
    let activitiesAwaitingCoachEvaluationCount = 0;
    let topAttendance: Array<{ player_id: string; name: string; present: number; total: number; rate: number }> = [];
    let upcomingEvents: EventLite[] = [];
    const nowIso = new Date().toISOString();

    if (clubIds.length > 0) {
      const sinceDate = new Date();
      if (assiduityWindow === "30d") sinceDate.setDate(sinceDate.getDate() - 30);
      else if (assiduityWindow === "90d") sinceDate.setDate(sinceDate.getDate() - 90);
      else if (assiduityWindow === "1y") sinceDate.setFullYear(sinceDate.getFullYear() - 1);
      else sinceDate.setMonth(sinceDate.getMonth() - 6);
      const sinceDateIso = sinceDate.toISOString();

      const groupScopeIds = planningGroupIds.length > 0 ? planningGroupIds : ["00000000-0000-0000-0000-000000000000"];
      const [plannedCountRes, competitionPlannedCountRes, pastCountRes, competitionPastCountRes, trainingsCountRes, assiduityEventsRes, upcomingRes, competitionUpcomingRes] = await Promise.all([
        supabaseAdmin.from("club_events").select("id", { count: "exact", head: true }).in("group_id", groupScopeIds).neq("event_type", "competition").eq("status", "scheduled").gte("starts_at", nowIso),
        supabaseAdmin.from("club_events").select("id", { count: "exact", head: true }).in("club_id", clubIds).eq("event_type", "competition").eq("status", "scheduled").gte("starts_at", nowIso),
        supabaseAdmin.from("club_events").select("id", { count: "exact", head: true }).in("group_id", groupScopeIds).neq("event_type", "competition").eq("status", "scheduled").lt("starts_at", nowIso),
        supabaseAdmin.from("club_events").select("id", { count: "exact", head: true }).in("club_id", clubIds).eq("event_type", "competition").eq("status", "scheduled").lt("starts_at", nowIso),
        supabaseAdmin.from("club_events").select("id", { count: "exact", head: true }).in("group_id", groupScopeIds).eq("status", "scheduled").eq("event_type", "training").gte("starts_at", nowIso),
        supabaseAdmin
          .from("club_events")
          .select("id,requires_evaluation")
          .in("group_id", groupScopeIds)
          .eq("status", "scheduled")
          .neq("event_type", "competition")
          .lt("starts_at", nowIso)
          .gte("starts_at", sinceDateIso)
          .order("starts_at", { ascending: false })
          .limit(2000),
        supabaseAdmin
          .from("club_events")
          .select("id,group_id,event_type,title,starts_at,ends_at,location_text,status")
          .in("group_id", groupScopeIds)
          .neq("event_type", "competition")
          .eq("status", "scheduled")
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(10),
        supabaseAdmin
          .from("club_events")
          .select("id,group_id,event_type,title,starts_at,ends_at,location_text,status")
          .in("club_id", clubIds)
          .eq("event_type", "competition")
          .eq("status", "scheduled")
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(10),
      ]);
      if (plannedCountRes.error) return NextResponse.json({ error: plannedCountRes.error.message }, { status: 400 });
      if (competitionPlannedCountRes.error) return NextResponse.json({ error: competitionPlannedCountRes.error.message }, { status: 400 });
      if (pastCountRes.error) return NextResponse.json({ error: pastCountRes.error.message }, { status: 400 });
      if (competitionPastCountRes.error) return NextResponse.json({ error: competitionPastCountRes.error.message }, { status: 400 });
      if (trainingsCountRes.error) return NextResponse.json({ error: trainingsCountRes.error.message }, { status: 400 });
      if (assiduityEventsRes.error) return NextResponse.json({ error: assiduityEventsRes.error.message }, { status: 400 });
      if (upcomingRes.error) return NextResponse.json({ error: upcomingRes.error.message }, { status: 400 });
      if (competitionUpcomingRes.error) return NextResponse.json({ error: competitionUpcomingRes.error.message }, { status: 400 });

      plannedEventsCount = (plannedCountRes.count ?? 0) + (competitionPlannedCountRes.count ?? 0);
      pastEventsCount = (pastCountRes.count ?? 0) + (competitionPastCountRes.count ?? 0);
      trainingsCount = trainingsCountRes.count ?? 0;
      const combinedUpcomingEvents = [
        ...((upcomingRes.data ?? []) as EventLite[]),
        ...((competitionUpcomingRes.data ?? []) as EventLite[]),
      ];
      upcomingEvents = Array.from(new Map(combinedUpcomingEvents.map((event) => [event.id, event])).values()).map((event) => ({
        ...event,
        label: String(event.title ?? "").trim() || undefined,
        href: event.event_type === "competition" ? `/manager/events/new?event=${event.id}` : undefined,
      })).sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()).slice(0, 10);

      const assiduityEvents = (assiduityEventsRes.data ?? []) as Array<{ id: string | null; requires_evaluation: boolean | null }>;
      const assiduityEventIds = uniq(assiduityEvents.map((r) => r.id));
      if (assiduityEventIds.length > 0) {
        const attendanceRes = await supabaseAdmin
          .from("club_event_attendees")
          .select("event_id,player_id,status")
          .in("event_id", assiduityEventIds);
        if (attendanceRes.error) return NextResponse.json({ error: attendanceRes.error.message }, { status: 400 });

        const counters = new Map<string, { present: number; total: number }>();
        const attendanceRows = (attendanceRes.data ?? []) as Array<{ event_id: string; player_id: string; status: string | null }>;
        attendanceRows.forEach((row) => {
          const playerId = String(row.player_id ?? "").trim();
          if (!playerId) return;
          if (row.status === "expected") pendingAttendanceCount += 1;
          if (row.status !== "present" && row.status !== "absent" && row.status !== "excused") return;
          const current = counters.get(playerId) ?? { present: 0, total: 0 };
          current.total += 1;
          if (row.status === "present") current.present += 1;
          counters.set(playerId, current);
        });

        const evaluationEventIds = uniq(assiduityEvents.filter((event) => event.requires_evaluation).map((event) => event.id));
        if (evaluationEventIds.length > 0) {
          const feedbackRes = await supabaseAdmin
            .from("club_event_coach_feedback")
            .select("event_id,player_id")
            .in("event_id", evaluationEventIds);
          if (feedbackRes.error) return NextResponse.json({ error: feedbackRes.error.message }, { status: 400 });
          const completedPairs = new Set(((feedbackRes.data ?? []) as Array<{ event_id: string; player_id: string }>).map((row) => `${row.event_id}|${row.player_id}`));
          activitiesAwaitingCoachEvaluationCount = evaluationEventIds.filter((eventId) => attendanceRows.some((row) => row.event_id === eventId && row.status !== "absent" && row.status !== "excused" && row.status !== "not_registered" && !completedPairs.has(`${eventId}|${row.player_id}`))).length;
        }

        topAttendance = Array.from(counters.entries())
          .filter(([, c]) => c.total >= 3)
          .map(([player_id, c]) => ({
            player_id,
            name: fullName(profileById.get(player_id)?.first_name, profileById.get(player_id)?.last_name),
            present: c.present,
            total: c.total,
            rate: c.total > 0 ? c.present / c.total : 0,
          }))
          .sort((a, b) => {
            if (b.rate !== a.rate) return b.rate - a.rate;
            if (b.present !== a.present) return b.present - a.present;
            return b.total - a.total;
          })
          .slice(0, 5);
      }
    }

    const scheduledCampsRes = await supabaseAdmin
      .from("club_camps")
      .select("id,title")
      .in("club_id", clubIds)
      .eq("status", "scheduled");
    if (scheduledCampsRes.error) return NextResponse.json({ error: scheduledCampsRes.error.message }, { status: 400 });

    const scheduledCamps = (scheduledCampsRes.data ?? []) as Array<{ id: string; title: string | null }>;
    const campTitleById = new Map(scheduledCamps.map((camp) => [String(camp.id), String(camp.title ?? "").trim() || "Stage/Camp"]));
    const campIds = Array.from(campTitleById.keys());
    const campDaysRes = campIds.length > 0
      ? await supabaseAdmin
          .from("club_camp_days")
          .select("camp_id,event_id")
          .in("camp_id", campIds)
          .gte("starts_at", nowIso)
      : ({ data: [], error: null } as const);
    if (campDaysRes.error) return NextResponse.json({ error: campDaysRes.error.message }, { status: 400 });

    const campIdByEventId = new Map<string, string>();
    for (const day of (campDaysRes.data ?? []) as Array<{ camp_id: string | null; event_id: string | null }>) {
      const campId = String(day.camp_id ?? "").trim();
      const eventId = String(day.event_id ?? "").trim();
      if (campId && eventId) campIdByEventId.set(eventId, campId);
    }
    const campEventIds = Array.from(campIdByEventId.keys());
    const campEventsRes = campEventIds.length > 0
      ? await supabaseAdmin
          .from("club_events")
          .select("id,group_id,event_type,starts_at,ends_at,location_text,status")
          .in("id", campEventIds)
          .eq("status", "scheduled")
          .gte("starts_at", nowIso)
      : ({ data: [], error: null } as const);
    if (campEventsRes.error) return NextResponse.json({ error: campEventsRes.error.message }, { status: 400 });

    const upcomingById = new Map(upcomingEvents.map((event) => [event.id, event]));
    for (const event of (campEventsRes.data ?? []) as EventLite[]) {
      const campId = campIdByEventId.get(String(event.id));
      if (!campId) continue;
      upcomingById.set(String(event.id), {
        ...event,
        event_type: "camp",
        label: campTitleById.get(campId) ?? "Stage/Camp",
        href: `/manager/camps/${campId}`,
      });
    }
    upcomingEvents = Array.from(upcomingById.values())
      .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
      .slice(0, 10);

    const [activeMembersAllRes, notifActorsRes] = await Promise.all([
      supabaseAdmin.from("club_members").select("user_id").in("club_id", clubIds).eq("is_active", true),
      supabaseAdmin.from("notifications").select("id", { count: "exact", head: true }).in("actor_user_id", uniq(activeMembers.map((m) => m.user_id))),
    ]);
    if (activeMembersAllRes.error) return NextResponse.json({ error: activeMembersAllRes.error.message }, { status: 400 });
    if (notifActorsRes.error) return NextResponse.json({ error: notifActorsRes.error.message }, { status: 400 });

    return NextResponse.json({
      me,
      groupNameById,
      upcomingEvents,
      stats: {
        clubsCount: clubs.length,
        usersCount: uniqueUsers.size,
        activeUsersCount: activeUserIds.size,
        inactiveMemberships: countedMembers.filter((m) => m.is_active === false).length,
        groupsCount: groups.length,
        activeGroupsCount: activeGroups.length,
        archivedGroupsCount: archivedGroups.length,
        playersCount: roleSetByUser.player.size,
        parentsCount: roleSetByUser.parent.size,
        juniorsWithoutParentCount: juniorsWithoutParent.length,
        usersWithoutUsernameCount,
        groupsWithoutHeadCoachCount: activeGroups.filter((group) => !group.head_coach_user_id).length,
        pendingAttendanceCount,
        activitiesAwaitingCoachEvaluationCount,
        unreadNotificationsCount: notifActorsRes.count ?? 0,
        trainingsCount,
        girlsCount,
        boysCount,
        juniorsAverageAge,
        plannedEventsCount,
        pastEventsCount,
        roleCounts: {
          manager: roleSetByUser.manager.size,
          coach: roleSetByUser.coach.size,
          player: roleSetByUser.player.size,
          parent: roleSetByUser.parent.size,
        },
        juniorsWithoutParent,
        topAttendance,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
