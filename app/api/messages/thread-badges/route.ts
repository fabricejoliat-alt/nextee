import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

type Badge = {
  message_count: number;
  unread_count: number;
};

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const raw = (new URL(req.url).searchParams.get("thread_ids") ?? "").trim();
    const threadIds = Array.from(
      new Set(
        raw
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      )
    ).slice(0, 300);
    if (threadIds.length === 0) return NextResponse.json({ badges: {} });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const participantRes = await supabaseAdmin
      .from("thread_participants")
      .select("thread_id,last_read_at")
      .eq("user_id", callerId)
      .in("thread_id", threadIds);
    if (participantRes.error) return NextResponse.json({ error: participantRes.error.message }, { status: 400 });

    const participantByThread = new Map<string, { last_read_at: string | null }>();
    for (const row of participantRes.data ?? []) {
      participantByThread.set(String((row as any).thread_id ?? ""), {
        last_read_at: (row as any).last_read_at ?? null,
      });
    }

    const visibleThreadIds = threadIds.filter((id) => participantByThread.has(id));
    if (visibleThreadIds.length === 0) {
      const emptyBadges: Record<string, Badge> = {};
      for (const id of threadIds) emptyBadges[id] = { message_count: 0, unread_count: 0 };
      return NextResponse.json({ badges: emptyBadges });
    }

    const messagesRes = await supabaseAdmin
      .from("thread_messages")
      .select("thread_id,created_at")
      .in("thread_id", visibleThreadIds);
    if (messagesRes.error) return NextResponse.json({ error: messagesRes.error.message }, { status: 400 });

    const countByThread = new Map<string, number>();
    const unreadByThread = new Map<string, number>();
    for (const row of messagesRes.data ?? []) {
      const tid = String((row as any).thread_id ?? "");
      if (!tid) continue;
      countByThread.set(tid, (countByThread.get(tid) ?? 0) + 1);

      const participant = participantByThread.get(tid);
      const lastReadAt = participant?.last_read_at ? new Date(participant.last_read_at).getTime() : 0;
      const createdAt = new Date(String((row as any).created_at ?? "")).getTime();
      if (createdAt > lastReadAt) unreadByThread.set(tid, (unreadByThread.get(tid) ?? 0) + 1);
    }

    const badges: Record<string, Badge> = {};
    for (const id of threadIds) {
      badges[id] = {
        message_count: countByThread.get(id) ?? 0,
        unread_count: unreadByThread.get(id) ?? 0,
      };
    }

    return NextResponse.json({ badges });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

