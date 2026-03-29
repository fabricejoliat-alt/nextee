import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { fetchVisibleCoachNews } from "@/app/api/news/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const payload = await fetchVisibleCoachNews({ supabaseAdmin, callerId });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
