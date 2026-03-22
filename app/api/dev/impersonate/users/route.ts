import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertDevImpersonationEnabled } from "@/lib/devImpersonation";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => String(v ?? "").trim()).filter(Boolean)));
}

async function fetchAuthUsersByIds(supabaseAdmin: any, userIds: string[]) {
  const out = new Map<string, { id: string; email: string | null }>();
  if (userIds.length === 0) return out;

  const wanted = new Set(userIds);
  let page = 1;
  const perPage = 1000;

  while (wanted.size > 0) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      if (!wanted.has(user.id)) continue;
      out.set(user.id, { id: user.id, email: user.email ?? null });
      wanted.delete(user.id);
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return out;
}

export async function GET(req: NextRequest) {
  try {
    assertDevImpersonationEnabled(req);

    const role = String(req.nextUrl.searchParams.get("role") ?? "all").trim().toLowerCase();
    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const membershipsRes = await supabaseAdmin
      .from("club_members")
      .select("user_id, role, club_id")
      .eq("is_active", true);
    if (membershipsRes.error) return NextResponse.json({ error: membershipsRes.error.message }, { status: 400 });

    const memberships = (membershipsRes.data ?? []) as Array<{
      user_id: string | null;
      role: string | null;
      club_id: string | null;
    }>;

    const filteredMemberships =
      role === "all" ? memberships : memberships.filter((row) => String(row.role ?? "").trim().toLowerCase() === role);

    const userIds = uniq(filteredMemberships.map((row) => String(row.user_id ?? "")));
    const roleByUserId = new Map<string, Set<string>>();
    const clubCountByUserId = new Map<string, Set<string>>();
    filteredMemberships.forEach((row) => {
      const userId = String(row.user_id ?? "").trim();
      const rowRole = String(row.role ?? "").trim();
      const clubId = String(row.club_id ?? "").trim();
      if (!userId) return;
      if (!roleByUserId.has(userId)) roleByUserId.set(userId, new Set());
      if (!clubCountByUserId.has(userId)) clubCountByUserId.set(userId, new Set());
      if (rowRole) roleByUserId.get(userId)!.add(rowRole);
      if (clubId) clubCountByUserId.get(userId)!.add(clubId);
    });

    const [profilesRes, authUsersById] = await Promise.all([
      userIds.length > 0
        ? supabaseAdmin.from("profiles").select("id,first_name,last_name,username").in("id", userIds)
        : Promise.resolve({ data: [], error: null } as any),
      fetchAuthUsersByIds(supabaseAdmin, userIds),
    ]);
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });

    const profileById = new Map<string, { first_name: string | null; last_name: string | null; username: string | null }>();
    ((profilesRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; username: string | null }>).forEach(
      (row) => {
        profileById.set(String(row.id ?? ""), {
          first_name: row.first_name ?? null,
          last_name: row.last_name ?? null,
          username: row.username ?? null,
        });
      }
    );

    const users = userIds
      .map((userId) => {
        const profile = profileById.get(userId);
        const email = authUsersById.get(userId)?.email ?? null;
        const first = String(profile?.first_name ?? "").trim();
        const last = String(profile?.last_name ?? "").trim();
        const username = String(profile?.username ?? "").trim();
        const name = `${first} ${last}`.trim() || username || email || userId;
        const roles = Array.from(roleByUserId.get(userId) ?? []).sort();
        const clubCount = (clubCountByUserId.get(userId) ?? new Set()).size;
        return {
          id: userId,
          name,
          first_name: profile?.first_name ?? null,
          last_name: profile?.last_name ?? null,
          username: username || null,
          email,
          roles,
          club_count: clubCount,
        };
      })
      .filter((row) => {
        if (!q) return true;
        const haystack = [row.name, row.username ?? "", row.email ?? "", row.roles.join(" ")].join(" ").toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));

    return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 403 });
  }
}
