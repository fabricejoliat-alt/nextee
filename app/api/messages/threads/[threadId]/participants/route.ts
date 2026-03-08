import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

function fullName(row: any) {
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

    const threadRes = await supabaseAdmin
      .from("message_threads")
      .select("id,organization_id,player_id")
      .eq("id", threadId)
      .maybeSingle();
    if (threadRes.error) return NextResponse.json({ error: threadRes.error.message }, { status: 400 });
    if (!threadRes.data) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

    const participantsRes = await supabaseAdmin
      .from("thread_participants")
      .select("user_id")
      .eq("thread_id", threadId);
    if (participantsRes.error) return NextResponse.json({ error: participantsRes.error.message }, { status: 400 });

    const userIds = Array.from(
      new Set((participantsRes.data ?? []).map((r: any) => String(r.user_id ?? "")).filter(Boolean))
    );
    if (userIds.length === 0) {
      return NextResponse.json({ participant_full_names: [], participant_names: [] });
    }

    const [profilesRes, coachesRes, guardiansRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id,first_name,last_name,username")
        .in("id", userIds),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("is_active", true)
        .eq("role", "coach")
        .in("user_id", userIds),
      threadRes.data.player_id
        ? supabaseAdmin
            .from("player_guardians")
            .select("guardian_user_id,can_view")
            .eq("player_id", String(threadRes.data.player_id))
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
    if (coachesRes.error) return NextResponse.json({ error: coachesRes.error.message }, { status: 400 });
    if (guardiansRes.error) return NextResponse.json({ error: guardiansRes.error.message }, { status: 400 });

    const profileById = new Map<string, any>();
    for (const p of profilesRes.data ?? []) profileById.set(String((p as any).id), p);
    const coachIds = new Set((coachesRes.data ?? []).map((r: any) => String(r.user_id ?? "")).filter(Boolean));
    const guardianIds = new Set(
      (guardiansRes.data ?? [])
        .filter((r: any) => r.can_view === null || r.can_view === true)
        .map((r: any) => String(r.guardian_user_id ?? ""))
        .filter(Boolean)
    );

    const entries = userIds.map((uid) => {
      const p = profileById.get(uid);
      const fn = fullName(p ?? {}) || uid.slice(0, 8);
      const first = String((p as any)?.first_name ?? "").trim() || fn;
      const isCoach = coachIds.has(uid);
      const isParent = guardianIds.has(uid);
      return {
        fullName: isParent ? `${fn} (p)` : fn,
        firstName: isParent ? `${first} (p)` : first,
        sortName: fn,
        isCoach,
      };
    });

    entries.sort((a, b) => {
      if (a.isCoach !== b.isCoach) return a.isCoach ? -1 : 1;
      return a.sortName.localeCompare(b.sortName, "fr", { sensitivity: "base" });
    });

    return NextResponse.json({
      participant_full_names: entries.map((e) => e.fullName),
      participant_names: entries.map((e) => e.firstName),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

