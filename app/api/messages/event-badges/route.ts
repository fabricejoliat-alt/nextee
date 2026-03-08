import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

type Badge = {
  thread_id: string | null;
  message_count: number;
  unread_count: number;
};

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const raw = (new URL(req.url).searchParams.get("event_ids") ?? "").trim();
    const eventIds = Array.from(
      new Set(
        raw
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      )
    ).slice(0, 200);
    if (eventIds.length === 0) return NextResponse.json({ badges: {} });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const eventsRes = await supabaseAdmin
      .from("club_events")
      .select("id,club_id")
      .in("id", eventIds);
    if (eventsRes.error) return NextResponse.json({ error: eventsRes.error.message }, { status: 400 });

    const orgByEventId = new Map<string, string>();
    const orgIds = new Set<string>();
    for (const row of eventsRes.data ?? []) {
      const eid = String((row as any).id ?? "");
      const oid = String((row as any).club_id ?? "");
      if (!eid || !oid) continue;
      orgByEventId.set(eid, oid);
      orgIds.add(oid);
    }

    const threadsRes = await supabaseAdmin
      .from("message_threads")
      .select("id,event_id,organization_id,thread_type,is_active")
      .eq("thread_type", "event")
      .eq("is_active", true)
      .in("event_id", eventIds);
    if (threadsRes.error) return NextResponse.json({ error: threadsRes.error.message }, { status: 400 });

    const threadIds = (threadsRes.data ?? []).map((r: any) => String(r.id ?? "")).filter(Boolean);

    const [membersRes, participantRes] = await Promise.all([
      orgIds.size > 0
        ? supabaseAdmin
            .from("club_members")
            .select("club_id,is_active")
            .eq("user_id", callerId)
            .in("club_id", Array.from(orgIds))
        : Promise.resolve({ data: [], error: null } as any),
      threadIds.length > 0
        ? supabaseAdmin
            .from("thread_participants")
            .select("thread_id,user_id,last_read_at")
            .eq("user_id", callerId)
            .in("thread_id", threadIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (membersRes.error) return NextResponse.json({ error: membersRes.error.message }, { status: 400 });
    if (participantRes.error) return NextResponse.json({ error: participantRes.error.message }, { status: 400 });

    const activeOrgMembership = new Set<string>();
    for (const row of membersRes.data ?? []) {
      if ((row as any).is_active === true) activeOrgMembership.add(String((row as any).club_id ?? ""));
    }
    const participantByThread = new Map<string, { last_read_at: string | null }>();
    for (const row of participantRes.data ?? []) {
      participantByThread.set(String((row as any).thread_id ?? ""), { last_read_at: (row as any).last_read_at ?? null });
    }

    const visibleThreads = (threadsRes.data ?? []).filter((t: any) => {
      const threadId = String(t.id ?? "");
      const orgId = String(t.organization_id ?? "") || orgByEventId.get(String(t.event_id ?? "")) || "";
      return participantByThread.has(threadId) || activeOrgMembership.has(orgId);
    });
    const visibleThreadIds = visibleThreads.map((t: any) => String(t.id ?? "")).filter(Boolean);

    const messagesRes =
      visibleThreadIds.length > 0
        ? await supabaseAdmin
            .from("thread_messages")
            .select("thread_id,created_at")
            .in("thread_id", visibleThreadIds)
        : ({ data: [], error: null } as any);
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
      if (participant && createdAt > lastReadAt) {
        unreadByThread.set(tid, (unreadByThread.get(tid) ?? 0) + 1);
      }
    }

    const badges: Record<string, Badge> = {};
    for (const id of eventIds) badges[id] = { thread_id: null, message_count: 0, unread_count: 0 };
    for (const t of visibleThreads) {
      const eid = String((t as any).event_id ?? "");
      const tid = String((t as any).id ?? "");
      if (!eid || !tid) continue;
      badges[eid] = {
        thread_id: tid,
        message_count: countByThread.get(tid) ?? 0,
        unread_count: unreadByThread.get(tid) ?? 0,
      };
    }

    return NextResponse.json({ badges });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

