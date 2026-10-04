import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

export async function GET(req: Request) {
  try {
    const db = legalDb(); if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const club = new URL(req.url).searchParams.get("club_id");
    if (!club || !uuid(club)) return reply({ error: "Choose a club" }, 400);
    let query = db.from("legal_representative_assertions")
      .select("id,guardian_id,child_id,club_id,status,basis,verified_by,verified_at,created_at")
      .order("created_at", { ascending: false }).limit(100);
    query = query.eq("club_id", club);
    const rows = await query; if (rows.error) throw rows.error;
    const members = await db.from("club_members").select("user_id,role").eq("club_id", club)
      .eq("is_active", true).in("role", ["parent","player"]).limit(500);
    if (members.error) throw members.error;
    const parents = new Set((members.data ?? []).filter((m) => m.role === "parent").map((m) => m.user_id));
    const players = new Set((members.data ?? []).filter((m) => m.role === "player").map((m) => m.user_id));
    const links = parents.size && players.size ? await db.from("player_guardians")
      .select("guardian_user_id,player_id,can_edit").in("guardian_user_id", [...parents])
      .in("player_id", [...players]).eq("can_edit", true).limit(500) : { data: [], error: null };
    if (links.error) throw links.error;
    const ids = [...new Set([
      ...(links.data ?? []).flatMap((link) => [link.guardian_user_id, link.player_id]),
      ...(rows.data ?? []).flatMap((row) => [row.guardian_id, row.child_id]),
    ])];
    const profiles = ids.length ? await db.from("profiles").select("id,first_name,last_name").in("id", ids) : { data: [], error: null };
    if (profiles.error) throw profiles.error;
    const names = new Map((profiles.data ?? []).map((profile) => [profile.id,
      `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || profile.id]));
    const pairs = new Map<string, { guardian_id: string; child_id: string; guardian_name: string; child_name: string }>();
    for (const link of links.data ?? []) pairs.set(`${link.guardian_user_id}:${link.player_id}`, {
      guardian_id: link.guardian_user_id, child_id: link.player_id,
      guardian_name: names.get(link.guardian_user_id) ?? link.guardian_user_id,
      child_name: names.get(link.player_id) ?? link.player_id,
    });
    for (const row of rows.data ?? []) if (!pairs.has(`${row.guardian_id}:${row.child_id}`)) pairs.set(`${row.guardian_id}:${row.child_id}`, {
      guardian_id: row.guardian_id, child_id: row.child_id,
      guardian_name: names.get(row.guardian_id) ?? row.guardian_id,
      child_name: names.get(row.child_id) ?? row.child_id,
    });
    return reply({ assertions: rows.data, candidates: [...pairs.values()] });
  } catch { return reply({ error: "Unavailable" }, 503); }
}

export async function POST(req: Request) {
  try {
    const db = legalDb(); const admin = await legalAdmin(req, db); if (!admin) return reply({ error: "Forbidden" }, 403);
    const body = await req.json(); const guardian = String(body.guardian_id ?? "");
    const child = String(body.child_id ?? ""); const club = String(body.club_id ?? "");
    const status = String(body.status ?? ""); const basis = String(body.basis ?? "").trim();
    if (!uuid(guardian) || !uuid(child) || !uuid(club) || !["verified","revoked"].includes(status) || basis.length < 20)
      return reply({ error: "Invalid review" }, 400);
    const saved = await db.rpc("review_legal_representative", { p_guardian: guardian, p_child: child,
      p_club: club, p_status: status, p_basis: basis, p_admin: admin.id });
    if (saved.error) return reply({ error: saved.error.message }, 409);
    return reply({ assertion_id: saved.data });
  } catch { return reply({ error: "Unavailable" }, 503); }
}
