import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const url = new URL(req.url);
    const childId = String(url.searchParams.get("child_id") ?? "").trim();

    let effectivePlayerId = callerId;
    if (childId && childId !== callerId) {
      const guardianRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", callerId)
        .eq("player_id", childId)
        .eq("can_view", true)
        .maybeSingle();
      if (guardianRes.error) return NextResponse.json({ error: guardianRes.error.message }, { status: 400 });
      if (!guardianRes.data?.player_id) return NextResponse.json({ staff: [] });
      effectivePlayerId = String(guardianRes.data.player_id);
    }

    const playerMembershipsRes = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", effectivePlayerId)
      .eq("is_active", true)
      .eq("role", "player");
    if (playerMembershipsRes.error) return NextResponse.json({ error: playerMembershipsRes.error.message }, { status: 400 });

    const orgIds = Array.from(
      new Set((playerMembershipsRes.data ?? []).map((r: any) => String(r.club_id ?? "").trim()).filter(Boolean))
    );
    if (orgIds.length === 0) return NextResponse.json({ staff: [] });

    const [staffRes, clubsRes] = await Promise.all([
      supabaseAdmin
        .from("club_members")
        .select("club_id,user_id,role")
        .in("club_id", orgIds)
        .eq("is_active", true)
        .in("role", ["manager", "coach"]),
      supabaseAdmin.from("clubs").select("id,name").in("id", orgIds),
    ]);
    if (staffRes.error) return NextResponse.json({ error: staffRes.error.message }, { status: 400 });
    if (clubsRes.error) return NextResponse.json({ error: clubsRes.error.message }, { status: 400 });

    const staffRows = (staffRes.data ?? []) as Array<{ club_id: string | null; user_id: string | null; role: string | null }>;
    const staffUserIds = Array.from(new Set(staffRows.map((r) => String(r.user_id ?? "").trim()).filter(Boolean)));

    const [profilesRes, threadsRes] = await Promise.all([
      staffUserIds.length
        ? supabaseAdmin
            .from("profiles")
            .select("id,first_name,last_name,username,phone,address,postal_code,city,avatar_url,staff_function")
            .in("id", staffUserIds)
        : Promise.resolve({ data: [], error: null } as any),
      staffUserIds.length
        ? supabaseAdmin
            .from("message_threads")
            .select("id,organization_id,updated_at")
            .eq("thread_type", "player")
            .eq("player_id", effectivePlayerId)
            .eq("is_active", true)
            .eq("player_thread_scope", "direct")
            .in("organization_id", orgIds)
            .order("updated_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
    if (threadsRes.error) return NextResponse.json({ error: threadsRes.error.message }, { status: 400 });

    const authEmailById = new Map<string, string | null>();
    if (staffUserIds.length > 0) {
      const authUsers = await Promise.all(
        staffUserIds.map(async (id) => {
          const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
          if (error || !data?.user) return { id, email: null as string | null };
          return { id, email: data.user.email ?? null };
        })
      );
      for (const u of authUsers) authEmailById.set(u.id, u.email);
    }

    const orgNameById = new Map<string, string>();
    for (const c of clubsRes.data ?? []) {
      orgNameById.set(String((c as any).id ?? ""), String((c as any).name ?? "").trim());
    }

    const profileById = new Map<string, any>();
    for (const p of profilesRes.data ?? []) {
      profileById.set(String((p as any).id ?? ""), p);
    }

    const threadByOrgAndStaff = new Map<string, string>();
    const threads = (threadsRes.data ?? []) as Array<{ id: string | null; organization_id: string | null }>;
    const threadIds = threads.map((t) => String(t.id ?? "").trim()).filter(Boolean);
    if (threadIds.length > 0 && staffUserIds.length > 0) {
      const participantsRes = await supabaseAdmin
        .from("thread_participants")
        .select("thread_id,user_id")
        .in("thread_id", threadIds)
        .in("user_id", [effectivePlayerId, ...staffUserIds]);
      if (participantsRes.error) return NextResponse.json({ error: participantsRes.error.message }, { status: 400 });

      const usersByThread = new Map<string, Set<string>>();
      for (const row of participantsRes.data ?? []) {
        const tid = String((row as any).thread_id ?? "").trim();
        const uid = String((row as any).user_id ?? "").trim();
        if (!tid || !uid) continue;
        if (!usersByThread.has(tid)) usersByThread.set(tid, new Set<string>());
        usersByThread.get(tid)!.add(uid);
      }

      const staffIdSet = new Set(staffUserIds);
      for (const t of threads) {
        const threadId = String(t.id ?? "").trim();
        const orgId = String(t.organization_id ?? "").trim();
        if (!threadId || !orgId) continue;
        const users = usersByThread.get(threadId);
        if (!users || !users.has(effectivePlayerId)) continue;
        for (const uid of users) {
          if (uid === effectivePlayerId) continue;
          if (!staffIdSet.has(uid)) continue;
          const key = `${orgId}::${uid}`;
          if (!threadByOrgAndStaff.has(key)) threadByOrgAndStaff.set(key, threadId);
        }
      }
    }

    const staff = staffRows
      .map((row) => {
        const organization_id = String(row.club_id ?? "").trim();
        const staff_user_id = String(row.user_id ?? "").trim();
        if (!organization_id || !staff_user_id) return null;
        const profile = profileById.get(staff_user_id) ?? {};
        const first_name = String((profile as any).first_name ?? "").trim();
        const last_name = String((profile as any).last_name ?? "").trim();
        const username = String((profile as any).username ?? "").trim();
        const full_name = `${first_name} ${last_name}`.trim() || username || staff_user_id.slice(0, 8);
        const key = `${organization_id}::${staff_user_id}`;
        return {
          organization_id,
          organization_name: orgNameById.get(organization_id) ?? organization_id,
          staff_user_id,
          role: String(row.role ?? ""),
          first_name: first_name || null,
          last_name: last_name || null,
          full_name,
          username: username || null,
          phone: String((profile as any).phone ?? "").trim() || null,
          email: authEmailById.get(staff_user_id) ?? null,
          address: String((profile as any).address ?? "").trim() || null,
          postal_code: String((profile as any).postal_code ?? "").trim() || null,
          city: String((profile as any).city ?? "").trim() || null,
          staff_function: String((profile as any).staff_function ?? "").trim() || null,
          avatar_url: String((profile as any).avatar_url ?? "").trim() || null,
          thread_id: threadByOrgAndStaff.get(key) ?? null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const orgCmp = String(a.organization_name).localeCompare(String(b.organization_name), "fr", { sensitivity: "base" });
        if (orgCmp !== 0) return orgCmp;
        const roleRank = (r: string) => (r === "manager" ? 0 : r === "coach" ? 1 : 9);
        const roleCmp = roleRank(String(a.role ?? "")) - roleRank(String(b.role ?? ""));
        if (roleCmp !== 0) return roleCmp;
        return String(a.full_name).localeCompare(String(b.full_name), "fr", { sensitivity: "base" });
      });

    return NextResponse.json({ staff });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
