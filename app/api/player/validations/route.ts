import { NextResponse, type NextRequest } from "next/server";
import { loadValidationDashboard, resolveValidationPlayerAccess } from "@/app/api/validations/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const access = await resolveValidationPlayerAccess(accessToken, childId, "view");
    const dashboard = await loadValidationDashboard(
      access.supabaseAdmin,
      access.effectivePlayerId,
      access.viewerUserId,
      access.canRecordAttempts
    );

    return NextResponse.json(dashboard);
  } catch (error: unknown) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status ?? 500) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status });
  }
}
