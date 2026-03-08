import { NextResponse, type NextRequest } from "next/server";
import { isOrgMemberActive, isOrgStaffMember, requireCaller } from "@/app/api/messages/_lib";

type NewThreadBody = {
  organization_id: string;
  thread_type: "organization" | "group" | "event" | "player";
  title?: string;
  group_id?: string | null;
  event_id?: string | null;
  player_id?: string | null;
  is_locked?: boolean;
  participant_user_ids?: string[];
};

async function ensureDefaultPlayerStaffThreads(
  supabaseAdmin: any,
  organizationId: string,
  callerId: string
) {
  const membershipRes = await supabaseAdmin
    .from("club_members")
    .select("role")
    .eq("club_id", organizationId)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (membershipRes.error) return;
  const role = String(membershipRes.data?.role ?? "");
  if (role !== "player") return;

  const [staffRes, guardianRes] = await Promise.all([
    supabaseAdmin
      .from("club_members")
      .select("user_id,role")
      .eq("club_id", organizationId)
      .eq("is_active", true)
      .in("role", ["manager", "coach"]),
    supabaseAdmin
      .from("player_guardians")
      .select("guardian_user_id")
      .eq("player_id", callerId)
      .or("can_view.is.null,can_view.eq.true"),
  ]);
  if (staffRes.error || guardianRes.error) return;

  const staffMembers = (staffRes.data ?? []) as Array<{ user_id: string | null; role: string | null }>;
  const staffIds: string[] = Array.from(
    new Set(staffMembers.map((r) => String(r.user_id ?? "").trim()).filter(Boolean))
  );
  if (staffIds.length === 0) return;
  const coachIds: string[] = Array.from(
    new Set(
      staffMembers
        .filter((r) => String(r.role ?? "") === "coach")
        .map((r) => String(r.user_id ?? "").trim())
        .filter(Boolean)
    )
  );

  const guardianIds: string[] = Array.from(
    new Set((guardianRes.data ?? []).map((r: any) => String((r as any).guardian_user_id ?? "").trim()).filter(Boolean))
  );

  const playerGroupsRes = await supabaseAdmin
    .from("coach_group_players")
    .select("group_id")
    .eq("player_user_id", callerId);
  if (playerGroupsRes.error) return;
  const rawGroupIds = Array.from(
    new Set((playerGroupsRes.data ?? []).map((r: any) => String(r.group_id ?? "").trim()).filter(Boolean))
  );
  let teamCoachIds: string[] = [];
  if (rawGroupIds.length > 0) {
    const [groupCoachesRes, activeCoachMembersRes] = await Promise.all([
      supabaseAdmin
        .from("coach_group_coaches")
        .select("group_id,coach_user_id")
        .in("group_id", rawGroupIds),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("is_active", true)
        .eq("role", "coach"),
    ]);
    if (groupCoachesRes.error || activeCoachMembersRes.error) return;
    const activeCoachIds = new Set(
      (activeCoachMembersRes.data ?? []).map((r: any) => String(r.user_id ?? "").trim()).filter(Boolean)
    );
    teamCoachIds = Array.from(
      new Set(
        (groupCoachesRes.data ?? [])
          .map((r: any) => String(r.coach_user_id ?? "").trim())
          .filter((id: string) => Boolean(id) && activeCoachIds.has(id))
      )
    );
  }

  const threadSelect =
    "id,organization_id,thread_type,title,group_id,event_id,player_id,created_by,is_locked,is_active,created_at,updated_at";
  const existingThreadsRes = await supabaseAdmin
    .from("message_threads")
    .select(`${threadSelect},player_thread_scope`)
    .eq("organization_id", organizationId)
    .eq("thread_type", "player")
    .eq("player_id", callerId)
    .eq("is_active", true)
    .in("created_by", staffIds)
    .eq("player_thread_scope", "direct");
  if (existingThreadsRes.error) return;

  const threadByStaffId = new Map<string, any>();
  for (const t of existingThreadsRes.data ?? []) {
    const sid = String((t as any).created_by ?? "");
    if (!sid) continue;
    const prev = threadByStaffId.get(sid);
    if (!prev) threadByStaffId.set(sid, t);
  }

  for (const staffId of staffIds) {
    if (threadByStaffId.has(staffId)) continue;
    const insertRes = await supabaseAdmin
      .from("message_threads")
      .insert({
        organization_id: organizationId,
        thread_type: "player",
        title: "Discussion",
        player_id: callerId,
        player_thread_scope: "direct",
        created_by: staffId,
        is_locked: false,
        is_active: true,
      })
      .select(threadSelect)
      .single();
    if (!insertRes.error && insertRes.data) {
      threadByStaffId.set(staffId, insertRes.data);
    }
  }

  const participantRows: Array<{ thread_id: string; user_id: string; can_post: boolean }> = [];
  for (const [staffId, thread] of threadByStaffId.entries()) {
    const threadId = String((thread as any).id ?? "");
    if (!threadId) continue;
    participantRows.push({ thread_id: threadId, user_id: callerId, can_post: true });
    participantRows.push({ thread_id: threadId, user_id: staffId, can_post: true });
    for (const gid of guardianIds) {
      participantRows.push({ thread_id: threadId, user_id: gid, can_post: true });
    }
  }
  if (participantRows.length > 0) {
    await supabaseAdmin.from("thread_participants").upsert(participantRows, { onConflict: "thread_id,user_id" });
  }

  // Ensure one staff-only team thread for this player in this organization.
  const existingTeamThreadRes = await supabaseAdmin
    .from("message_threads")
    .select(`${threadSelect},player_thread_scope`)
    .eq("organization_id", organizationId)
    .eq("thread_type", "player")
    .eq("player_id", callerId)
    .eq("is_active", true)
    .eq("player_thread_scope", "team")
    .limit(1)
    .maybeSingle();
  if (existingTeamThreadRes.error) return;

  let teamThreadId = String((existingTeamThreadRes.data as any)?.id ?? "");
  if (!teamThreadId && teamCoachIds.length > 0) {
    const preferredActor = teamCoachIds[0] ?? callerId;
    const insTeamRes = await supabaseAdmin
      .from("message_threads")
      .insert({
        organization_id: organizationId,
        thread_type: "player",
        title: "Fil équipe coachs + joueur + parent(s)",
        player_id: callerId,
        player_thread_scope: "team",
        created_by: preferredActor,
        is_locked: false,
        is_active: true,
      })
      .select("id")
      .single();
    if (insTeamRes.error) return;
    teamThreadId = String((insTeamRes.data as any)?.id ?? "");
  }
  if (!teamThreadId) return;

  const teamParticipantRows: Array<{ thread_id: string; user_id: string; can_post: boolean }> = [
    ...teamCoachIds.map((sid) => ({
      thread_id: teamThreadId,
      user_id: sid,
      can_post: true,
    })),
    { thread_id: teamThreadId, user_id: callerId, can_post: true },
    ...guardianIds.map((gid) => ({
      thread_id: teamThreadId,
      user_id: gid,
      can_post: true,
    })),
  ];
  if (teamParticipantRows.length > 0) {
    await supabaseAdmin.from("thread_participants").upsert(teamParticipantRows, { onConflict: "thread_id,user_id" });
  }
  const existingTeamParticipantsRes = await supabaseAdmin
    .from("thread_participants")
    .select("user_id")
    .eq("thread_id", teamThreadId);
  if (!existingTeamParticipantsRes.error) {
    const allowed = new Set([...teamCoachIds, callerId, ...guardianIds]);
    const toRemove = Array.from(
      new Set(
        (existingTeamParticipantsRes.data ?? [])
          .map((r: any) => String(r.user_id ?? "").trim())
          .filter((uid: string) => Boolean(uid) && !allowed.has(uid))
      )
    );
    if (toRemove.length > 0) {
      await supabaseAdmin
        .from("thread_participants")
        .delete()
        .eq("thread_id", teamThreadId)
        .in("user_id", toRemove);
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const url = new URL(req.url);
    const organizationId = (url.searchParams.get("organization_id") ?? "").trim();
    const includeThreadId = (url.searchParams.get("include_thread_id") ?? "").trim();
    const archivedOnly = (url.searchParams.get("archived") ?? "").trim() === "true";
    if (!organizationId) return NextResponse.json({ error: "Missing organization_id" }, { status: 400 });

    const membershipsRes = await supabaseAdmin
      .from("club_members")
      .select("club_id,role,is_active")
      .eq("user_id", callerId)
      .eq("is_active", true);
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const memberOrgIds = new Set<string>();
    const staffOrgIds = new Set<string>();
    const playerOrgIds = new Set<string>();
    for (const row of membershipsRes.data ?? []) {
      const oid = String((row as any).club_id ?? "").trim();
      const role = String((row as any).role ?? "").trim();
      if (!oid) continue;
      memberOrgIds.add(oid);
      if (["manager", "coach"].includes(role)) staffOrgIds.add(oid);
      if (role === "player") playerOrgIds.add(oid);
    }
    if (!memberOrgIds.has(organizationId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const scopedOrgIds = playerOrgIds.size > 0 ? Array.from(playerOrgIds) : [organizationId];
    if (!scopedOrgIds.includes(organizationId)) scopedOrgIds.push(organizationId);

    const [threadsRes, participantsRes] = await Promise.all([
      supabaseAdmin
        .from("message_threads")
        .select("id,organization_id,thread_type,title,group_id,event_id,player_id,player_thread_scope,created_by,is_locked,is_active,created_at,updated_at")
        .in("organization_id", scopedOrgIds)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("thread_participants")
        .select("thread_id,user_id,last_read_at,can_post,is_archived")
        .eq("user_id", callerId),
    ]);
    if (threadsRes.error) return NextResponse.json({ error: threadsRes.error.message }, { status: 400 });
    if (participantsRes.error) return NextResponse.json({ error: participantsRes.error.message }, { status: 400 });

    const myParticipantByThread = new Map<string, { last_read_at: string | null; can_post: boolean; is_archived: boolean }>();
    for (const row of participantsRes.data ?? []) {
      myParticipantByThread.set(String(row.thread_id), {
        last_read_at: row.last_read_at ?? null,
        can_post: Boolean(row.can_post),
        is_archived: Boolean((row as any).is_archived),
      });
    }

    const participantThreadIds = Array.from(new Set((participantsRes.data ?? []).map((r: any) => String(r.thread_id)).filter(Boolean)));
    const participantThreadsRes = participantThreadIds.length
      ? await supabaseAdmin
          .from("message_threads")
          .select("id,organization_id,thread_type,title,group_id,event_id,player_id,player_thread_scope,created_by,is_locked,is_active,created_at,updated_at")
          .in("id", participantThreadIds)
          .eq("is_active", true)
      : ({ data: [], error: null } as any);
    if (participantThreadsRes.error) return NextResponse.json({ error: participantThreadsRes.error.message }, { status: 400 });

    const byThreadId = new Map<string, any>();
    for (const t of threadsRes.data ?? []) byThreadId.set(String((t as any).id), t);
    for (const t of participantThreadsRes.data ?? []) byThreadId.set(String((t as any).id), t);
    const mergedThreads = Array.from(byThreadId.values()).sort(
      (a: any, b: any) => new Date(String(b.updated_at ?? 0)).getTime() - new Date(String(a.updated_at ?? 0)).getTime()
    );

    const visibleThreads = mergedThreads.filter((t: any) => {
      if (myParticipantByThread.has(t.id)) return true;
      const threadOrgId = String(t.organization_id ?? "");
      if (!memberOrgIds.has(threadOrgId)) return false;
      if (staffOrgIds.has(threadOrgId)) return true;
      if (t.thread_type === "organization") return true;
      return false;
    });

    const threadIds = visibleThreads.map((t: any) => String(t.id));
    if (threadIds.length === 0) return NextResponse.json({ threads: [] });

    const eventIds = Array.from(
      new Set(
        visibleThreads
          .filter((t: any) => t.thread_type === "event" && t.event_id)
          .map((t: any) => String(t.event_id))
      )
    );

    const playerThreads = visibleThreads.filter((t: any) => t.thread_type === "player");
    const playerIds = Array.from(new Set(playerThreads.map((t: any) => String(t.player_id ?? "")).filter(Boolean)));
    const creatorIds = Array.from(new Set(playerThreads.map((t: any) => String(t.created_by ?? "")).filter(Boolean)));
    const profileIds = Array.from(new Set([...playerIds, ...creatorIds]));

    const [lastMsgRes, unreadRes, eventsRes, profilesRes, threadParticipantsRes] = await Promise.all([
      supabaseAdmin
        .from("thread_messages")
        .select("id,thread_id,sender_user_id,body,message_type,created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabaseAdmin
        .from("thread_messages")
        .select("thread_id,created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false })
        .limit(5000),
      eventIds.length
        ? supabaseAdmin
            .from("club_events")
            .select("id,event_type,title,group_id,starts_at")
            .in("id", eventIds)
        : Promise.resolve({ data: [], error: null } as any),
      profileIds.length
        ? supabaseAdmin
            .from("profiles")
            .select("id,first_name,last_name,username")
            .in("id", profileIds)
        : Promise.resolve({ data: [], error: null } as any),
      threadIds.length
        ? supabaseAdmin
            .from("thread_participants")
            .select("thread_id,user_id")
            .in("thread_id", threadIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (lastMsgRes.error) return NextResponse.json({ error: lastMsgRes.error.message }, { status: 400 });
    if (unreadRes.error) return NextResponse.json({ error: unreadRes.error.message }, { status: 400 });
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
    if (threadParticipantsRes.error) return NextResponse.json({ error: threadParticipantsRes.error.message }, { status: 400 });

    const eventRows = (eventsRes.data ?? []) as Array<{
      id: string;
      event_type: string | null;
      title: string | null;
      group_id: string | null;
      starts_at: string | null;
    }>;

    const eventGroupIds = eventRows.map((e) => String(e.group_id ?? "")).filter(Boolean);
    const directGroupIds = visibleThreads
      .filter((t: any) => t.thread_type === "group")
      .map((t: any) => String(t.group_id ?? ""))
      .filter(Boolean);
    const groupIds = Array.from(new Set([...eventGroupIds, ...directGroupIds]));

    const [groupsRes, groupCategoriesRes] = await Promise.all([
      groupIds.length
      ? await supabaseAdmin
          .from("coach_groups")
          .select("id,name")
          .in("id", groupIds)
      : ({ data: [], error: null } as any),
      groupIds.length
        ? await supabaseAdmin
            .from("coach_group_categories")
            .select("group_id,category")
            .in("group_id", groupIds)
        : ({ data: [], error: null } as any),
    ]);
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (groupCategoriesRes.error) return NextResponse.json({ error: groupCategoriesRes.error.message }, { status: 400 });

    const groupsById = new Map<string, string>();
    for (const g of groupsRes.data ?? []) {
      groupsById.set(String(g.id), String(g.name ?? ""));
    }
    const groupCategoriesById = new Map<string, string[]>();
    for (const row of groupCategoriesRes.data ?? []) {
      const gid = String((row as any).group_id ?? "");
      const cat = String((row as any).category ?? "").trim();
      if (!gid || !cat) continue;
      const prev = groupCategoriesById.get(gid) ?? [];
      if (!prev.includes(cat)) prev.push(cat);
      groupCategoriesById.set(gid, prev);
    }
    const eventById = new Map<string, (typeof eventRows)[number]>();
    for (const e of eventRows) eventById.set(String(e.id), e);
    const profileNameById = new Map<string, string>();
    const participantFirstNameById = new Map<string, string>();
    for (const p of profilesRes.data ?? []) {
      const firstName = String((p as any).first_name ?? "").trim();
      const fullName = `${String((p as any).first_name ?? "").trim()} ${String((p as any).last_name ?? "").trim()}`.trim();
      const fallback = String((p as any).username ?? "").trim();
      profileNameById.set(String((p as any).id), fullName || fallback || String((p as any).id).slice(0, 8));
      participantFirstNameById.set(String((p as any).id), firstName || fallback || String((p as any).id).slice(0, 8));
    }

    const participantUserIds: string[] = Array.from(
      new Set((threadParticipantsRes.data ?? []).map((r: any) => String(r.user_id ?? "")).filter((v: string) => Boolean(v)))
    );
    const participantIdsByThread = new Map<string, string[]>();
    for (const row of threadParticipantsRes.data ?? []) {
      const tid = String((row as any).thread_id ?? "");
      const uid = String((row as any).user_id ?? "");
      if (!tid || !uid) continue;
      const prev = participantIdsByThread.get(tid) ?? [];
      if (!prev.includes(uid)) prev.push(uid);
      participantIdsByThread.set(tid, prev);
    }

    const [coachParticipantsRes, guardianLinksRes] = await Promise.all([
      participantUserIds.length
        ? supabaseAdmin
            .from("club_members")
            .select("user_id")
            .eq("is_active", true)
            .eq("role", "coach")
            .in("user_id", participantUserIds)
        : Promise.resolve({ data: [], error: null } as any),
      playerIds.length
        ? supabaseAdmin
            .from("player_guardians")
            .select("player_id,guardian_user_id,can_view")
            .in("player_id", playerIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (coachParticipantsRes.error) return NextResponse.json({ error: coachParticipantsRes.error.message }, { status: 400 });
    if (guardianLinksRes.error) return NextResponse.json({ error: guardianLinksRes.error.message }, { status: 400 });
    const coachParticipantIds = new Set(
      (coachParticipantsRes.data ?? []).map((r: any) => String(r.user_id ?? "").trim()).filter(Boolean)
    );
    const guardianIdsByPlayer = new Map<string, Set<string>>();
    for (const row of guardianLinksRes.data ?? []) {
      const pid = String((row as any).player_id ?? "").trim();
      const gid = String((row as any).guardian_user_id ?? "").trim();
      const canView = (row as any).can_view;
      if (!pid || !gid || (canView !== null && canView !== true)) continue;
      const prev = guardianIdsByPlayer.get(pid) ?? new Set<string>();
      prev.add(gid);
      guardianIdsByPlayer.set(pid, prev);
    }

    const missingParticipantProfileIds = participantUserIds.filter((id) => !profileNameById.has(id));
    if (missingParticipantProfileIds.length > 0) {
      const extraProfilesRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", missingParticipantProfileIds);
      if (!extraProfilesRes.error) {
        for (const p of extraProfilesRes.data ?? []) {
          const firstName = String((p as any).first_name ?? "").trim();
          const fullName = `${String((p as any).first_name ?? "").trim()} ${String((p as any).last_name ?? "").trim()}`.trim();
          const fallback = String((p as any).username ?? "").trim();
          profileNameById.set(String((p as any).id), fullName || fallback || String((p as any).id).slice(0, 8));
          participantFirstNameById.set(String((p as any).id), firstName || fallback || String((p as any).id).slice(0, 8));
        }
      }
    }

    const visibleThreadById = new Map<string, any>();
    for (const t of visibleThreads) visibleThreadById.set(String((t as any).id ?? ""), t);
    const participantNamesByThread = new Map<string, string[]>();
    const participantFullNamesByThread = new Map<string, string[]>();
    for (const [tid, userIds] of participantIdsByThread.entries()) {
      const thread = visibleThreadById.get(tid);
      const isTeamThread =
        String((thread as any)?.thread_type ?? "") === "player" &&
        String((thread as any)?.player_thread_scope ?? "direct") === "team";

      if (!isTeamThread) {
        const firstNames = userIds.map((uid) => participantFirstNameById.get(uid) ?? uid.slice(0, 8));
        const fullNames = userIds.map((uid) => profileNameById.get(uid) ?? uid.slice(0, 8));
        participantNamesByThread.set(tid, firstNames);
        participantFullNamesByThread.set(tid, fullNames);
        continue;
      }

      const threadPlayerId = String((thread as any)?.player_id ?? "").trim();
      const guardianSet = guardianIdsByPlayer.get(threadPlayerId) ?? new Set<string>();
      const entries = userIds.map((uid) => {
        const firstName = participantFirstNameById.get(uid) ?? uid.slice(0, 8);
        const fullName = profileNameById.get(uid) ?? uid.slice(0, 8);
        const isCoach = coachParticipantIds.has(uid);
        const isParent = guardianSet.has(uid);
        return {
          firstName: isParent ? `${firstName} (p)` : firstName,
          fullName: isParent ? `${fullName} (p)` : fullName,
          sortName: fullName,
          isCoach,
        };
      });
      entries.sort((a, b) => {
        if (a.isCoach !== b.isCoach) return a.isCoach ? -1 : 1;
        return a.sortName.localeCompare(b.sortName, "fr", { sensitivity: "base" });
      });
      participantNamesByThread.set(tid, entries.map((e) => e.firstName));
      participantFullNamesByThread.set(tid, entries.map((e) => e.fullName));
    }

    const lastByThread = new Map<string, any>();
    for (const row of lastMsgRes.data ?? []) {
      const tid = String(row.thread_id);
      if (!lastByThread.has(tid)) lastByThread.set(tid, row);
    }

    const unreadByThread = new Map<string, number>();
    for (const row of unreadRes.data ?? []) {
      const tid = String(row.thread_id);
      const part = myParticipantByThread.get(tid);
      const lastReadAt = part?.last_read_at ? new Date(part.last_read_at).getTime() : 0;
      const createdAt = new Date(row.created_at).getTime();
      if (createdAt > lastReadAt) unreadByThread.set(tid, (unreadByThread.get(tid) ?? 0) + 1);
    }

    const typeLabelFr = (v: string | null | undefined) => {
      if (v === "training") return "Entraînement";
      if (v === "camp") return "Stage/Camp";
      if (v === "interclub") return "Interclub";
      if (v === "session") return "Séance";
      return "Événement";
    };
    const typePrefixWithDateFr = (typeLabel: string, startsAt: string | null | undefined) => {
      if (!startsAt) return typeLabel;
      const dt = new Date(startsAt);
      if (Number.isNaN(dt.getTime())) return typeLabel;
      const parts = new Intl.DateTimeFormat("fr-CH", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
        .formatToParts(dt)
        .reduce<Record<string, string>>((acc, p) => {
          if (p.type !== "literal") acc[p.type] = p.value;
          return acc;
        }, {});
      const dateFr = `${parts.weekday ?? ""} ${parts.day ?? ""} ${parts.month ?? ""} ${parts.year ?? ""}`
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(\p{L})/u, (m) => m.toLowerCase());
      return `${typeLabel} du ${dateFr}`;
    };

    const eligibleThreads = visibleThreads.filter((t: any) => {
      const tid = String(t.id);
      return (
        (includeThreadId && tid === includeThreadId) ||
        t.thread_type === "player" ||
        lastByThread.has(tid) ||
        (t.thread_type === "group" && String(t.created_by ?? "") === callerId)
      );
    });

    const activeEligibleThreads = eligibleThreads.filter((t: any) => {
      const tid = String(t.id);
      const mine = myParticipantByThread.get(tid);
      return !Boolean(mine?.is_archived);
    });
    const archivedEligibleThreads = eligibleThreads.filter((t: any) => {
      const tid = String(t.id);
      const mine = myParticipantByThread.get(tid);
      return Boolean(mine?.is_archived);
    });

    const selectedThreads = archivedOnly ? archivedEligibleThreads : activeEligibleThreads;

    const result = selectedThreads.map((t: any) => {
      let displayTitle = String(t.title ?? "");
      if (t.thread_type === "group") {
        const groupName = String(groupsById.get(String(t.group_id ?? "")) ?? "").trim();
        if (groupName) displayTitle = groupName;
      } else if (t.thread_type === "event" && t.event_id) {
        const ev = eventById.get(String(t.event_id));
        if (ev) {
          const baseTypeLabel = typeLabelFr(ev.event_type);
          const prefix =
            ev.event_type === "training" || ev.event_type === "camp" || ev.event_type === "event" || ev.event_type === "session"
              ? typePrefixWithDateFr(baseTypeLabel, ev.starts_at)
              : baseTypeLabel;
          const eventName = String(ev.title ?? "").trim();
          const groupName = String(groupsById.get(String(ev.group_id ?? "")) ?? "").trim();
          const secondary =
            ev.event_type === "camp"
              ? eventName || groupName || displayTitle
              : groupName || eventName || displayTitle;
          displayTitle = `${prefix} • ${secondary}`;
        }
      } else if (t.thread_type === "player") {
        if (String((t as any).player_thread_scope ?? "direct") === "team") {
          displayTitle = "Fil équipe coachs + joueur + parent(s)";
        } else if (staffOrgIds.has(String(t.organization_id ?? ""))) {
          displayTitle = profileNameById.get(String(t.player_id ?? "")) ?? displayTitle;
        } else {
          displayTitle = profileNameById.get(String(t.created_by ?? "")) ?? "Coach";
        }
      }
      return {
        ...t,
        display_title: displayTitle,
        group_name: groupsById.get(String(t.group_id ?? "")) ?? "",
        group_categories:
          t.thread_type === "group" || t.thread_type === "event"
            ? (groupCategoriesById.get(String(t.group_id ?? "")) ?? [])
            : [],
        participant_names:
          t.thread_type === "group" ||
          (t.thread_type === "player" && String((t as any).player_thread_scope ?? "direct") === "team")
            ? (participantNamesByThread.get(String(t.id)) ?? [])
            : [],
        participant_full_names:
          t.thread_type === "group" ||
          (t.thread_type === "player" && String((t as any).player_thread_scope ?? "direct") === "team")
            ? (participantFullNamesByThread.get(String(t.id)) ?? [])
            : [],
        last_message: lastByThread.get(String(t.id)) ?? null,
        unread_count: unreadByThread.get(String(t.id)) ?? 0,
        me: myParticipantByThread.get(String(t.id)) ?? {
          last_read_at: null,
          can_post: staffOrgIds.has(String(t.organization_id ?? "")) || t.thread_type === "organization",
          is_archived: false,
        },
      };
    });

    return NextResponse.json({
      threads: result,
      counts: {
        active: activeEligibleThreads.length,
        archived: archivedEligibleThreads.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const body = (await req.json()) as NewThreadBody;

    const organizationId = String(body?.organization_id ?? "").trim();
    const threadType = String(body?.thread_type ?? "").trim();
    const title = String(body?.title ?? "").trim();
    const groupId = body?.group_id ? String(body.group_id) : null;
    const eventId = body?.event_id ? String(body.event_id) : null;
    const playerId = body?.player_id ? String(body.player_id) : null;
    const isLocked = Boolean(body?.is_locked ?? false);
    if (!organizationId || !threadType) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    if (threadType !== "player" && threadType !== "event" && !title) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const canCreateRes = await supabaseAdmin.rpc("can_create_message_thread", {
      p_org_id: organizationId,
      p_thread_type: threadType,
      p_group_id: groupId,
      p_event_id: eventId,
      p_player_id: playerId,
      p_user_id: callerId,
    });
    if (canCreateRes.error) return NextResponse.json({ error: canCreateRes.error.message }, { status: 400 });
    if (!canCreateRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const threadSelect =
      "id,organization_id,thread_type,title,group_id,event_id,player_id,created_by,is_locked,is_active,created_at,updated_at";

    if (threadType === "event" && eventId) {
      const existingRes = await supabaseAdmin
        .from("message_threads")
        .select(threadSelect)
        .eq("thread_type", "event")
        .eq("event_id", eventId)
        .limit(1)
        .maybeSingle();
      if (existingRes.error) return NextResponse.json({ error: existingRes.error.message }, { status: 400 });
      if (existingRes.data) return NextResponse.json({ thread: existingRes.data });

      const ensureRes = await supabaseAdmin.rpc("ensure_event_thread_for_event", { p_event_id: eventId });
      if (ensureRes.error) return NextResponse.json({ error: ensureRes.error.message }, { status: 400 });

      const ensuredThreadId = String(ensureRes.data ?? "").trim();
      if (!ensuredThreadId) {
        return NextResponse.json({ error: "Unable to create event thread" }, { status: 400 });
      }

      const ensuredRes = await supabaseAdmin
        .from("message_threads")
        .select(threadSelect)
        .eq("id", ensuredThreadId)
        .maybeSingle();
      if (ensuredRes.error) return NextResponse.json({ error: ensuredRes.error.message }, { status: 400 });
      if (!ensuredRes.data) return NextResponse.json({ error: "Event thread not found" }, { status: 404 });
      return NextResponse.json({ thread: ensuredRes.data });
    }

    let resolvedTitle = title;
    if (threadType === "player") {
      const playerLabel = playerId
        ? await (async () => {
            const pRes = await supabaseAdmin
              .from("profiles")
              .select("first_name,last_name,username")
              .eq("id", playerId)
              .maybeSingle();
            if (pRes.error || !pRes.data) return "";
            const fullName = `${String(pRes.data.first_name ?? "").trim()} ${String(pRes.data.last_name ?? "").trim()}`.trim();
            return fullName || String(pRes.data.username ?? "").trim();
          })()
        : "";
      resolvedTitle = playerLabel || "Fil joueur";
    }

    const insRes = await supabaseAdmin
      .from("message_threads")
      .insert({
        organization_id: organizationId,
        thread_type: threadType,
        title: resolvedTitle,
        group_id: groupId,
        event_id: eventId,
        player_id: playerId,
        created_by: callerId,
        is_locked: isLocked,
      })
      .select(threadSelect)
      .single();
    if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });

    const participantMap = new Map<string, { can_post: boolean }>();
    const setParticipant = (uid: string, canPost: boolean) => {
      if (!uid) return;
      const prev = participantMap.get(uid);
      participantMap.set(uid, { can_post: Boolean(prev?.can_post || canPost) });
    };

    setParticipant(callerId, true);
    for (const raw of body?.participant_user_ids ?? []) {
      const uid = String(raw).trim();
      if (uid) setParticipant(uid, true);
    }

    if (threadType === "organization") {
      const memRes = await supabaseAdmin
        .from("club_members")
        .select("user_id,role")
        .eq("club_id", organizationId)
        .eq("is_active", true)
        .in("role", ["manager", "coach", "player", "parent"]);
      if (!memRes.error) {
        for (const row of memRes.data ?? []) {
          const role = String(row.role ?? "");
          setParticipant(String(row.user_id), ["manager", "coach"].includes(role));
        }
      }
    } else if (threadType === "group" && groupId) {
      const groupRes = await supabaseAdmin
        .from("coach_groups")
        .select("id,club_id,head_coach_user_id")
        .eq("id", groupId)
        .maybeSingle();
      const clubId = String(groupRes.data?.club_id ?? organizationId);
      const headCoachId = String(groupRes.data?.head_coach_user_id ?? "");
      if (headCoachId) setParticipant(headCoachId, true);

      const [groupCoachesRes, groupPlayersRes, managersRes, guardiansRes] = await Promise.all([
        supabaseAdmin.from("coach_group_coaches").select("coach_user_id").eq("group_id", groupId),
        supabaseAdmin.from("coach_group_players").select("player_user_id").eq("group_id", groupId),
        supabaseAdmin
          .from("club_members")
          .select("user_id")
          .eq("club_id", clubId)
          .eq("is_active", true)
          .eq("role", "manager"),
        (async () => {
          const gp = await supabaseAdmin.from("coach_group_players").select("player_user_id").eq("group_id", groupId);
          const playerIds = (gp.data ?? []).map((x: any) => String(x.player_user_id)).filter(Boolean);
          if (!playerIds.length) return { data: [] as any[] };
          return supabaseAdmin
            .from("player_guardians")
            .select("guardian_user_id")
            .in("player_id", playerIds)
            .or("can_view.is.null,can_view.eq.true");
        })(),
      ]);

      for (const row of groupCoachesRes.data ?? []) setParticipant(String(row.coach_user_id ?? ""), true);
      for (const row of groupPlayersRes.data ?? []) setParticipant(String(row.player_user_id ?? ""), true);
      for (const row of managersRes.data ?? []) setParticipant(String(row.user_id ?? ""), true);
      for (const row of guardiansRes.data ?? []) setParticipant(String((row as any).guardian_user_id ?? ""), true);
    } else if (threadType === "player" && playerId) {
      setParticipant(playerId, true);
      const [guardiansRes, managersRes] = await Promise.all([
        supabaseAdmin
          .from("player_guardians")
          .select("guardian_user_id")
          .eq("player_id", playerId)
          .or("can_view.is.null,can_view.eq.true"),
        supabaseAdmin
          .from("club_members")
          .select("user_id")
          .eq("club_id", organizationId)
          .eq("is_active", true)
          .eq("role", "manager"),
      ]);
      for (const row of guardiansRes.data ?? []) setParticipant(String(row.guardian_user_id ?? ""), true);
      for (const row of managersRes.data ?? []) setParticipant(String(row.user_id ?? ""), true);
    }

    const participantRows = Array.from(participantMap.entries()).map(([uid, cfg]) => ({
      thread_id: insRes.data.id,
      user_id: uid,
      can_post: cfg.can_post,
    }));
    if (participantRows.length > 0) {
      await supabaseAdmin.from("thread_participants").upsert(participantRows, { onConflict: "thread_id,user_id" });
    }

    if (threadType === "event" && eventId) {
      await supabaseAdmin.rpc("sync_event_thread_participants", { p_event_id: eventId });
    }

    return NextResponse.json({ thread: insRes.data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
