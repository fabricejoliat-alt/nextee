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
        .select("user_id")
        .eq("club_id", organizationId)
        .eq("is_active", true)
        .eq("role", "player"),
      supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("club_id", organizationId)
        .eq("is_active", true)
        .eq("role", "coach"),
    ]);

    if (orgRes.error) return NextResponse.json({ error: orgRes.error.message }, { status: 400 });
    if (!orgRes.data) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 400 });
    if (playersRes.error) return NextResponse.json({ error: playersRes.error.message }, { status: 400 });
    if (coachesRes.error) return NextResponse.json({ error: coachesRes.error.message }, { status: 400 });

    const groups = groupsRes.data ?? [];
    const groupIds = groups.map((g: any) => g.id as string);

    const playerIds = Array.from(new Set((playersRes.data ?? []).map((r: any) => r.user_id as string)));
    const coachIds = Array.from(new Set((coachesRes.data ?? []).map((r: any) => r.user_id as string)));

    const idsToLoad = Array.from(
      new Set([...playerIds, ...coachIds, ...groups.map((g: any) => g.head_coach_user_id).filter(Boolean)])
    );

    const [profilesRes, catsRes, gpRes, gcRes] = await Promise.all([
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
    ]);

    if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 400 });
    if (catsRes.error) return NextResponse.json({ error: catsRes.error.message }, { status: 400 });
    if (gpRes.error) return NextResponse.json({ error: gpRes.error.message }, { status: 400 });
    if (gcRes.error) return NextResponse.json({ error: gcRes.error.message }, { status: 400 });

    return NextResponse.json({
      organization: orgRes.data,
      groups,
      players: (profilesRes.data ?? []).filter((p: any) => playerIds.includes(p.id)),
      coaches: (profilesRes.data ?? []).filter((p: any) => coachIds.includes(p.id)),
      categories: catsRes.data ?? [],
      groupPlayers: gpRes.data ?? [],
      groupCoaches: gcRes.data ?? [],
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

    if (!["player", "coach"].includes(actorType)) {
      return NextResponse.json({ error: "Invalid actorType" }, { status: 400 });
    }
    if (!userId || !toGroupId) return NextResponse.json({ error: "Missing parameters" }, { status: 400 });

    const toGroupRes = await supabaseAdmin
      .from("coach_groups")
      .select("id,club_id")
      .eq("id", toGroupId)
      .maybeSingle();
    if (toGroupRes.error) return NextResponse.json({ error: toGroupRes.error.message }, { status: 400 });
    if (!toGroupRes.data || toGroupRes.data.club_id !== organizationId) {
      return NextResponse.json({ error: "Target group not in this organization" }, { status: 400 });
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
        .select("id")
        .eq("group_id", toGroupId)
        .eq("coach_user_id", userId)
        .maybeSingle();
      if (existingCoachLink.error) {
        return NextResponse.json({ error: existingCoachLink.error.message }, { status: 400 });
      }
      if (!existingCoachLink.data) {
        const insRes = await supabaseAdmin
          .from("coach_group_coaches")
          .insert({ group_id: toGroupId, coach_user_id: userId, is_head: false });
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
