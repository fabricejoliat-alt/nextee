import { NextResponse, type NextRequest } from "next/server";
import { ensureExerciseUnlockedForPlayer, loadValidationDashboard, resolveValidationPlayerAccess } from "@/app/api/validations/_lib";

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const childId = String(body?.child_id ?? "").trim();
    const exerciseId = String(body?.exercise_id ?? "").trim();
    const rawResult = String(body?.result ?? "").trim().toLowerCase();
    const note = String(body?.note ?? "").trim() || null;
    const attemptedAtRaw = String(body?.attempted_at ?? "").trim();

    if (!exerciseId) return NextResponse.json({ error: "Missing exercise_id" }, { status: 400 });
    if (rawResult !== "success" && rawResult !== "failure") {
      return NextResponse.json({ error: "Invalid result" }, { status: 400 });
    }

    let attemptedAtIso: string | null = null;
    if (attemptedAtRaw) {
      const parsed = new Date(attemptedAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid attempted_at" }, { status: 400 });
      }
      attemptedAtIso = parsed.toISOString();
    }

    const access = await resolveValidationPlayerAccess(accessToken, childId, "edit");
    await ensureExerciseUnlockedForPlayer(access.supabaseAdmin, access.effectivePlayerId, exerciseId);

    const insertRes = await access.supabaseAdmin
      .from("player_validation_attempts")
      .insert({
        player_id: access.effectivePlayerId,
        exercise_id: exerciseId,
        result: rawResult,
        created_by_user_id: access.viewerUserId,
        note,
        attempted_at: attemptedAtIso ?? undefined,
      })
      .select("id")
      .single();
    if (insertRes.error) return NextResponse.json({ error: insertRes.error.message }, { status: 400 });

    const dashboard = await loadValidationDashboard(
      access.supabaseAdmin,
      access.effectivePlayerId,
      access.viewerUserId,
      access.canRecordAttempts
    );

    return NextResponse.json({
      ok: true,
      attempt_id: String(insertRes.data.id ?? ""),
      dashboard,
    });
  } catch (error: unknown) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status ?? 500) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status });
  }
}
