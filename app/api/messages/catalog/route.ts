import { NextResponse, type NextRequest } from "next/server";
import { isOrgMemberActive, isOrgStaffMember, requireCaller } from "@/app/api/messages/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const url = new URL(req.url);
    const organizationId = (url.searchParams.get("organization_id") ?? "").trim();
    if (!organizationId) return NextResponse.json({ error: "Missing organization_id" }, { status: 400 });

    const [orgMember, orgStaff] = await Promise.all([
      isOrgMemberActive(supabaseAdmin, organizationId, callerId),
      isOrgStaffMember(supabaseAdmin, organizationId, callerId),
    ]);
    if (!orgMember && !orgStaff) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [groupsRes, eventsRes, playersRes, profilesRes] = await Promise.all([
      supabaseAdmin
        .from("coach_groups")
        .select("id,name")
        .eq("club_id", organizationId)
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(200),
      supabaseAdmin
        .from("club_events")
        .select("id,title,event_type,starts_at,group_id")
        .eq("club_id", organizationId)
        .in("status", ["scheduled", "published", "done"])
        .order("starts_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("club_id", organizationId)
        .eq("role", "player")
        .eq("is_active", true)
        .limit(300),
      (async () => {
        const players = await supabaseAdmin
          .from("club_members")
          .select("user_id")
          .eq("club_id", organizationId)
          .eq("role", "player")
          .eq("is_active", true)
          .limit(300);
        const ids = (players.data ?? []).map((r: any) => String(r.user_id)).filter(Boolean);
        if (!ids.length) return { data: [] as any[], error: null };
        return supabaseAdmin.from("profiles").select("id,first_name,last_name,username").in("id", ids);
      })(),
    ]);

    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });
    if (playersRes.error) return NextResponse.json({ error: playersRes.error.message }, { status: 400 });
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });

    const groupIds = (groupsRes.data ?? []).map((g: any) => String(g.id)).filter(Boolean);
    const groupCategoriesRes = groupIds.length
      ? await supabaseAdmin
          .from("coach_group_categories")
          .select("group_id,category")
          .in("group_id", groupIds)
      : ({ data: [], error: null } as any);
    if (groupCategoriesRes.error) return NextResponse.json({ error: groupCategoriesRes.error.message }, { status: 400 });

    const categoriesByGroup = new Map<string, string[]>();
    for (const row of groupCategoriesRes.data ?? []) {
      const gid = String((row as any).group_id ?? "").trim();
      const cat = String((row as any).category ?? "").trim();
      if (!gid || !cat) continue;
      const prev = categoriesByGroup.get(gid) ?? [];
      if (!prev.includes(cat)) prev.push(cat);
      categoriesByGroup.set(gid, prev);
    }

    const groups = (groupsRes.data ?? []).map((g: any) => ({
      id: String(g.id),
      name: g.name ?? null,
      categories: categoriesByGroup.get(String(g.id)) ?? [],
    }));

    const playersSet = new Set((playersRes.data ?? []).map((r: any) => String(r.user_id)));
    const groupNameById = new Map<string, string>();
    for (const g of groups) {
      groupNameById.set(String((g as any).id), String((g as any).name ?? "").trim());
    }

    const events = (eventsRes.data ?? []).map((ev: any) => ({
      id: String(ev.id),
      title: ev.title ?? null,
      event_type: ev.event_type ?? null,
      starts_at: ev.starts_at ?? null,
      group_id: ev.group_id ?? null,
      group_name: groupNameById.get(String(ev.group_id ?? "")) ?? null,
    }));

    const players = (profilesRes.data ?? [])
      .filter((p: any) => playersSet.has(String(p.id)))
      .map((p: any) => ({
        id: String(p.id),
        username: p.username ?? null,
        full_name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || p.username || String(p.id).slice(0, 8),
      }))
      .sort((a: any, b: any) => String(a.full_name).localeCompare(String(b.full_name), "fr"));

    return NextResponse.json({
      groups,
      events,
      players,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
