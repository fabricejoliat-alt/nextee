import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { fetchVisiblePlayerNews } from "@/app/api/news/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const requestedChildId = String(new URL(req.url).searchParams.get("child_id") ?? "").trim() || null;

    const payload = await fetchVisiblePlayerNews({
      supabaseAdmin,
      callerId,
      requestedChildId,
    });

    return NextResponse.json(payload);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
