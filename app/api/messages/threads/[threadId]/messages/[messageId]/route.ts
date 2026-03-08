import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ threadId: string; messageId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { threadId, messageId } = await ctx.params;
    if (!threadId || !messageId) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 });
    }

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const canReadRes = await supabaseAdmin.rpc("can_read_message_thread", {
      p_thread_id: threadId,
      p_user_id: callerId,
    });
    if (canReadRes.error) return NextResponse.json({ error: canReadRes.error.message }, { status: 400 });
    if (!canReadRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const msgRes = await supabaseAdmin
      .from("thread_messages")
      .select("id,sender_user_id")
      .eq("id", messageId)
      .eq("thread_id", threadId)
      .maybeSingle();
    if (msgRes.error) return NextResponse.json({ error: msgRes.error.message }, { status: 400 });
    if (!msgRes.data) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    if (String(msgRes.data.sender_user_id ?? "") !== callerId) {
      return NextResponse.json({ error: "Only author can delete this message" }, { status: 403 });
    }

    const delRes = await supabaseAdmin
      .from("thread_messages")
      .delete()
      .eq("id", messageId)
      .eq("thread_id", threadId);
    if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

