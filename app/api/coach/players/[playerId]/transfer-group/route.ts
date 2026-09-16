import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isFutureTransferAction } from "@/lib/coachPermissions";

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }
function database() { return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY")); }

async function context(req: NextRequest, playerId: string, sourceGroupId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: "Missing token", status: 401 } as const;
  const db = database();
  const caller = await db.auth.getUser(token);
  if (caller.error || !caller.data.user) return { error: "Invalid token", status: 401 } as const;
  const source = await db.from("coach_groups").select("id,club_id,name").eq("id", sourceGroupId).maybeSingle();
  if (source.error || !source.data) return { error: "Groupe source introuvable.", status: 404 } as const;
  const membership = await db.from("club_members")
    .select("id,can_transfer_players_between_club_groups")
    .eq("club_id", source.data.club_id).eq("user_id", caller.data.user.id).eq("role", "coach").eq("is_active", true).maybeSingle();
  if (membership.error || !membership.data?.can_transfer_players_between_club_groups) return { error: "Forbidden", status: 403 } as const;
  const player = await db.from("club_members").select("id").eq("club_id", source.data.club_id).eq("user_id", playerId).eq("role", "player").eq("is_active", true).maybeSingle();
  if (player.error || !player.data) return { error: "Junior introuvable dans ce club.", status: 404 } as const;
  return { db, callerId: caller.data.user.id, clubId: String(source.data.club_id), source: source.data } as const;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const { playerId } = await ctx.params;
    const sourceGroupId = new URL(req.url).searchParams.get("sourceGroupId") ?? "";
    const auth = await context(req, playerId, sourceGroupId);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const [groups, oldEvents] = await Promise.all([
      auth.db.from("coach_groups").select("id,name").eq("club_id", auth.clubId).eq("is_active", true).neq("id", sourceGroupId).order("name"),
      auth.db.from("club_events").select("id", { count: "exact", head: true }).eq("group_id", sourceGroupId).eq("status", "scheduled").gt("starts_at", new Date().toISOString()),
    ]);
    if (groups.error || oldEvents.error) throw new Error(groups.error?.message ?? oldEvents.error?.message);
    return NextResponse.json({ sourceGroup: auth.source, destinationGroups: groups.data ?? [], futureSourceEventsCount: oldEvents.count ?? 0 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const { playerId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const sourceGroupId = String(body.sourceGroupId ?? "");
    const destinationGroupId = String(body.destinationGroupId ?? "");
    const futureEventsAction = String(body.futureEventsAction ?? "keep");
    if (!destinationGroupId || !isFutureTransferAction(futureEventsAction)) return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
    const auth = await context(req, playerId, sourceGroupId);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const result = await auth.db.rpc("coach_transfer_player_group", {
      p_actor_user_id: auth.callerId,
      p_player_user_id: playerId,
      p_source_group_id: sourceGroupId,
      p_destination_group_id: destinationGroupId,
      p_future_events_action: futureEventsAction,
    });
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.message === "Forbidden" ? 403 : 400 });
    return NextResponse.json({ ok: true, transferId: result.data });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Server error" }, { status: 500 });
  }
}
