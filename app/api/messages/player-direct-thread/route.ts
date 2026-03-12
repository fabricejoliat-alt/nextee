import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

type Body = {
  organization_id?: string;
  staff_user_id?: string;
  child_id?: string;
};

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Body;
    const organizationId = String(body.organization_id ?? "").trim();
    const staffUserId = String(body.staff_user_id ?? "").trim();
    const childId = String(body.child_id ?? "").trim();
    if (!organizationId || !staffUserId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    let effectivePlayerId = callerId;
    if (childId && childId !== callerId) {
      const guardianRes = await supabaseAdmin
        .from("player_guardians")
        .select("player_id")
        .eq("guardian_user_id", callerId)
        .eq("player_id", childId)
        .eq("can_view", true)
        .maybeSingle();
      if (guardianRes.error) return NextResponse.json({ error: guardianRes.error.message }, { status: 400 });
      if (!guardianRes.data?.player_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      effectivePlayerId = String(guardianRes.data.player_id);
    }

    const [playerMembershipRes, staffMembershipRes] = await Promise.all([
      supabaseAdmin
        .from("club_members")
        .select("id")
        .eq("club_id", organizationId)
        .eq("user_id", effectivePlayerId)
        .eq("is_active", true)
        .eq("role", "player")
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("club_members")
        .select("id,role")
        .eq("club_id", organizationId)
        .eq("user_id", staffUserId)
        .eq("is_active", true)
        .in("role", ["manager", "coach"])
        .limit(1)
        .maybeSingle(),
    ]);
    if (playerMembershipRes.error) return NextResponse.json({ error: playerMembershipRes.error.message }, { status: 400 });
    if (staffMembershipRes.error) return NextResponse.json({ error: staffMembershipRes.error.message }, { status: 400 });
    if (!playerMembershipRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!staffMembershipRes.data) return NextResponse.json({ error: "Invalid staff member" }, { status: 400 });

    const threadSelect =
      "id,organization_id,thread_type,title,group_id,event_id,player_id,player_thread_scope,created_by,is_locked,is_active,created_at,updated_at";

    const findExistingThreadForPair = async () => {
      const threadsRes = await supabaseAdmin
        .from("message_threads")
        .select(threadSelect)
        .eq("organization_id", organizationId)
        .eq("thread_type", "player")
        .eq("player_id", effectivePlayerId)
        .eq("player_thread_scope", "direct")
        .eq("is_active", true)
        .order("updated_at", { ascending: false });
      if (threadsRes.error) throw new Error(threadsRes.error.message);
      const threads = (threadsRes.data ?? []) as any[];
      if (threads.length === 0) return null;

      const threadIds = threads.map((t) => String((t as any).id ?? "").trim()).filter(Boolean);
      if (threadIds.length === 0) return null;

      const participantsRes = await supabaseAdmin
        .from("thread_participants")
        .select("thread_id,user_id")
        .in("thread_id", threadIds)
        .in("user_id", [effectivePlayerId, staffUserId]);
      if (participantsRes.error) throw new Error(participantsRes.error.message);

      const usersByThread = new Map<string, Set<string>>();
      for (const row of participantsRes.data ?? []) {
        const tid = String((row as any).thread_id ?? "").trim();
        const uid = String((row as any).user_id ?? "").trim();
        if (!tid || !uid) continue;
        if (!usersByThread.has(tid)) usersByThread.set(tid, new Set<string>());
        usersByThread.get(tid)!.add(uid);
      }

      for (const t of threads) {
        const tid = String((t as any).id ?? "").trim();
        const users = usersByThread.get(tid);
        if (!users) continue;
        if (users.has(effectivePlayerId) && users.has(staffUserId)) return t;
      }

      return null;
    };

    let thread = await findExistingThreadForPair();
    if (!thread) {
      const insertRes = await supabaseAdmin
        .from("message_threads")
        .insert({
          organization_id: organizationId,
          thread_type: "player",
          title: "Discussion",
          player_id: effectivePlayerId,
          player_thread_scope: "direct",
          created_by: staffUserId,
          is_locked: false,
          is_active: true,
        })
        .select(threadSelect)
        .single();
      if (insertRes.error) {
        // Retry on unique race / legacy uniqueness by re-resolving via participants pair.
        const retryThread = await findExistingThreadForPair();
        if (!retryThread) {
          const fallbackRes = await supabaseAdmin
            .from("message_threads")
            .select(threadSelect)
            .eq("organization_id", organizationId)
            .eq("thread_type", "player")
            .eq("player_id", effectivePlayerId)
            .eq("player_thread_scope", "direct")
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(50);
          if (fallbackRes.error) {
            return NextResponse.json({ error: insertRes.error.message }, { status: 400 });
          }
          const fallbackRows = (fallbackRes.data ?? []) as any[];
          if (fallbackRows.length === 1) {
            // Legacy uniqueness mode: one direct thread per player/org.
            thread = fallbackRows[0] as any;
          } else {
            return NextResponse.json({ error: insertRes.error.message }, { status: 400 });
          }
        } else {
          thread = retryThread as any;
        }
      } else {
        thread = insertRes.data as any;
      }
    }

    const threadId = String((thread as any)?.id ?? "").trim();
    if (!threadId) return NextResponse.json({ error: "Thread not found" }, { status: 400 });

    const guardiansRes = await supabaseAdmin
      .from("player_guardians")
      .select("guardian_user_id,can_view")
      .eq("player_id", effectivePlayerId)
      .or("can_view.is.null,can_view.eq.true");
    if (guardiansRes.error) return NextResponse.json({ error: guardiansRes.error.message }, { status: 400 });

    const participantRows: Array<{ thread_id: string; user_id: string; can_post: boolean }> = [
      { thread_id: threadId, user_id: effectivePlayerId, can_post: true },
      { thread_id: threadId, user_id: staffUserId, can_post: true },
      ...((guardiansRes.data ?? [])
        .map((r: any) => String(r.guardian_user_id ?? "").trim())
        .filter(Boolean)
        .map((guardianId) => ({ thread_id: threadId, user_id: guardianId, can_post: true }))),
    ];
    if (participantRows.length > 0) {
      await supabaseAdmin.from("thread_participants").upsert(participantRows, { onConflict: "thread_id,user_id" });
    }

    return NextResponse.json({ thread });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
