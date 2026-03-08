import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

export async function GET(req: NextRequest, ctx: { params: Promise<{ playerId: string }> }) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { playerId } = await ctx.params;
    if (!playerId) return NextResponse.json({ error: "Missing playerId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const staffRes = await supabaseAdmin
      .from("club_members")
      .select("club_id,role")
      .eq("user_id", callerId)
      .eq("is_active", true)
      .in("role", ["coach", "manager"]);
    if (staffRes.error) return NextResponse.json({ error: staffRes.error.message }, { status: 400 });
    if ((staffRes.data ?? []).length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const playerMembershipsRes = await supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", playerId)
      .eq("is_active", true);
    if (playerMembershipsRes.error) return NextResponse.json({ error: playerMembershipsRes.error.message }, { status: 400 });

    const callerOrgIds = new Set((staffRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean));
    const playerOrgIds = new Set((playerMembershipsRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean));
    const sharedMembershipOrgIds = Array.from(new Set([...callerOrgIds].filter((id) => playerOrgIds.has(id))));

    const [playerGroupsRes, callerCoachGroupsRes] = await Promise.all([
      supabaseAdmin
        .from("coach_group_players")
        .select("group_id")
        .eq("player_user_id", playerId),
      supabaseAdmin
        .from("coach_group_coaches")
        .select("group_id")
        .eq("coach_user_id", callerId),
    ]);
    if (playerGroupsRes.error) return NextResponse.json({ error: playerGroupsRes.error.message }, { status: 400 });
    if (callerCoachGroupsRes.error) return NextResponse.json({ error: callerCoachGroupsRes.error.message }, { status: 400 });

    const playerGroupIds = new Set((playerGroupsRes.data ?? []).map((r: any) => String(r.group_id ?? "")).filter(Boolean));
    const sharedGroupIds = Array.from(
      new Set(
        (callerCoachGroupsRes.data ?? [])
          .map((r: any) => String(r.group_id ?? ""))
          .filter((gid: string) => Boolean(gid) && playerGroupIds.has(gid))
      )
    );

    let sharedGroupOrgIds: string[] = [];
    if (sharedGroupIds.length > 0) {
      const groupOrgRes = await supabaseAdmin
        .from("coach_groups")
        .select("id,club_id")
        .in("id", sharedGroupIds);
      if (groupOrgRes.error) return NextResponse.json({ error: groupOrgRes.error.message }, { status: 400 });
      sharedGroupOrgIds = Array.from(
        new Set((groupOrgRes.data ?? []).map((r: any) => String(r.club_id ?? "")).filter(Boolean))
      );
    }

    const allowedOrgIds = Array.from(new Set([...sharedMembershipOrgIds, ...sharedGroupOrgIds]));
    if (allowedOrgIds.length === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    // Canonical thread selection:
    // 1) prefer thread with highest message count
    // 2) then most recent message
    // 3) fallback to most recent updated_at.
    let chosenFromExisting: { id: string; organization_id: string; updated_at: string } | null = null;
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
          if (!tid || lastMsgByThread.has(tid)) continue;
          lastMsgByThread.set(tid, String((row as any).created_at ?? ""));
        }
        for (const row of lastMsgsRes.data ?? []) {
          const tid = String((row as any).thread_id ?? "");
          if (!tid) continue;
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
        chosenFromExisting = sorted[0] ?? null;
      } else {
        chosenFromExisting = existingThreads[0] ?? null;
      }
    }
    let chosen: { id: string; organization_id: string; updated_at: string } | null = chosenFromExisting;

    if (!chosen) {
      const insRes = await supabaseAdmin
        .from("message_threads")
        .insert({
          organization_id: allowedOrgIds[0],
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
