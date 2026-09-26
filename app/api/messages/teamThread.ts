/* eslint-disable @typescript-eslint/no-explicit-any */
type TeamThreadRow = {
  id: string;
  organization_id: string;
  updated_at?: string | null;
};

type EnsurePlayerTeamThreadArgs = {
  supabaseAdmin: any;
  organizationId: string;
  playerId: string;
  createdBy: string;
};

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

export async function ensurePlayerTeamThread({
  supabaseAdmin,
  organizationId,
  playerId,
  createdBy,
}: EnsurePlayerTeamThreadArgs): Promise<TeamThreadRow> {
  const playerMembershipRes = await supabaseAdmin
    .from("club_members")
    .select("user_id")
    .eq("club_id", organizationId)
    .eq("user_id", playerId)
    .eq("role", "player")
    .eq("is_active", true)
    .maybeSingle();
  if (playerMembershipRes.error) throw new Error(playerMembershipRes.error.message);
  if (!playerMembershipRes.data?.user_id) throw new Error("Player is not active in this organization");

  const existingRes = await supabaseAdmin
    .from("message_threads")
    .select("id,organization_id,updated_at")
    .eq("organization_id", organizationId)
    .eq("thread_type", "player")
    .eq("player_id", playerId)
    .eq("player_thread_scope", "team")
    .limit(1)
    .maybeSingle();
  if (existingRes.error) throw new Error(existingRes.error.message);

  let thread = (existingRes.data ?? null) as TeamThreadRow | null;
  if (!thread) {
    const insertRes = await supabaseAdmin
      .from("message_threads")
      .insert({
        organization_id: organizationId,
        thread_type: "player",
        title: "Fil équipe coachs + joueur + parent(s)",
        player_id: playerId,
        player_thread_scope: "team",
        created_by: createdBy,
        is_locked: false,
        is_active: true,
      })
      .select("id,organization_id,updated_at")
      .single();

    if (insertRes.error) {
      if (String(insertRes.error.code ?? "") !== "23505") {
        throw new Error(insertRes.error.message);
      }
      const concurrentRes = await supabaseAdmin
        .from("message_threads")
        .select("id,organization_id,updated_at")
        .eq("organization_id", organizationId)
        .eq("thread_type", "player")
        .eq("player_id", playerId)
        .eq("player_thread_scope", "team")
        .single();
      if (concurrentRes.error) throw new Error(concurrentRes.error.message);
      thread = concurrentRes.data as TeamThreadRow;
    } else {
      thread = insertRes.data as TeamThreadRow;
    }
  } else {
    const titleRes = await supabaseAdmin
      .from("message_threads")
      .update({ title: "Fil équipe coachs + joueur + parent(s)", is_active: true })
      .eq("id", thread.id);
    if (titleRes.error) throw new Error(titleRes.error.message);
  }

  const playerGroupsRes = await supabaseAdmin
    .from("coach_group_players")
    .select("group_id")
    .eq("player_user_id", playerId);
  if (playerGroupsRes.error) throw new Error(playerGroupsRes.error.message);

  const rawGroupIds = uniq((playerGroupsRes.data ?? []).map((row: any) => row.group_id));
  let organizationGroupIds: string[] = [];
  if (rawGroupIds.length > 0) {
    const groupsRes = await supabaseAdmin
      .from("coach_groups")
      .select("id")
      .eq("club_id", organizationId)
      .in("id", rawGroupIds);
    if (groupsRes.error) throw new Error(groupsRes.error.message);
    organizationGroupIds = uniq((groupsRes.data ?? []).map((row: any) => row.id));
  }

  let coachIds: string[] = [];
  if (organizationGroupIds.length > 0) {
    const [groupCoachesRes, activeCoachesRes] = await Promise.all([
      supabaseAdmin
        .from("coach_group_coaches")
        .select("coach_user_id")
        .in("group_id", organizationGroupIds),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("club_id", organizationId)
        .eq("role", "coach")
        .eq("is_active", true),
    ]);
    if (groupCoachesRes.error) throw new Error(groupCoachesRes.error.message);
    if (activeCoachesRes.error) throw new Error(activeCoachesRes.error.message);

    const activeCoachIds = new Set(
      uniq((activeCoachesRes.data ?? []).map((row: any) => row.user_id))
    );
    coachIds = uniq((groupCoachesRes.data ?? []).map((row: any) => row.coach_user_id)).filter(
      (coachId) => activeCoachIds.has(coachId)
    );
  }

  const guardiansRes = await supabaseAdmin
    .from("player_guardians")
    .select("guardian_user_id,can_view")
    .eq("player_id", playerId);
  if (guardiansRes.error) throw new Error(guardiansRes.error.message);
  const guardianIds = uniq(
    (guardiansRes.data ?? [])
      .filter((row: any) => row.can_view === null || row.can_view === true)
      .map((row: any) => row.guardian_user_id)
  );

  const allowedParticipantIds = uniq([...coachIds, playerId, ...guardianIds]);
  const participantRows = allowedParticipantIds.map((userId) => ({
    thread_id: thread.id,
    user_id: userId,
    can_post: true,
  }));
  if (participantRows.length > 0) {
    const upsertRes = await supabaseAdmin
      .from("thread_participants")
      .upsert(participantRows, { onConflict: "thread_id,user_id" });
    if (upsertRes.error) throw new Error(upsertRes.error.message);
  }

  const existingParticipantsRes = await supabaseAdmin
    .from("thread_participants")
    .select("user_id")
    .eq("thread_id", thread.id);
  if (existingParticipantsRes.error) throw new Error(existingParticipantsRes.error.message);
  const allowed = new Set(allowedParticipantIds);
  const participantIdsToRemove = uniq(
    (existingParticipantsRes.data ?? [])
      .map((row: any) => row.user_id)
      .filter((userId: string) => !allowed.has(String(userId ?? "")))
  );
  if (participantIdsToRemove.length > 0) {
    const deleteRes = await supabaseAdmin
      .from("thread_participants")
      .delete()
      .eq("thread_id", thread.id)
      .in("user_id", participantIdsToRemove);
    if (deleteRes.error) throw new Error(deleteRes.error.message);
  }

  return thread;
}
