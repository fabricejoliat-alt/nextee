import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CoachPlanningAccessError, loadCoachGroupPlanning } from "@/lib/server/coachGroupPlanning";

export async function GET(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ code: "unauthorized" }, { status: 401, headers });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("configuration_unavailable");
    const db = createClient(url, key);
    const caller = await db.auth.getUser(token);
    if (caller.error || !caller.data.user) return NextResponse.json({ code: "unauthorized" }, { status: 401, headers });
    const { groupId } = await ctx.params;
    if (!groupId.trim()) return NextResponse.json({ code: "group_not_found" }, { status: 404, headers });
    return NextResponse.json(await loadCoachGroupPlanning(db, caller.data.user.id, groupId), { headers });
  } catch (cause) {
    const status = cause instanceof CoachPlanningAccessError ? cause.status : 500;
    return NextResponse.json({ code: status === 403 ? "forbidden" : status === 404 ? "group_not_found" : "planning_load_failed" }, { status, headers });
  }
}
