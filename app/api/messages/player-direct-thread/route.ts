import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";

type Body = {
  organization_id?: string;
  staff_user_id?: string;
};

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Body;
    const organizationId = String(body.organization_id ?? "").trim();
    const staffUserId = String(body.staff_user_id ?? "").trim();
    if (!organizationId || !staffUserId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(accessToken);

    const [playerMembershipRes, staffMembershipRes] = await Promise.all([
      supabaseAdmin
        .from("club_members")
        .select("id")
        .eq("club_id", organizationId)
        .eq("user_id", callerId)
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

    const existingRes = await supabaseAdmin
      .from("message_threads")
      .select("id,organization_id,thread_type,title,group_id,event_id,player_id,player_thread_scope,created_by,is_locked,is_active,created_at,updated_at")
      .eq("organization_id", organizationId)
      .eq("thread_type", "player")
      .eq("player_id", callerId)
      .eq("created_by", staffUserId)
      .eq("player_thread_scope", "direct")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingRes.error) return NextResponse.json({ error: existingRes.error.message }, { status: 400 });

    let thread = existingRes.data as any;
    if (!thread) {
      const insertRes = await supabaseAdmin
        .from("message_threads")
        .insert({
          organization_id: organizationId,
          thread_type: "player",
          title: "Discussion",
          player_id: callerId,
          player_thread_scope: "direct",
          created_by: staffUserId,
          is_locked: false,
          is_active: true,
        })
        .select("id,organization_id,thread_type,title,group_id,event_id,player_id,player_thread_scope,created_by,is_locked,is_active,created_at,updated_at")
        .single();
      if (insertRes.error) {
        // Retry fetch on unique race condition.
        const retryRes = await supabaseAdmin
          .from("message_threads")
          .select("id,organization_id,thread_type,title,group_id,event_id,player_id,player_thread_scope,created_by,is_locked,is_active,created_at,updated_at")
          .eq("organization_id", organizationId)
          .eq("thread_type", "player")
          .eq("player_id", callerId)
          .eq("created_by", staffUserId)
          .eq("player_thread_scope", "direct")
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (retryRes.error || !retryRes.data) {
          return NextResponse.json({ error: insertRes.error.message }, { status: 400 });
        }
        thread = retryRes.data as any;
      } else {
        thread = insertRes.data as any;
      }
    }

    const threadId = String((thread as any)?.id ?? "").trim();
    if (!threadId) return NextResponse.json({ error: "Thread not found" }, { status: 400 });

    const guardiansRes = await supabaseAdmin
      .from("player_guardians")
      .select("guardian_user_id,can_view")
      .eq("player_id", callerId)
      .or("can_view.is.null,can_view.eq.true");
    if (guardiansRes.error) return NextResponse.json({ error: guardiansRes.error.message }, { status: 400 });

    const participantRows: Array<{ thread_id: string; user_id: string; can_post: boolean }> = [
      { thread_id: threadId, user_id: callerId, can_post: true },
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

