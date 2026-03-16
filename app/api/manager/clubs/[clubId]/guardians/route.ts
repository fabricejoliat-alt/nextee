import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function assertManagerOrSuperadmin(req: NextRequest, supabaseAdmin: any, clubId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token" };

  const callerId = callerData.user.id;

  const { data: adminRow } = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();
  if (adminRow) return { ok: true as const };

  const { data: membership } = await supabaseAdmin
    .from("club_members")
    .select("id,role,is_active")
    .eq("club_id", clubId)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership || membership.role !== "manager") return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

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

    const [playersRes, parentsRes] = await Promise.all([
      supabaseAdmin
        .from("club_members")
        .select("user_id,player_course_track")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .eq("role", "player"),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("club_id", clubId)
        .eq("role", "parent"),
    ]);

    if (playersRes.error) return NextResponse.json({ error: playersRes.error.message }, { status: 400 });
    if (parentsRes.error) return NextResponse.json({ error: parentsRes.error.message }, { status: 400 });

    const rawPlayers = (playersRes.data ?? []) as Array<{ user_id: string | null; player_course_track: string | null }>;
    const playerIds = Array.from(new Set(rawPlayers.map((r) => String(r.user_id ?? "")).filter(Boolean)));
    const clubParentIds = Array.from(new Set((parentsRes.data ?? []).map((r: any) => String(r.user_id)).filter(Boolean)));

    let rawLinks: any[] = [];
    if (playerIds.length > 0) {
      const linksRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id,guardian_user_id,relation,is_primary")
        .in("player_id", playerIds);
      if (linksRes.error) return NextResponse.json({ error: linksRes.error.message }, { status: 400 });
      rawLinks = linksRes.data ?? [];
    }

    const linkedGuardianIds = Array.from(
      new Set(rawLinks.map((r: any) => String(r.guardian_user_id ?? "")).filter(Boolean))
    );
    const parentIds = Array.from(new Set([...clubParentIds, ...linkedGuardianIds]));

    const allUserIds = Array.from(new Set([...playerIds, ...parentIds]));
    const profileById = new Map<string, { id: string; first_name: string | null; last_name: string | null; birth_date: string | null }>();
    if (allUserIds.length > 0) {
      const profilesRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,birth_date")
        .in("id", allUserIds);
      if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
      for (const p of profilesRes.data ?? []) {
        profileById.set(String((p as any).id), {
          id: String((p as any).id),
          first_name: ((p as any).first_name ?? null) as string | null,
          last_name: ((p as any).last_name ?? null) as string | null,
          birth_date: ((p as any).birth_date ?? null) as string | null,
        });
      }
    }

    const eligiblePlayerIds = rawPlayers
      .filter((row) => {
        const playerId = String(row.user_id ?? "");
        if (!playerId) return false;
        const track = String(row.player_course_track ?? "").trim().toLowerCase();
        if (!track || track === "no_course") return false;
        const age = computeAge((profileById.get(playerId) as any)?.birth_date ?? null);
        return !(age != null && age >= 18);
      })
      .map((row) => String(row.user_id ?? ""));

    const eligiblePlayerIdSet = new Set(eligiblePlayerIds);
    const links = rawLinks.filter((r: any) => {
      const playerId = String(r.player_id ?? "");
      const guardianId = String(r.guardian_user_id ?? "");
      return eligiblePlayerIdSet.has(playerId) && parentIds.includes(guardianId);
    });

    return NextResponse.json({
      players: eligiblePlayerIds.map((id) => ({ user_id: id, profiles: profileById.get(id) ?? null })),
      parents: parentIds.map((id) => ({ user_id: id, profiles: profileById.get(id) ?? null })),
      links,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const playerId = String(body.player_id ?? "");
    const guardianId = String(body.guardian_user_id ?? "");
    const relation = String(body.relation ?? "other");
    const isPrimary = Boolean(body.is_primary);
    if (!playerId || !guardianId) return NextResponse.json({ error: "Missing ids" }, { status: 400 });

    const { error } = await supabaseAdmin.from("player_guardians").upsert(
      {
        player_id: playerId,
        guardian_user_id: guardianId,
        relation,
        is_primary: isPrimary,
        can_view: true,
        can_edit: true,
      },
      { onConflict: "player_id,guardian_user_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    if (!clubId) return NextResponse.json({ error: "Missing clubId" }, { status: 400 });

    const supabaseAdmin = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const auth = await assertManagerOrSuperadmin(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const playerId = String(body.player_id ?? "");
    const guardianId = String(body.guardian_user_id ?? "");
    if (!playerId || !guardianId) return NextResponse.json({ error: "Missing ids" }, { status: 400 });

    const { error } = await supabaseAdmin
      .from("player_guardians")
      .delete()
      .eq("player_id", playerId)
      .eq("guardian_user_id", guardianId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
