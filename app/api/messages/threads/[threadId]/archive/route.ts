import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function POST(req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { threadId } = await ctx.params;
    if (!threadId) return NextResponse.json({ error: "Missing threadId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const archived = Boolean(body?.archived);

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const canReadRes = await supabaseAdmin.rpc("can_read_message_thread", {
      p_thread_id: threadId,
      p_user_id: callerId,
    });
    if (canReadRes.error) return NextResponse.json({ error: canReadRes.error.message }, { status: 400 });
    if (!canReadRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const updateRes = await supabaseAdmin
      .from("thread_participants")
      .update({ is_archived: archived, updated_at: new Date().toISOString() })
      .eq("thread_id", threadId)
      .eq("user_id", callerId)
      .select("thread_id,user_id,is_archived")
      .maybeSingle();
    if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 400 });

    let result = updateRes.data;
    if (!result) {
      const insertRes = await supabaseAdmin
        .from("thread_participants")
        .insert({
          thread_id: threadId,
          user_id: callerId,
          can_post: false,
          is_archived: archived,
        })
        .select("thread_id,user_id,is_archived")
        .single();
      if (insertRes.error) return NextResponse.json({ error: insertRes.error.message }, { status: 400 });
      result = insertRes.data;
    }

    return NextResponse.json({ archived: Boolean(result?.is_archived) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
