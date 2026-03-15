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
type GroupRow = { id: string; name: string | null; club_id: string; is_active: boolean | null };
type EventLite = {
  id: string;
  group_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  status: "scheduled" | "cancelled";
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
          messagesCount: 0,
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

    const [clubsRes, membersRes, groupsRes] = await Promise.all([
      supabaseAdmin.from("clubs").select("id,name").in("id", clubIds),
      supabaseAdmin
        .from("club_members")
        .select("club_id,user_id,role,is_active")
        .in("club_id", clubIds),
      supabaseAdmin.from("coach_groups").select("id,name,club_id,is_active").in("club_id", clubIds),
    ]);
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });
    if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });

    const clubs = (clubsRes.data ?? []) as ManagedClub[];
    const allMembers = (membersRes.data ?? []) as Array<{
      club_id: string | null;
      user_id: string | null;
      role: "manager" | "coach" | "player" | "parent";
      is_active: boolean | null;
    }>;
    const groups = (groupsRes.data ?? []) as GroupRow[];

    const uniqueUsers = new Set(allMembers.map((m) => String(m.user_id ?? "").trim()).filter(Boolean));
    const activeMembers = allMembers.filter((m) => Boolean(m.is_active));
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

    const profileIds = uniq(allMembers.map((m) => m.user_id));
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

    const activePlayerIds = uniq(activeMembers.filter((m) => m.role === "player").map((m) => m.user_id));
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
    const juniorsWithoutParent = activePlayerIds
      .filter((pid) => !linkedPlayers.has(pid))
      .map((pid) => ({
        id: pid,
        first_name: (profileById.get(pid)?.first_name ?? null) as string | null,
        last_name: (profileById.get(pid)?.last_name ?? null) as string | null,
      }))
      .sort((a, b) => `${a.last_name ?? ""} ${a.first_name ?? ""}`.localeCompare(`${b.last_name ?? ""} ${b.first_name ?? ""}`, "fr"));

    const groupNameById: Record<string, string> = {};
    groups.forEach((g) => {
      groupNameById[g.id] = String(g.name ?? "").trim() || "Groupe";
    });
    const archivedGroups = groups.filter((g) => String(g.name ?? "").trim() === "__ARCHIVE_HISTORIQUE__");
    const activeGroups = groups.filter((g) => Boolean(g.is_active) && String(g.name ?? "").trim() !== "__ARCHIVE_HISTORIQUE__");
    const planningGroupIds = activeGroups.map((g) => g.id);

    let plannedEventsCount = 0;
    let pastEventsCount = 0;
    let trainingsCount = 0;
    let topAttendance: Array<{ player_id: string; name: string; present: number; total: number; rate: number }> = [];
    let upcomingEvents: EventLite[] = [];
    const nowIso = new Date().toISOString();

    if (planningGroupIds.length > 0) {
      const sinceDate = new Date();
      if (assiduityWindow === "30d") sinceDate.setDate(sinceDate.getDate() - 30);
      else if (assiduityWindow === "90d") sinceDate.setDate(sinceDate.getDate() - 90);
      else if (assiduityWindow === "1y") sinceDate.setFullYear(sinceDate.getFullYear() - 1);
      else sinceDate.setMonth(sinceDate.getMonth() - 6);
      const sinceDateIso = sinceDate.toISOString();

      const [plannedCountRes, pastCountRes, trainingsCountRes, assiduityEventsRes, upcomingRes] = await Promise.all([
        supabaseAdmin.from("club_events").select("id", { count: "exact", head: true }).in("group_id", planningGroupIds).eq("status", "scheduled").gte("starts_at", nowIso),
        supabaseAdmin.from("club_events").select("id", { count: "exact", head: true }).in("group_id", planningGroupIds).eq("status", "scheduled").lt("starts_at", nowIso),
        supabaseAdmin.from("club_events").select("id", { count: "exact", head: true }).in("group_id", planningGroupIds).eq("status", "scheduled").eq("event_type", "training").gte("starts_at", nowIso),
        supabaseAdmin
          .from("club_events")
          .select("id")
          .in("group_id", planningGroupIds)
          .eq("status", "scheduled")
          .lt("starts_at", nowIso)
          .gte("starts_at", sinceDateIso)
          .order("starts_at", { ascending: false })
          .limit(2000),
        supabaseAdmin
          .from("club_events")
          .select("id,group_id,event_type,starts_at,ends_at,location_text,status")
          .in("group_id", planningGroupIds)
          .eq("status", "scheduled")
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(10),
      ]);
      if (plannedCountRes.error) return NextResponse.json({ error: plannedCountRes.error.message }, { status: 400 });
      if (pastCountRes.error) return NextResponse.json({ error: pastCountRes.error.message }, { status: 400 });
      if (trainingsCountRes.error) return NextResponse.json({ error: trainingsCountRes.error.message }, { status: 400 });
      if (assiduityEventsRes.error) return NextResponse.json({ error: assiduityEventsRes.error.message }, { status: 400 });
      if (upcomingRes.error) return NextResponse.json({ error: upcomingRes.error.message }, { status: 400 });

      plannedEventsCount = plannedCountRes.count ?? 0;
      pastEventsCount = pastCountRes.count ?? 0;
      trainingsCount = trainingsCountRes.count ?? 0;
      upcomingEvents = (upcomingRes.data ?? []) as EventLite[];

      const assiduityEventIds = uniq(((assiduityEventsRes.data ?? []) as Array<{ id: string | null }>).map((r) => r.id));
      if (assiduityEventIds.length > 0) {
        const attendanceRes = await supabaseAdmin
          .from("club_event_attendees")
          .select("player_id,status")
          .in("event_id", assiduityEventIds);
        if (attendanceRes.error) return NextResponse.json({ error: attendanceRes.error.message }, { status: 400 });

        const counters = new Map<string, { present: number; total: number }>();
        ((attendanceRes.data ?? []) as Array<{ player_id: string; status: string | null }>).forEach((row) => {
          const playerId = String(row.player_id ?? "").trim();
          if (!playerId) return;
          if (row.status !== "present" && row.status !== "absent" && row.status !== "excused") return;
          const current = counters.get(playerId) ?? { present: 0, total: 0 };
          current.total += 1;
          if (row.status === "present") current.present += 1;
          counters.set(playerId, current);
        });

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

    const [threadsRes, activeMembersAllRes, notifActorsRes] = await Promise.all([
      supabaseAdmin.from("message_threads").select("id").in("organization_id", clubIds),
      supabaseAdmin.from("club_members").select("user_id").in("club_id", clubIds).eq("is_active", true),
      supabaseAdmin.from("notifications").select("id", { count: "exact", head: true }).in("actor_user_id", uniq(activeMembers.map((m) => m.user_id))),
    ]);
    if (threadsRes.error) return NextResponse.json({ error: threadsRes.error.message }, { status: 400 });
    if (activeMembersAllRes.error) return NextResponse.json({ error: activeMembersAllRes.error.message }, { status: 400 });
    if (notifActorsRes.error) return NextResponse.json({ error: notifActorsRes.error.message }, { status: 400 });

    const threadIds = uniq(((threadsRes.data ?? []) as Array<{ id: string | null }>).map((r) => r.id));
    let messagesCount = 0;
    if (threadIds.length > 0) {
      const msgCountRes = await supabaseAdmin.from("thread_messages").select("id", { count: "exact", head: true }).in("thread_id", threadIds);
      if (msgCountRes.error) return NextResponse.json({ error: msgCountRes.error.message }, { status: 400 });
      messagesCount = msgCountRes.count ?? 0;
    }

    return NextResponse.json({
      me,
      groupNameById,
      upcomingEvents,
      stats: {
        clubsCount: clubs.length,
        usersCount: uniqueUsers.size,
        activeUsersCount: activeUserIds.size,
        inactiveMemberships: allMembers.filter((m) => m.is_active === false).length,
        groupsCount: groups.length,
        activeGroupsCount: activeGroups.length,
        archivedGroupsCount: archivedGroups.length,
        playersCount: roleSetByUser.player.size,
        parentsCount: roleSetByUser.parent.size,
        juniorsWithoutParentCount: juniorsWithoutParent.length,
        usersWithoutUsernameCount,
        messagesCount,
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
