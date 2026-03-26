type CoachPlayerAccessResult = {
  sharedClubIds: string[];
  isManagerForSharedClub: boolean;
  canAccessSensitiveSections: boolean;
  sharedGroupIds: string[];
  sharedEventIds: string[];
};

export async function resolveCoachPlayerAccess(
  supabaseAdmin: any,
  callerId: string,
  playerId: string
): Promise<CoachPlayerAccessResult> {
  const [staffRes, playerRes] = await Promise.all([
    supabaseAdmin
      .from("club_members")
      .select("club_id,role")
      .eq("user_id", callerId)
      .eq("is_active", true)
      .in("role", ["coach", "manager"]),
    supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", playerId)
      .eq("is_active", true),
  ]);

  if (staffRes.error) throw new Error(staffRes.error.message);
  if (playerRes.error) throw new Error(playerRes.error.message);

  const staffRows = (staffRes.data ?? []) as Array<{ club_id: string | null; role: string | null }>;
  const playerClubIds = new Set(
    ((playerRes.data ?? []) as Array<{ club_id: string | null }>)
      .map((row) => String(row.club_id ?? ""))
      .filter(Boolean)
  );
  const sharedClubIds = Array.from(
    new Set(
      staffRows
        .map((row) => String(row.club_id ?? ""))
        .filter((clubId) => Boolean(clubId) && playerClubIds.has(clubId))
    )
  );

  if (sharedClubIds.length === 0) {
    return {
      sharedClubIds: [],
      isManagerForSharedClub: false,
      canAccessSensitiveSections: false,
      sharedGroupIds: [],
      sharedEventIds: [],
    };
  }

  const isManagerForSharedClub = staffRows.some(
    (row) => String(row.role ?? "") === "manager" && sharedClubIds.includes(String(row.club_id ?? ""))
  );
  if (isManagerForSharedClub) {
    return {
      sharedClubIds,
      isManagerForSharedClub: true,
      canAccessSensitiveSections: true,
      sharedGroupIds: [],
      sharedEventIds: [],
    };
  }

  let sharedGroupIds: string[] = [];
  const coachGroupsRes = await supabaseAdmin
    .from("coach_group_coaches")
    .select("group_id")
    .eq("coach_user_id", callerId)
    .limit(200);
  if (coachGroupsRes.error) throw new Error(coachGroupsRes.error.message);

  const coachGroupIds = Array.from(
    new Set(
      ((coachGroupsRes.data ?? []) as Array<{ group_id: string | null }>)
        .map((row) => String(row.group_id ?? ""))
        .filter(Boolean)
    )
  );
  if (coachGroupIds.length > 0) {
    const playerSharedGroupRes = await supabaseAdmin
      .from("coach_group_players")
      .select("group_id")
      .eq("player_user_id", playerId)
      .in("group_id", coachGroupIds)
      .limit(20);
    if (playerSharedGroupRes.error) throw new Error(playerSharedGroupRes.error.message);
    sharedGroupIds = Array.from(
      new Set(
        ((playerSharedGroupRes.data ?? []) as Array<{ group_id: string | null }>)
          .map((row) => String(row.group_id ?? ""))
          .filter(Boolean)
      )
    );
  }

  let sharedEventIds: string[] = [];
  if (sharedGroupIds.length === 0) {
    const coachEventsRes = await supabaseAdmin
      .from("club_event_coaches")
      .select("event_id")
      .eq("coach_id", callerId)
      .limit(500);
    if (coachEventsRes.error) throw new Error(coachEventsRes.error.message);

    const coachEventIds = Array.from(
      new Set(
        ((coachEventsRes.data ?? []) as Array<{ event_id: string | null }>)
          .map((row) => String(row.event_id ?? ""))
          .filter(Boolean)
      )
    );
    if (coachEventIds.length > 0) {
      const playerSharedEventRes = await supabaseAdmin
        .from("club_event_attendees")
        .select("event_id")
        .eq("player_id", playerId)
        .in("event_id", coachEventIds)
        .limit(20);
      if (playerSharedEventRes.error) throw new Error(playerSharedEventRes.error.message);
      sharedEventIds = Array.from(
        new Set(
          ((playerSharedEventRes.data ?? []) as Array<{ event_id: string | null }>)
            .map((row) => String(row.event_id ?? ""))
            .filter(Boolean)
        )
      );
    }
  }

  return {
    sharedClubIds,
    isManagerForSharedClub: false,
    // Sensitive player-wide sections are reserved to coaches who actually
    // coach the player via a shared group, not just a shared historical event.
    canAccessSensitiveSections: sharedGroupIds.length > 0,
    sharedGroupIds,
    sharedEventIds,
  };
}
