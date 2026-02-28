import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (callerErr || !callerData.user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const parentId = callerData.user.id;

    const { data: links, error: linksErr } = await supabaseAdmin
      .from("player_guardians")
      .select("player_id,is_primary,relation")
      .eq("guardian_user_id", parentId);
    if (linksErr) return NextResponse.json({ error: linksErr.message }, { status: 400 });

    const playerIds = Array.from(
      new Set((links ?? []).map((r: any) => String(r.player_id ?? "")).filter(Boolean))
    );
    if (playerIds.length === 0) return NextResponse.json({ children: [] });

    const { data: profilesRows, error: profilesErr } = await supabaseAdmin
      .from("profiles")
      .select("id,first_name,last_name,username,handicap,avatar_url,birth_date")
      .in("id", playerIds);
    if (profilesErr) return NextResponse.json({ error: profilesErr.message }, { status: 400 });

    const { data: membershipsRows, error: membershipsErr } = await supabaseAdmin
      .from("club_members")
      .select("user_id,club_id,is_active")
      .in("user_id", playerIds)
      .eq("is_active", true);
    if (membershipsErr) return NextResponse.json({ error: membershipsErr.message }, { status: 400 });

    const clubIds = Array.from(
      new Set((membershipsRows ?? []).map((m: any) => String(m.club_id ?? "")).filter(Boolean))
    );
    const clubNameById = new Map<string, string>();
    if (clubIds.length > 0) {
      const { data: clubsRows, error: clubsErr } = await supabaseAdmin
        .from("clubs")
        .select("id,name")
        .in("id", clubIds);
      if (clubsErr) return NextResponse.json({ error: clubsErr.message }, { status: 400 });
      for (const c of clubsRows ?? []) {
        clubNameById.set(String((c as any).id), String((c as any).name ?? "Club"));
      }
    }

    const clubIdsByPlayer = new Map<string, string[]>();
    for (const row of membershipsRows ?? []) {
      const pid = String((row as any).user_id ?? "");
      const cid = String((row as any).club_id ?? "");
      if (!pid || !cid) continue;
      const arr = clubIdsByPlayer.get(pid) ?? [];
      if (!arr.includes(cid)) arr.push(cid);
      clubIdsByPlayer.set(pid, arr);
    }

    const linkByPlayer = new Map<string, { is_primary: boolean; relation: string | null }>();
    for (const row of links ?? []) {
      const pid = String((row as any).player_id ?? "");
      if (!pid) continue;
      linkByPlayer.set(pid, {
        is_primary: Boolean((row as any).is_primary),
        relation: ((row as any).relation ?? null) as string | null,
      });
    }

    const children = (profilesRows ?? []).map((p: any) => {
      const pid = String(p.id);
      const playerClubIds = clubIdsByPlayer.get(pid) ?? [];
      return {
        id: pid,
        first_name: (p.first_name ?? null) as string | null,
        last_name: (p.last_name ?? null) as string | null,
        username: (p.username ?? null) as string | null,
        handicap: p.handicap == null ? null : Number(p.handicap),
        avatar_url: (p.avatar_url ?? null) as string | null,
        birth_date: (p.birth_date ?? null) as string | null,
        relation: linkByPlayer.get(pid)?.relation ?? null,
        is_primary: linkByPlayer.get(pid)?.is_primary ?? false,
        clubs: playerClubIds.map((id) => ({ id, name: clubNameById.get(id) ?? "Club" })),
      };
    });

    children.sort((a: any, b: any) => {
      const aPrimary = a.is_primary ? 1 : 0;
      const bPrimary = b.is_primary ? 1 : 0;
      if (aPrimary !== bPrimary) return bPrimary - aPrimary;
      const an = `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim();
      const bn = `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim();
      return an.localeCompare(bn, "fr");
    });

    return NextResponse.json({ children });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

