import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

function buildSenderName(row: any) {
  const full = `${String(row?.first_name ?? "").trim()} ${String(row?.last_name ?? "").trim()}`.trim();
  const fallback = String(row?.username ?? "").trim();
  return full || fallback || "";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
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

    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
    const before = (url.searchParams.get("before") ?? "").trim();

    let query = supabaseAdmin
      .from("thread_messages")
      .select("id,thread_id,sender_user_id,message_type,body,payload,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) query = query.lt("created_at", before);

    const msgRes = await query;
    if (msgRes.error) return NextResponse.json({ error: msgRes.error.message }, { status: 400 });

    const rows = msgRes.data ?? [];
    const senderIds = Array.from(new Set(rows.map((r: any) => String(r.sender_user_id ?? "")).filter(Boolean)));
    const namesById = new Map<string, string>();
    if (senderIds.length > 0) {
      const profRes = await supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", senderIds);
      if (!profRes.error) {
        for (const p of profRes.data ?? []) {
          namesById.set(String((p as any).id), buildSenderName(p));
        }
      }
    }

    const enriched = rows.map((r: any) => ({
      ...r,
      sender_name: namesById.get(String(r.sender_user_id ?? "")) || null,
    }));
    return NextResponse.json({ messages: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ threadId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { threadId } = await ctx.params;
    if (!threadId) return NextResponse.json({ error: "Missing threadId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const messageType = String(body?.message_type ?? "text").trim();
    const content = String(body?.body ?? "").trim();
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
    if (!content && messageType === "text") return NextResponse.json({ error: "Missing body" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const canPostRes = await supabaseAdmin.rpc("can_post_message_thread", {
      p_thread_id: threadId,
      p_user_id: callerId,
    });
    if (canPostRes.error) return NextResponse.json({ error: canPostRes.error.message }, { status: 400 });
    if (!canPostRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const insRes = await supabaseAdmin
      .from("thread_messages")
      .insert({
        thread_id: threadId,
        sender_user_id: callerId,
        message_type: messageType,
        body: content,
        payload,
      })
      .select("id,thread_id,sender_user_id,message_type,body,payload,created_at")
      .single();
    if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });

    const senderProfileRes = await supabaseAdmin
      .from("profiles")
      .select("first_name,last_name,username")
      .eq("id", callerId)
      .maybeSingle();
    const senderName = senderProfileRes.error ? "" : buildSenderName(senderProfileRes.data ?? {});

    const threadRes = await supabaseAdmin
      .from("message_threads")
      .select("thread_type,event_id")
      .eq("id", threadId)
      .maybeSingle();
    if (!threadRes.error && threadRes.data?.thread_type === "event" && threadRes.data?.event_id) {
      await supabaseAdmin.rpc("sync_event_thread_participants", {
        p_event_id: String(threadRes.data.event_id),
      });
    }

    return NextResponse.json({
      message: {
        ...(insRes.data as any),
        sender_name: senderName || null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
