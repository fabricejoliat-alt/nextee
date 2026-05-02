import { NextResponse, type NextRequest } from "next/server";
import { loadValidationDashboard, resolveValidationPlayerAccess } from "@/app/api/validations/_lib";

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ attemptId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { attemptId: rawAttemptId } = await context.params;
    const attemptId = String(rawAttemptId ?? "").trim();
    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();

    if (!attemptId) return NextResponse.json({ error: "Missing attemptId" }, { status: 400 });

    const access = await resolveValidationPlayerAccess(accessToken, childId, "edit");

    const attemptRes = await access.supabaseAdmin
      .from("player_validation_attempts")
      .select("id")
      .eq("id", attemptId)
      .eq("player_id", access.effectivePlayerId)
      .maybeSingle();
    if (attemptRes.error) return NextResponse.json({ error: attemptRes.error.message }, { status: 400 });
    if (!attemptRes.data?.id) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });

    const deleteRes = await access.supabaseAdmin
      .from("player_validation_attempts")
      .delete()
      .eq("id", attemptId)
      .eq("player_id", access.effectivePlayerId);
    if (deleteRes.error) return NextResponse.json({ error: deleteRes.error.message }, { status: 400 });

    const dashboard = await loadValidationDashboard(
      access.supabaseAdmin,
      access.effectivePlayerId,
      access.viewerUserId,
      access.canRecordAttempts
    );

    return NextResponse.json({
      ok: true,
      dashboard,
    });
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status?: number }).status ?? 500)
        : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status });
  }
}
