import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function POST(req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { threadId } = await ctx.params;
    if (!threadId) return NextResponse.json({ error: "Missing threadId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const canReadRes = await supabaseAdmin.rpc("can_read_message_thread", {
      p_thread_id: threadId,
      p_user_id: callerId,
    });
    if (canReadRes.error) return NextResponse.json({ error: canReadRes.error.message }, { status: 400 });
    if (!canReadRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const upRes = await supabaseAdmin
      .from("thread_participants")
      .upsert(
        {
          thread_id: threadId,
          user_id: callerId,
          last_read_at: new Date().toISOString(),
          can_post: true,
        },
        { onConflict: "thread_id,user_id" }
      )
      .select("thread_id,user_id,last_read_at")
      .single();
    if (upRes.error) return NextResponse.json({ error: upRes.error.message }, { status: 400 });

    return NextResponse.json({ read: upRes.data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

