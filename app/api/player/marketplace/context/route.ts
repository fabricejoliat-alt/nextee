import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, resolveMarketplaceAccess } from "../_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const childId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim();
    const supabaseAdmin = createAdminClient();
    const access = await resolveMarketplaceAccess(supabaseAdmin, accessToken, childId, "view");
    if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

    return NextResponse.json({
      viewerUserId: access.viewerUserId,
      effectiveUserId: access.effectiveUserId,
      clubIds: access.clubIds,
      preferredClubId: access.preferredClubId,
      phone: access.phone,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

