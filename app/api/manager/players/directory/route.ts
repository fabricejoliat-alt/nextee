import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Club = { id: string; name: string | null };
type Member = { id: string; club_id: string; user_id: string };
type Profile = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; handicap: number | null; sex: string | null };
const PAGE_SIZE = 500;

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function allMembers(db: SupabaseClient, build: () => ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) {
  const rows: Member[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await build().order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Member[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function batches<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "directory_load_failed" }, { status: 401 });
  try {
    const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: caller, error: authError } = await db.auth.getUser(token);
    if (authError || !caller.user) return NextResponse.json({ error: "directory_load_failed" }, { status: 401 });
    const managerMemberships = await allMembers(db, () => db.from("club_members").select("id,club_id,user_id")
      .eq("user_id", caller.user.id).eq("role", "manager").eq("is_active", true));
    const clubIds = Array.from(new Set(managerMemberships.map((row) => row.club_id).filter(Boolean)));
    if (!clubIds.length) return NextResponse.json({ clubs: [], players: [] });

    const clubs: Club[] = [];
    const members: Member[] = [];
    for (const ids of batches(clubIds, 150)) {
      const { data: clubRows, error: clubError } = await db.from("clubs").select("id,name").in("id", ids);
      if (clubError) throw clubError;
      clubs.push(...((clubRows ?? []) as Club[]));
      members.push(...await allMembers(db, () => db.from("club_members").select("id,club_id,user_id")
        .in("club_id", ids).eq("role", "player").eq("is_active", true)));
    }
    const clubById = new Map(clubs.map((club) => [club.id, club]));
    const playerClubs = new Map<string, Set<string>>();
    for (const member of members) {
      if (!clubById.has(member.club_id) || !member.user_id) continue;
      if (!playerClubs.has(member.user_id)) playerClubs.set(member.user_id, new Set());
      playerClubs.get(member.user_id)!.add(member.club_id);
    }
    const profiles: Profile[] = [];
    for (const ids of batches(Array.from(playerClubs.keys()), 150)) {
      const { data, error } = await db.from("profiles").select("id,first_name,last_name,avatar_url,handicap,sex").in("id", ids);
      if (error) throw error;
      profiles.push(...((data ?? []) as Profile[]));
    }
    return NextResponse.json({
      clubs,
      players: profiles.filter((profile) => playerClubs.has(profile.id)).map((profile) => {
        const ids = Array.from(playerClubs.get(profile.id)!);
        return { ...profile, club_ids: ids, club_names: ids.map((id) => clubById.get(id)?.name ?? "Club") };
      }),
    });
  } catch {
    return NextResponse.json({ error: "directory_load_failed" }, { status: 500 });
  }
}
