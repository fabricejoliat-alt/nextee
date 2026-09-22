import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function assertSuperadminOrManager(req: NextRequest, supabaseAdmin: any, organizationId: string) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing Authorization token." };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) return { ok: false as const, status: 401, error: "Invalid token." };

  const callerId = callerData.user.id;
  const { data: isAdminRow, error: isAdminErr } = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();

  if (!isAdminErr && isAdminRow) return { ok: true as const, callerId };

  const { data: managerMembership, error: membershipErr } = await supabaseAdmin
    .from("club_members")
    .select("id,role,is_active")
    .eq("club_id", organizationId)
    .eq("user_id", callerId)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipErr || !managerMembership || managerMembership.role !== "manager") {
    return { ok: false as const, status: 403, error: "Forbidden." };
  }

  return { ok: true as const, callerId };
}

async function getFutureEventIdsByGroup(supabaseAdmin: any, groupId: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("club_events")
    .select("id")
    .eq("group_id", groupId)
    .gte("starts_at", nowIso);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => r.id as string);
}

async function addPlayerToFutureGroupEvents(supabaseAdmin: any, groupId: string, playerId: string) {
  const futureEventIds = await getFutureEventIdsByGroup(supabaseAdmin, groupId);
  if (!futureEventIds.length) return;
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("club_event_attendees")
    .select("event_id")
    .eq("player_id", playerId)
    .in("event_id", futureEventIds);
  if (existingError) throw new Error(existingError.message);
  const existingEventIds = new Set((existingRows ?? []).map((row: any) => String(row.event_id)));
  const missingRows = futureEventIds
    .filter((eventId) => !existingEventIds.has(eventId))
    .map((eventId) => ({ event_id: eventId, player_id: playerId, status: "present" }));
  if (!missingRows.length) return;
  const { error } = await supabaseAdmin.from("club_event_attendees").insert(missingRows);
  if (error) throw new Error(error.message);
}

async function removePlayerFromFutureGroupEvents(supabaseAdmin: any, groupId: string, playerId: string) {
  const futureEventIds = await getFutureEventIdsByGroup(supabaseAdmin, groupId);
  if (!futureEventIds.length) return;
  const { error } = await supabaseAdmin
    .from("club_event_attendees")
    .delete()
    .eq("player_id", playerId)
    .in("event_id", futureEventIds);
  if (error) throw new Error(error.message);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ organizationId: string }> }
) {
  try {
    const supabaseAdmin = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    const { organizationId } = await ctx.params;
    if (!organizationId) return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    const auth = await assertSuperadminOrManager(req, supabaseAdmin, organizationId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const [
      orgRes,
      groupsRes,
      playersRes,
      coachesRes,
      seasonsRes,
    ] = await Promise.all([
      supabaseAdmin.from("clubs").select("id,name").eq("id", organizationId).maybeSingle(),
      supabaseAdmin
        .from("coach_groups")
        .select("id,name,is_active,head_coach_user_id,club_id")
        .eq("club_id", organizationId)
        .neq("name", "__ARCHIVE_HISTORIQUE__")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("club_members")
        .select("id,user_id")
        .eq("club_id", organizationId)
        .eq("is_active", true)
        .eq("role", "player"),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("club_id", organizationId)
        .eq("is_active", true)
        .eq("role", "coach"),
      supabaseAdmin
        .from("club_seasons")
        .select("id,name,starts_on,ends_on,is_current")
        .eq("club_id", organizationId)
        .order("starts_on", { ascending: true }),
    ]);

    if (orgRes.error) return NextResponse.json({ error: orgRes.error.message }, { status: 400 });
    if (!orgRes.data) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (playersRes.error) return NextResponse.json({ error: playersRes.error.message }, { status: 400 });
    if (coachesRes.error) return NextResponse.json({ error: coachesRes.error.message }, { status: 400 });
    if (seasonsRes.error) return NextResponse.json({ error: seasonsRes.error.message }, { status: 400 });

    const groups = groupsRes.data ?? [];
    const groupIds = groups.map((g: any) => g.id as string);

    const playerIds = Array.from(new Set((playersRes.data ?? []).map((r: any) => r.user_id as string)));
    const coachIds = Array.from(new Set((coachesRes.data ?? []).map((r: any) => r.user_id as string)));

    const idsToLoad = Array.from(
      new Set([...playerIds, ...coachIds, ...groups.map((g: any) => g.head_coach_user_id).filter(Boolean)])
    );

    const playerMembers = playersRes.data ?? [];
    const [profilesRes, catsRes, gpRes, gcRes, seasonRecordsRes] = await Promise.all([
      idsToLoad.length
        ? supabaseAdmin.from("profiles").select("id,first_name,last_name,avatar_url").in("id", idsToLoad)
        : Promise.resolve({ data: [], error: null } as any),
      groupIds.length
        ? supabaseAdmin.from("coach_group_categories").select("group_id,category").in("group_id", groupIds)
        : Promise.resolve({ data: [], error: null } as any),
      groupIds.length
        ? supabaseAdmin.from("coach_group_players").select("group_id,player_user_id").in("group_id", groupIds)
        : Promise.resolve({ data: [], error: null } as any),
      groupIds.length
        ? supabaseAdmin.from("coach_group_coaches").select("group_id,coach_user_id,is_head").in("group_id", groupIds)
        : Promise.resolve({ data: [], error: null } as any),
      (seasonsRes.data ?? []).length
        ? supabaseAdmin
            .from("club_player_season_records")
            .select("club_season_id,club_member_id,group_id")
            .in("club_season_id", (seasonsRes.data ?? []).map((season: any) => season.id))
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
    if (catsRes.error) return NextResponse.json({ error: catsRes.error.message }, { status: 400 });
    if (gpRes.error) return NextResponse.json({ error: gpRes.error.message }, { status: 400 });
    if (gcRes.error) return NextResponse.json({ error: gcRes.error.message }, { status: 400 });
    if (seasonRecordsRes.error) return NextResponse.json({ error: seasonRecordsRes.error.message }, { status: 400 });

    return NextResponse.json({
      organization: orgRes.data,
      seasons: seasonsRes.data ?? [],
      groups,
      players: (profilesRes.data ?? []).filter((p: any) => playerIds.includes(p.id)),
      coaches: (profilesRes.data ?? []).filter((p: any) => coachIds.includes(p.id)),
      categories: catsRes.data ?? [],
      groupPlayers: gpRes.data ?? [],
      groupCoaches: gcRes.data ?? [],
      playerMembers: playerMembers.map((member: any) => ({ id: member.id, user_id: member.user_id })),
      seasonRecords: seasonRecordsRes.data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ organizationId: string }> }
) {
  try {
    const supabaseAdmin = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    const { organizationId } = await ctx.params;
    if (!organizationId) return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    const auth = await assertSuperadminOrManager(req, supabaseAdmin, organizationId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const actorType = String(body.actorType ?? "") as "player" | "coach";
    const userId = String(body.userId ?? "");
    const toGroupId = String(body.toGroupId ?? "");
    const rawFromGroupId = body.fromGroupId == null ? null : String(body.fromGroupId);
    const fromGroupId = rawFromGroupId && rawFromGroupId !== "null" ? rawFromGroupId : null;
    const removeFromSource = Boolean(body.removeFromSource);
    const seasonId = String(body.seasonId ?? "").trim();

    if (!["player", "coach"].includes(actorType)) {
      return NextResponse.json({ error: "Invalid actorType" }, { status: 400 });
    }
    if (!userId || !toGroupId) return NextResponse.json({ error: "Missing parameters" }, { status: 400 });

    const toGroupRes = await supabaseAdmin
      .from("coach_groups")
      .select("id,club_id,head_coach_user_id")
      .eq("id", toGroupId)
      .maybeSingle();
    if (toGroupRes.error) return NextResponse.json({ error: toGroupRes.error.message }, { status: 400 });
    if (!toGroupRes.data || toGroupRes.data.club_id !== organizationId) {
      return NextResponse.json({ error: "Target group not in this organization" }, { status: 400 });
    }

    // Season assignments are independent from the legacy group-membership rows.
    // An explicit action only changes the junior selected by the manager.
    if (actorType === "player" && seasonId) {
      const [seasonRes, memberRes] = await Promise.all([
        supabaseAdmin.from("club_seasons").select("id").eq("id", seasonId).eq("club_id", organizationId).maybeSingle(),
        supabaseAdmin.from("club_members").select("id,user_id").eq("club_id", organizationId).eq("role", "player").eq("is_active", true).eq("user_id", userId).maybeSingle(),
      ]);
      if (seasonRes.error || !seasonRes.data) return NextResponse.json({ error: "Saison introuvable" }, { status: 400 });
      if (memberRes.error || !memberRes.data) return NextResponse.json({ error: "Junior introuvable dans ce club" }, { status: 400 });

      const existingGroupLink = await supabaseAdmin.from("coach_group_players").select("group_id").eq("group_id", toGroupId).eq("player_user_id", userId).maybeSingle();
      if (existingGroupLink.error) return NextResponse.json({ error: existingGroupLink.error.message }, { status: 400 });
      const assignError = existingGroupLink.data ? null : (await supabaseAdmin.from("coach_group_players").insert({ group_id: toGroupId, player_user_id: userId })).error;
      if (assignError) return NextResponse.json({ error: assignError.message }, { status: 400 });
      if (removeFromSource && fromGroupId && fromGroupId !== toGroupId) {
        await removePlayerFromFutureGroupEvents(supabaseAdmin, fromGroupId, userId);
      }
      await addPlayerToFutureGroupEvents(supabaseAdmin, toGroupId, userId);
      return NextResponse.json({ ok: true });
    }

    if (actorType === "player") {
      const existingPlayerLink = await supabaseAdmin
        .from("coach_group_players")
        .select("group_id")
        .eq("group_id", toGroupId)
        .eq("player_user_id", userId)
        .maybeSingle();
      if (existingPlayerLink.error) {
        return NextResponse.json({ error: existingPlayerLink.error.message }, { status: 400 });
      }
      if (!existingPlayerLink.data) {
        const insRes = await supabaseAdmin
          .from("coach_group_players")
          .insert({ group_id: toGroupId, player_user_id: userId });
        if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });
      }

      if (removeFromSource && fromGroupId && fromGroupId !== toGroupId) {
        const delRes = await supabaseAdmin
          .from("coach_group_players")
          .delete()
          .eq("group_id", fromGroupId)
          .eq("player_user_id", userId);
        if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

        const sourceFutureEventIds = await getFutureEventIdsByGroup(supabaseAdmin, fromGroupId);
        if (sourceFutureEventIds.length) {
          const dropAtt = await supabaseAdmin
            .from("club_event_attendees")
            .delete()
            .eq("player_id", userId)
            .in("event_id", sourceFutureEventIds);
          if (dropAtt.error) return NextResponse.json({ error: dropAtt.error.message }, { status: 400 });
        }
      }

      const targetFutureEventIds = await getFutureEventIdsByGroup(supabaseAdmin, toGroupId);
      if (targetFutureEventIds.length) {
        const existingAtt = await supabaseAdmin
          .from("club_event_attendees")
          .select("event_id")
          .eq("player_id", userId)
          .in("event_id", targetFutureEventIds);
        if (existingAtt.error) return NextResponse.json({ error: existingAtt.error.message }, { status: 400 });
        const existingSet = new Set((existingAtt.data ?? []).map((r: any) => r.event_id as string));
        const missingRows = targetFutureEventIds
          .filter((eventId) => !existingSet.has(eventId))
          .map((eventId) => ({
            event_id: eventId,
            player_id: userId,
            status: "present",
          }));
        if (missingRows.length) {
          const addAtt = await supabaseAdmin.from("club_event_attendees").insert(missingRows);
          if (addAtt.error) return NextResponse.json({ error: addAtt.error.message }, { status: 400 });
        }
      }
    } else {
      const existingCoachLink = await supabaseAdmin
        .from("coach_group_coaches")
        .select("id,is_head")
        .eq("group_id", toGroupId)
        .eq("coach_user_id", userId)
        .maybeSingle();
      if (existingCoachLink.error) {
        return NextResponse.json({ error: existingCoachLink.error.message }, { status: 400 });
      }
      const isHead = toGroupRes.data.head_coach_user_id === userId;
      if (existingCoachLink.data && isHead && !existingCoachLink.data.is_head) {
        const updateRes = await supabaseAdmin.from("coach_group_coaches").update({ is_head: true }).eq("id", existingCoachLink.data.id);
        if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 400 });
      } else if (!existingCoachLink.data) {
        const insRes = await supabaseAdmin
          .from("coach_group_coaches")
          .insert({ group_id: toGroupId, coach_user_id: userId, is_head: isHead });
        if (insRes.error) return NextResponse.json({ error: insRes.error.message }, { status: 400 });
      }

      if (removeFromSource && fromGroupId && fromGroupId !== toGroupId) {
        const delRes = await supabaseAdmin
          .from("coach_group_coaches")
          .delete()
          .eq("group_id", fromGroupId)
          .eq("coach_user_id", userId);
        if (delRes.error) return NextResponse.json({ error: delRes.error.message }, { status: 400 });

        const sourceFutureEventIds = await getFutureEventIdsByGroup(supabaseAdmin, fromGroupId);
        if (sourceFutureEventIds.length) {
          const dropCoach = await supabaseAdmin
            .from("club_event_coaches")
            .delete()
            .eq("coach_id", userId)
            .in("event_id", sourceFutureEventIds);
          if (dropCoach.error) return NextResponse.json({ error: dropCoach.error.message }, { status: 400 });
        }
      }

      const targetFutureEventIds = await getFutureEventIdsByGroup(supabaseAdmin, toGroupId);
      if (targetFutureEventIds.length) {
        const existingCoachRows = await supabaseAdmin
          .from("club_event_coaches")
          .select("event_id")
          .eq("coach_id", userId)
          .in("event_id", targetFutureEventIds);
        if (existingCoachRows.error) {
          return NextResponse.json({ error: existingCoachRows.error.message }, { status: 400 });
        }
        const existingSet = new Set((existingCoachRows.data ?? []).map((r: any) => r.event_id as string));
        const missingRows = targetFutureEventIds
          .filter((eventId) => !existingSet.has(eventId))
          .map((eventId) => ({
            event_id: eventId,
            coach_id: userId,
          }));
        if (missingRows.length) {
          const addCoach = await supabaseAdmin.from("club_event_coaches").insert(missingRows);
          if (addCoach.error) return NextResponse.json({ error: addCoach.error.message }, { status: 400 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ organizationId: string }> }
) {
  try {
    const supabaseAdmin = createClient(
      mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
      mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    );
    const { organizationId } = await ctx.params;
    if (!organizationId) return NextResponse.json({ error: "Missing organizationId" }, { status: 400 });
    const auth = await assertSuperadminOrManager(req, supabaseAdmin, organizationId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const actorType = String(body.actorType ?? "") as "player" | "coach";
    const userId = String(body.userId ?? "");
    const groupId = String(body.groupId ?? "");
    const seasonId = String(body.seasonId ?? "").trim();

    if (!["player", "coach"].includes(actorType)) {
      return NextResponse.json({ error: "Invalid actorType" }, { status: 400 });
    }
    if (!userId || !groupId) return NextResponse.json({ error: "Missing parameters" }, { status: 400 });

    const groupRes = await supabaseAdmin
      .from("coach_groups")
      .select("id,club_id,head_coach_user_id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupRes.error) return NextResponse.json({ error: groupRes.error.message }, { status: 400 });
    if (!groupRes.data || groupRes.data.club_id !== organizationId) {
      return NextResponse.json({ error: "Group not in this organization" }, { status: 400 });
    }

    if (actorType === "player" && seasonId) {
      const { data: season } = await supabaseAdmin.from("club_seasons").select("id").eq("id", seasonId).eq("club_id", organizationId).maybeSingle();
      if (!season) return NextResponse.json({ error: "Saison introuvable" }, { status: 400 });
      const { data: member } = await supabaseAdmin.from("club_members").select("id").eq("club_id", organizationId).eq("user_id", userId).eq("role", "player").eq("is_active", true).maybeSingle();
      if (!member) return NextResponse.json({ error: "Junior introuvable dans ce club" }, { status: 400 });
      const { error: removeSeasonError } = await supabaseAdmin.from("coach_group_players").delete().eq("group_id", groupId).eq("player_user_id", userId);
      if (removeSeasonError) return NextResponse.json({ error: removeSeasonError.message }, { status: 400 });
      await removePlayerFromFutureGroupEvents(supabaseAdmin, groupId, userId);
      return NextResponse.json({ ok: true });
    }

    if (actorType === "player") {
      const delMember = await supabaseAdmin
        .from("coach_group_players")
        .delete()
        .eq("group_id", groupId)
        .eq("player_user_id", userId);
      if (delMember.error) return NextResponse.json({ error: delMember.error.message }, { status: 400 });

      const futureEventIds = await getFutureEventIdsByGroup(supabaseAdmin, groupId);
      if (futureEventIds.length) {
        const delFutureAtt = await supabaseAdmin
          .from("club_event_attendees")
          .delete()
          .eq("player_id", userId)
          .in("event_id", futureEventIds);
        if (delFutureAtt.error) return NextResponse.json({ error: delFutureAtt.error.message }, { status: 400 });
      }
    } else {
      const isHead = groupRes.data.head_coach_user_id === userId;
      if (isHead) {
        return NextResponse.json({ error: "Cannot remove head coach from group" }, { status: 400 });
      }

      const delCoach = await supabaseAdmin
        .from("coach_group_coaches")
        .delete()
        .eq("group_id", groupId)
        .eq("coach_user_id", userId);
      if (delCoach.error) return NextResponse.json({ error: delCoach.error.message }, { status: 400 });

      const futureEventIds = await getFutureEventIdsByGroup(supabaseAdmin, groupId);
      if (futureEventIds.length) {
        const delFutureCoach = await supabaseAdmin
          .from("club_event_coaches")
          .delete()
          .eq("coach_id", userId)
          .in("event_id", futureEventIds);
        if (delFutureCoach.error) return NextResponse.json({ error: delFutureCoach.error.message }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
