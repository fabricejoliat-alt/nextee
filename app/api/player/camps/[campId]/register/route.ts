import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, resolvePlayerAccess } from "@/app/api/camps/_lib";
import { mapPlayerTransactionError } from "@/lib/playerTransactionErrors";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  try {
    const { campId: rawCampId } = await params;
    const campId = String(rawCampId ?? "").trim();
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const result = await supabaseAdmin.rpc("set_player_camp_registration_transactional", {
      p_camp_id: campId,
      p_player_id: access.effectiveUserId,
      p_actor_id: access.viewerUserId,
      p_registered: true,
    });
    if (result.error) {
      const mapped = mapPlayerTransactionError(result.error, "Mise à jour de l’inscription impossible.");
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    return NextResponse.json(result.data ?? { ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ campId: string }> }
) {
  try {
    const { campId: rawCampId } = await params;
    const campId = String(rawCampId ?? "").trim();
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    if (!campId) return NextResponse.json({ error: "Missing campId" }, { status: 400 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const result = await supabaseAdmin.rpc("set_player_camp_registration_transactional", {
      p_camp_id: campId,
      p_player_id: access.effectiveUserId,
      p_actor_id: access.viewerUserId,
      p_registered: false,
    });
    if (result.error) {
      const mapped = mapPlayerTransactionError(result.error, "Mise à jour de l’inscription impossible.");
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    return NextResponse.json(result.data ?? { ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
