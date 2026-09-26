import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, resolvePlayerAccess } from "@/app/api/camps/_lib";
import { mapPlayerTransactionError } from "@/lib/playerTransactionErrors";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId: rawEventId } = await params;
    const eventId = String(rawEventId ?? "").trim();
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const nextStatus = String(body?.status ?? "").trim();
    if (nextStatus !== "present" && nextStatus !== "absent") {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolvePlayerAccess(supabaseAdmin, accessToken, childId, "edit");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    const result = await supabaseAdmin.rpc("set_player_camp_attendance_transactional", {
      p_event_id: eventId,
      p_player_id: access.effectiveUserId,
      p_actor_id: access.viewerUserId,
      p_status: nextStatus,
    });
    if (result.error) {
      const mapped = mapPlayerTransactionError(result.error, "Mise à jour de la présence impossible.");
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    return NextResponse.json(result.data ?? { ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
