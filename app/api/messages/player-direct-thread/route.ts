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

    const getGuardians = async () => {
      const guardiansRes = await supabaseAdmin
        .from("player_guardians")
        .select("guardian_user_id,can_view")
        .eq("player_id", effectivePlayerId)
        .or("can_view.is.null,can_view.eq.true");
      if (guardiansRes.error) throw new Error(guardiansRes.error.message);
      return Array.from(
        new Set((guardiansRes.data ?? []).map((r: any) => String(r.guardian_user_id ?? "").trim()).filter(Boolean))
      );
    };

    async function threadMatchesExpectedParticipants(threadId: string, guardianIds: string[]) {
      const participantsRes = await supabaseAdmin
        .from("thread_participants")
        .select("user_id")
        .eq("thread_id", threadId);
      if (participantsRes.error) throw new Error(participantsRes.error.message);

      const participants = Array.from(
        new Set((participantsRes.data ?? []).map((row: any) => String(row.user_id ?? "").trim()).filter(Boolean))
      );
      const allowed = new Set([effectivePlayerId, staffUserId, ...guardianIds]);
      if (!participants.includes(effectivePlayerId) || !participants.includes(staffUserId)) return false;
      for (const uid of participants) {
        if (!allowed.has(uid)) return false;
      }
      return true;
    }

    async function sanitizeThreadParticipants(threadId: string, guardianIds: string[]) {
      const participantsRes = await supabaseAdmin
        .from("thread_participants")
        .select("user_id")
        .eq("thread_id", threadId);
      if (participantsRes.error) throw new Error(participantsRes.error.message);

      const allowed = new Set([effectivePlayerId, staffUserId, ...guardianIds]);
      const toRemove = Array.from(
        new Set(
          (participantsRes.data ?? [])
            .map((row: any) => String(row.user_id ?? "").trim())
            .filter((uid: string) => Boolean(uid) && !allowed.has(uid))
        )
      );
      if (toRemove.length > 0) {
        await supabaseAdmin.from("thread_participants").delete().eq("thread_id", threadId).in("user_id", toRemove);
      }
    }

    const normalizeDirectThread = async (threadId: string) => {
      const normalizedRes = await supabaseAdmin
        .from("message_threads")
        .update({
          title: "Discussion",
          player_thread_scope: "direct",
          is_active: true,
          created_by: staffUserId,
        })
        .eq("id", threadId)
        .select(threadSelect)
        .single();
      if (normalizedRes.error) throw new Error(normalizedRes.error.message);
      return normalizedRes.data;
    };

    const findExistingThreadForPair = async () => {
      const guardianIds = await getGuardians();
      const exactRes = await supabaseAdmin
        .from("message_threads")
        .select(threadSelect)
        .eq("organization_id", organizationId)
        .eq("thread_type", "player")
        .eq("player_id", effectivePlayerId)
        .eq("created_by", staffUserId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (exactRes.error) throw new Error(exactRes.error.message);
      if (exactRes.data) {
        const normalized = await normalizeDirectThread(String(exactRes.data.id ?? "").trim());
        await sanitizeThreadParticipants(String(normalized.id ?? ""), guardianIds);
        return normalized;
      }

      const candidatesRes = await supabaseAdmin
        .from("message_threads")
        .select(threadSelect)
        .eq("organization_id", organizationId)
        .eq("thread_type", "player")
        .eq("player_id", effectivePlayerId)
        .order("updated_at", { ascending: false });
      if (candidatesRes.error) throw new Error(candidatesRes.error.message);

      for (const candidate of candidatesRes.data ?? []) {
        const threadId = String((candidate as any).id ?? "").trim();
        if (!threadId) continue;
        if (await threadMatchesExpectedParticipants(threadId, guardianIds)) {
          const normalized = await normalizeDirectThread(threadId);
          await sanitizeThreadParticipants(threadId, guardianIds);
          return normalized;
        }
      }

      return null;
    };

    let thread = await findExistingThreadForPair();
    if (!thread) {
      const insertPayload = {
        organization_id: organizationId,
        thread_type: "player",
        title: "Discussion",
        player_id: effectivePlayerId,
        player_thread_scope: "direct",
        created_by: staffUserId,
        is_locked: false,
        is_active: true,
      };
      const insertRes = await supabaseAdmin.from("message_threads").insert(insertPayload).select(threadSelect).single();
      if (insertRes.error) {
        const retryThread = await findExistingThreadForPair();
        if (retryThread) {
          thread = retryThread as any;
        } else {
          return NextResponse.json({ error: insertRes.error.message }, { status: 400 });
        }
      } else {
        thread = insertRes.data as any;
      }
    }

    const threadId = String((thread as any)?.id ?? "").trim();
    if (!threadId) return NextResponse.json({ error: "Thread not found" }, { status: 400 });

    const guardianIds = await getGuardians();

    const participantRows: Array<{ thread_id: string; user_id: string; can_post: boolean }> = [
      { thread_id: threadId, user_id: effectivePlayerId, can_post: true },
      { thread_id: threadId, user_id: staffUserId, can_post: true },
      ...guardianIds.map((guardianId) => ({ thread_id: threadId, user_id: guardianId, can_post: true })),
    ];
    if (participantRows.length > 0) {
      const participantUserIds = Array.from(new Set(participantRows.map((row) => row.user_id)));
      await supabaseAdmin.from("thread_participants").delete().eq("thread_id", threadId).in("user_id", participantUserIds);
      await supabaseAdmin.from("thread_participants").insert(participantRows);
    }

    const existingParticipantsRes = await supabaseAdmin.from("thread_participants").select("user_id").eq("thread_id", threadId);
    if (!existingParticipantsRes.error) {
      const allowed = new Set([effectivePlayerId, staffUserId, ...guardianIds]);
      const toRemove = Array.from(
        new Set(
          (existingParticipantsRes.data ?? [])
            .map((r: any) => String(r.user_id ?? "").trim())
            .filter((uid: string) => Boolean(uid) && !allowed.has(uid))
        )
      );
      if (toRemove.length > 0) {
        await supabaseAdmin.from("thread_participants").delete().eq("thread_id", threadId).in("user_id", toRemove);
      }
    }

    return NextResponse.json({ thread });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
