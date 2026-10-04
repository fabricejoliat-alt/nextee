import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireManagerClub } from "@/lib/server/managerAccess";
import { managerMutationError } from "@/lib/server/managerMutationError";
import { protectedParentAccounts } from "@/lib/server/parentCredentialAccess";
import type { ManagerParent } from "@/lib/managerParents";

type Context = { params: Promise<{ clubId: string }> };
const database = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const response = await query(from, from + 499);
    if (response.error) throw new Error(response.error.message);
    rows.push(...(response.data ?? []));
    if ((response.data?.length ?? 0) < 500) return rows;
  }
}

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { clubId } = await ctx.params, db = database();
    const auth = await requireManagerClub(req, db, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const members = await allRows((from, to) => db.from("club_members").select("id,user_id,role,is_active")
      .eq("club_id", clubId).order("id").range(from, to));
    const parents = members.filter(row => row.role === "parent");
    if (!parents.length) return NextResponse.json({ parents: [] });
    const players = members.filter(row => row.role === "player");
    const playerById = new Map(players.map(row => [String(row.user_id), row]));
    const parentIds = parents.map(row => String(row.user_id));
    const profiles = new Map<string, { first_name: string | null; last_name: string | null; phone: string | null; username: string | null }>();
    const links: Array<{ player_id: string; guardian_user_id: string }> = [];
    const sharedPlayers = new Set<string>();
    const protectedAccounts = await protectedParentAccounts(db, parentIds);
    // Chunk IN filters and paginate each query; large clubs must not lose rows.
    const profileIds = Array.from(new Set([...parentIds, ...playerById.keys()]));
    for (let from = 0; from < profileIds.length; from += 100) {
      const rows = await allRows((start, end) => db.from("profiles").select("id,first_name,last_name,phone,username")
        .in("id", profileIds.slice(from, from + 100)).order("id").range(start, end));
      for (const row of rows) profiles.set(String(row.id), row);
    }
    for (let from = 0; from < parentIds.length; from += 100) {
      const ids = parentIds.slice(from, from + 100);
      const rows = await allRows((start, end) => db.from("player_guardians").select("player_id,guardian_user_id")
        .in("guardian_user_id", ids).order("player_id").order("guardian_user_id").range(start, end));
      links.push(...rows.filter(row => playerById.has(String(row.player_id))));
    }
    const linkedPlayers = Array.from(new Set(links.map(row => String(row.player_id))));
    for (let from = 0; from < linkedPlayers.length; from += 100) {
      const rows = await allRows((start, end) => db.from("club_members").select("id,user_id")
        .in("user_id", linkedPlayers.slice(from, from + 100)).eq("role", "player").neq("club_id", clubId)
        .order("id").range(start, end));
      for (const row of rows) sharedPlayers.add(String(row.user_id));
    }
    const emails = new Map<string, string | null>();
    for (let from = 0; from < parentIds.length; from += 20) {
      await Promise.all(parentIds.slice(from, from + 20).map(async id => {
        const result = await db.auth.admin.getUserById(id);
        if (result.error) throw result.error;
        const email = result.data.user?.email ?? null;
        emails.set(id, email?.endsWith("@noemail.local") ? null : email);
      }));
    }
    const result: ManagerParent[] = parents.map(row => {
      const userId = String(row.user_id), profile = profiles.get(userId);
      return { id: String(row.id), user_id: userId, first_name: profile?.first_name ?? "", last_name: profile?.last_name ?? "",
        email: emails.get(userId) ?? null, phone: profile?.phone ?? "", is_active: row.is_active === true,
        username: profile?.username ?? null,
        can_manage: auth.isSuperadmin || !protectedAccounts.platform.has(userId),
        can_change_password: auth.isSuperadmin || (row.is_active === true && !protectedAccounts.credentials.has(userId)),
        other_roles: members.filter(member => member.user_id === userId && member.role !== "parent").map(member => String(member.role)),
        juniors: links.filter(link => link.guardian_user_id === userId).map(link => {
          const junior = profiles.get(link.player_id);
          return { player_id: link.player_id, member_id: String(playerById.get(link.player_id)!.id),
            name: [junior?.first_name, junior?.last_name].filter(Boolean).join(" "), shared: sharedPlayers.has(link.player_id) };
        }),
      };
    });
    return NextResponse.json({ parents: result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "parents_load_failed" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest, ctx: Context) {
  try {
    const { clubId } = await ctx.params, db = database();
    const auth = await requireManagerClub(req, db, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => null);
    if (!body?.member_id || !Array.isArray(body.expected_player_ids) || !Array.isArray(body.expected_shared_player_ids)
      || [...body.expected_player_ids, ...body.expected_shared_player_ids].some(id => typeof id !== "string")) {
      return NextResponse.json({ error: "invalid_parent_removal" }, { status: 400 });
    }
    const result = await db.rpc("remove_manager_parent_v1", { p_actor_id: auth.callerId, p_club_id: clubId,
      p_member_id: body.member_id, p_expected_player_ids: body.expected_player_ids, p_expected_shared_player_ids: body.expected_shared_player_ids });
    if (result.error) {
      if ((result.error.code === "PT409" || result.error.code === "40001")) return NextResponse.json({ error: "parent_links_changed" }, { status: 409 });
      if (result.error.code === "PGRST202") return NextResponse.json({ error: "parent_removal_migration_required" }, { status: 503 });
      const failure = managerMutationError(result.error);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ error: "parent_removal_failed" }, { status: 503 });
  }
}
