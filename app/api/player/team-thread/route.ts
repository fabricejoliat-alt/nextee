import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function GET(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);
    const url = new URL(req.url);
    const requestedPlayerId = String(url.searchParams.get("player_id") ?? "").trim();
    const playerId = requestedPlayerId || callerId;
    if (!playerId) return NextResponse.json({ error: "Missing player_id" }, { status: 400 });

    if (callerId !== playerId) {
      const parentLinkRes = await supabaseAdmin
        .from("player_guardians")
        .select("id")
        .eq("player_id", playerId)
        .eq("guardian_user_id", callerId)
        .or("can_view.is.null,can_view.eq.true")
        .limit(1)
        .maybeSingle();
      if (parentLinkRes.error) return NextResponse.json({ error: parentLinkRes.error.message }, { status: 400 });
      if (!parentLinkRes.data) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existingThreadsRes = await supabaseAdmin
      .from("message_threads")
      .select("id,organization_id,updated_at")
      .eq("thread_type", "player")
      .eq("player_id", playerId)
      .eq("player_thread_scope", "team")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (existingThreadsRes.error) return NextResponse.json({ error: existingThreadsRes.error.message }, { status: 400 });

    const existingThreads = (existingThreadsRes.data ?? []) as Array<{ id: string; organization_id: string; updated_at: string }>;

    let chosen: { id: string; organization_id: string; updated_at: string } | null = null;
    if (existingThreads.length > 0) {
      const threadIds = existingThreads.map((t) => String(t.id)).filter(Boolean);
      const lastMsgsRes = await supabaseAdmin
        .from("thread_messages")
        .select("thread_id,created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false })
        .limit(5000);

      if (!lastMsgsRes.error) {
        const lastMsgByThread = new Map<string, string>();
        const countByThread = new Map<string, number>();

        for (const row of lastMsgsRes.data ?? []) {
          const tid = String((row as any).thread_id ?? "");
          if (!tid) continue;
          if (!lastMsgByThread.has(tid)) lastMsgByThread.set(tid, String((row as any).created_at ?? ""));
          countByThread.set(tid, (countByThread.get(tid) ?? 0) + 1);
        }

        const sorted = [...existingThreads].sort((a, b) => {
          const aCount = countByThread.get(String(a.id)) ?? 0;
          const bCount = countByThread.get(String(b.id)) ?? 0;
          if (aCount !== bCount) return bCount - aCount;
          const aLastTs = new Date(lastMsgByThread.get(String(a.id)) || 0).getTime();
          const bLastTs = new Date(lastMsgByThread.get(String(b.id)) || 0).getTime();
          if (aLastTs !== bLastTs) return bLastTs - aLastTs;
          const aTs = new Date(a.updated_at || 0).getTime();
          const bTs = new Date(b.updated_at || 0).getTime();
          return bTs - aTs;
        });

        chosen = sorted[0] ?? null;
      } else {
        chosen = existingThreads[0] ?? null;
      }
    }

    if (!chosen) {
      const playerMembershipRes = await supabaseAdmin
        .from("club_members")
        .select("club_id")
        .eq("user_id", playerId)
        .eq("is_active", true)
        .eq("role", "player")
        .order("club_id", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (playerMembershipRes.error) return NextResponse.json({ error: playerMembershipRes.error.message }, { status: 400 });

      const organizationId = String(playerMembershipRes.data?.club_id ?? "").trim();
      if (!organizationId) return NextResponse.json({ error: "Player has no active organization" }, { status: 400 });

      const insRes = await supabaseAdmin
        .from("message_threads")
        .insert({
          organization_id: organizationId,
          thread_type: "player",
          title: "Fil équipe coachs + joueur + parent(s)",
          player_id: playerId,
          player_thread_scope: "team",
          created_by: callerId,
          is_locked: false,
          is_active: true,
        })
        .select("id,organization_id,updated_at")
        .single();
      if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });
      chosen = insRes.data as any;
    } else {
      await supabaseAdmin
        .from("message_threads")
        .update({ title: "Fil équipe coachs + joueur + parent(s)" })
        .eq("id", chosen.id);
    }

    const playerGroupsRes = await supabaseAdmin
      .from("coach_group_players")
      .select("group_id")
      .eq("player_user_id", playerId);
    if (playerGroupsRes.error) return NextResponse.json({ error: playerGroupsRes.error.message }, { status: 400 });
    const allPlayerGroupIds = Array.from(
      new Set((playerGroupsRes.data ?? []).map((r: any) => String(r.group_id ?? "")).filter(Boolean))
    );

    let eligibleCoachIds: string[] = [];
    if (allPlayerGroupIds.length > 0) {
      const [groupCoachesRes, activeCoachRes] = await Promise.all([
        supabaseAdmin
          .from("coach_group_coaches")
          .select("coach_user_id")
          .in("group_id", allPlayerGroupIds),
        supabaseAdmin
          .from("club_members")
          .select("user_id")
          .eq("is_active", true)
          .eq("role", "coach"),
      ]);
      if (groupCoachesRes.error) return NextResponse.json({ error: groupCoachesRes.error.message }, { status: 400 });
      if (activeCoachRes.error) return NextResponse.json({ error: activeCoachRes.error.message }, { status: 400 });

      const activeCoachIds = new Set((activeCoachRes.data ?? []).map((r: any) => String(r.user_id ?? "")).filter(Boolean));
      eligibleCoachIds = Array.from(
        new Set(
          (groupCoachesRes.data ?? [])
            .map((r: any) => String(r.coach_user_id ?? ""))
            .filter((id: string) => Boolean(id) && activeCoachIds.has(id))
        )
      );
    }

    const guardiansRes = await supabaseAdmin
      .from("player_guardians")
      .select("guardian_user_id,can_view")
      .eq("player_id", playerId);
    if (guardiansRes.error) return NextResponse.json({ error: guardiansRes.error.message }, { status: 400 });
    const guardianIds = Array.from(
      new Set(
        (guardiansRes.data ?? [])
          .filter((r: any) => r.can_view === null || r.can_view === true)
          .map((r: any) => String(r.guardian_user_id ?? ""))
          .filter(Boolean)
      )
    );

    const participantRows = [
      ...eligibleCoachIds.map((uid) => ({ thread_id: chosen.id, user_id: uid, can_post: true })),
      { thread_id: chosen.id, user_id: playerId, can_post: true },
      ...guardianIds.map((uid) => ({ thread_id: chosen.id, user_id: uid, can_post: true })),
    ];
    if (participantRows.length > 0) {
      const upRes = await supabaseAdmin
        .from("thread_participants")
        .upsert(participantRows, { onConflict: "thread_id,user_id" });
      if (upRes.error) return NextResponse.json({ error: upRes.error.message }, { status: 400 });
    }

    return NextResponse.json({
      thread_id: String(chosen.id),
      organization_id: String(chosen.organization_id),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
