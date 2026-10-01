import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, getCaller, normalizeText } from "@/app/api/camps/_lib";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ campId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { campId } = await ctx.params;
    if (!normalizeText(campId)) return NextResponse.json({ error: "Missing campId" }, { status: 400 });
    const body = await req.json();
    const registrations = body?.player_registrations ?? [];
    if (!Array.isArray(registrations)) return NextResponse.json({ error: "Invalid registrations" }, { status: 400 });
    const db = createAdminClient();
    const caller = await getCaller(db, token);
    if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
    const result = await db.rpc("patch_coach_camp_registrations_v1", {
      p_camp_id: campId, p_actor_id: caller.userId, p_registrations: registrations,
    });
    if (result.error) {
      const message = result.error.message;
      return NextResponse.json({ error: message }, { status: message === "forbidden" ? 403 : message === "camp_not_found" ? 404 : 400 });
    }
    return NextResponse.json(result.data);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
