import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

async function resolveSharedCoachOrManagerOrgs(supabaseAdmin: any, callerId: string, playerId: string) {
  const [coachRes, playerRes] = await Promise.all([
    supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", callerId)
      .eq("is_active", true)
      .in("role", ["manager", "coach"]),
    supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", playerId)
      .eq("is_active", true)
      .eq("role", "player"),
  ]);
  if (coachRes.error) throw new Error(coachRes.error.message);
  if (playerRes.error) throw new Error(playerRes.error.message);

  const coachOrgs = new Set<string>((coachRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean));
  const shared = Array.from(
    new Set((playerRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter((id: string) => coachOrgs.has(id)))
  );
  return shared;
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ playerId: string; documentId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { playerId, documentId } = await ctx.params;
    if (!playerId || !documentId) return NextResponse.json({ error: "Missing params" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const sharedOrgIds = await resolveSharedCoachOrManagerOrgs(supabaseAdmin, callerId, playerId);
    if (sharedOrgIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const docRes = await supabaseAdmin
      .from("player_dashboard_documents")
      .select("id,organization_id,storage_path")
      .eq("id", documentId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (docRes.error) return NextResponse.json({ error: docRes.error.message }, { status: 400 });
    if (!docRes.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!sharedOrgIds.includes(String(docRes.data.organization_id ?? ""))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await supabaseAdmin.storage.from("marketplace").remove([String(docRes.data.storage_path ?? "")]);
    const delRes = await supabaseAdmin.from("player_dashboard_documents").delete().eq("id", documentId);
    if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

