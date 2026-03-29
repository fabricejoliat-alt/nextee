/* eslint-disable @typescript-eslint/no-explicit-any */

import { ageBandKeyFromBirthDate, type NewsTargetInput, type NewsTargetType } from "@/app/api/manager/news/_lib";

export type VisibleNewsRow = {
  id: string;
  club_id: string;
  club_name: string;
  title: string;
  summary: string | null;
  body: string;
  status: string;
  published_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
  linked_club_event_id: string | null;
  linked_camp_id: string | null;
  linked_group_id: string | null;
  linked_content_type: "event" | "camp" | null;
  linked_content_label: string | null;
  include_linked_parents: boolean;
  targets: NewsTargetInput[];
};

type PlayerNewsViewerContext = {
  actorUserId: string;
  viewerRole: "player" | "parent";
  effectivePlayerId: string;
  clubIds: Set<string>;
  playerGroupIds: Set<string>;
  playerGroupCategories: Set<string>;
  playerAgeBand: string | null;
};

type CoachNewsViewerContext = {
  actorUserId: string;
  clubIds: Set<string>;
  coachGroupIds: Set<string>;
  coachGroupCategories: Set<string>;
};

function fullName(first: string | null | undefined, last: string | null | undefined) {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim() || "—";
}

function formatEventLabel(row: any) {
  const startsAtValue = String(row?.starts_at ?? "").trim();
  const startsAt = startsAtValue ? new Date(startsAtValue) : null;
  const dateLabel =
    startsAt && !Number.isNaN(startsAt.getTime())
      ? new Intl.DateTimeFormat("fr-CH", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(startsAt)
      : null;
  const rawTitle = String(row?.title ?? "").trim() || "Evenement";
  const rawType = String(row?.event_type ?? "").trim();
  return [rawTitle, rawType || null, dateLabel].filter(Boolean).join(" • ");
}

function formatCampLabel(row: any) {
  const createdAtValue = String(row?.created_at ?? "").trim();
  const createdAt = createdAtValue ? new Date(createdAtValue) : null;
  const dateLabel =
    createdAt && !Number.isNaN(createdAt.getTime())
      ? new Intl.DateTimeFormat("fr-CH", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(createdAt)
      : null;
  const rawTitle = String(row?.title ?? "").trim() || "Stage/Camp";
  return [rawTitle, dateLabel].filter(Boolean).join(" • ");
}

function publicationDateValue(row: VisibleNewsRow) {
  return row.published_at ?? row.scheduled_for ?? row.created_at;
}

function isNowVisible(row: VisibleNewsRow) {
  if (row.status === "published") return true;
  if (row.status !== "scheduled") return false;
  if (!row.scheduled_for) return false;
  const date = new Date(row.scheduled_for);
  return !Number.isNaN(date.getTime()) && date.getTime() <= Date.now();
}

function targetMatchesPlayerNews(row: VisibleNewsRow, ctx: PlayerNewsViewerContext) {
  if (!ctx.clubIds.has(row.club_id) || row.targets.length === 0) return false;

  const canInheritPlayerTarget = ctx.viewerRole === "player" || row.include_linked_parents;

  for (const target of row.targets) {
    const targetType = String(target.target_type ?? "") as NewsTargetType;
    const targetValue = String(target.target_value ?? "").trim();
    if (!targetValue) continue;

    if (targetType === "role") {
      if (ctx.viewerRole === "parent" && targetValue === "parent") return true;
      if (canInheritPlayerTarget && targetValue === "player") return true;
      continue;
    }

    if (targetType === "user") {
      if (ctx.viewerRole === "parent" && targetValue === ctx.actorUserId) return true;
      if (canInheritPlayerTarget && targetValue === ctx.effectivePlayerId) return true;
      continue;
    }

    if (!canInheritPlayerTarget) continue;

    if (targetType === "group" && ctx.playerGroupIds.has(targetValue)) return true;
    if (targetType === "group_category" && ctx.playerGroupCategories.has(targetValue)) return true;
    if (targetType === "age_band" && ctx.playerAgeBand === targetValue) return true;
  }

  return false;
}

function targetMatchesCoachNews(row: VisibleNewsRow, ctx: CoachNewsViewerContext) {
  if (!ctx.clubIds.has(row.club_id) || row.targets.length === 0) return false;

  for (const target of row.targets) {
    const targetType = String(target.target_type ?? "") as NewsTargetType;
    const targetValue = String(target.target_value ?? "").trim();
    if (!targetValue) continue;

    if (targetType === "role" && targetValue === "coach") return true;
    if (targetType === "user" && targetValue === ctx.actorUserId) return true;
    if (targetType === "group" && ctx.coachGroupIds.has(targetValue)) return true;
    if (targetType === "group_category" && ctx.coachGroupCategories.has(targetValue)) return true;
  }

  return false;
}

export async function fetchPublishedNewsForClubs(supabaseAdmin: any, clubIds: string[]) {
  if (clubIds.length === 0) return [] as VisibleNewsRow[];

  const newsRes = await supabaseAdmin
    .from("club_news")
    .select(
      "id,club_id,title,summary,body,status,published_at,scheduled_for,created_at,updated_at,linked_club_event_id,linked_camp_id,include_linked_parents"
    )
    .in("club_id", clubIds)
    .in("status", ["published", "scheduled"])
    .order("updated_at", { ascending: false });
  if (newsRes.error) throw new Error(newsRes.error.message);

  const newsRows = (newsRes.data ?? []) as any[];
  const newsIds = newsRows.map((row) => String(row.id ?? "")).filter(Boolean);
  const linkedEventIds = Array.from(new Set(newsRows.map((row) => String(row.linked_club_event_id ?? "")).filter(Boolean)));
  const linkedCampIds = Array.from(new Set(newsRows.map((row) => String(row.linked_camp_id ?? "")).filter(Boolean)));

  const [targetsRes, clubsRes, linkedEventsRes, linkedCampsRes] = await Promise.all([
    newsIds.length > 0
      ? supabaseAdmin.from("club_news_targets").select("news_id,target_type,target_value").in("news_id", newsIds)
      : ({ data: [], error: null } as const),
    supabaseAdmin.from("clubs").select("id,name").in("id", clubIds),
    linkedEventIds.length > 0
      ? supabaseAdmin.from("club_events").select("id,title,event_type,starts_at,group_id").in("id", linkedEventIds)
      : ({ data: [], error: null } as const),
    linkedCampIds.length > 0
      ? supabaseAdmin.from("club_camps").select("id,title,created_at").in("id", linkedCampIds)
      : ({ data: [], error: null } as const),
  ]);
  if (targetsRes.error) throw new Error(targetsRes.error.message);
  if (clubsRes.error) throw new Error(clubsRes.error.message);
  if (linkedEventsRes.error) throw new Error(linkedEventsRes.error.message);
  if (linkedCampsRes.error) throw new Error(linkedCampsRes.error.message);

  const targetsByNewsId = new Map<string, NewsTargetInput[]>();
  for (const row of targetsRes.data ?? []) {
    const newsId = String((row as any).news_id ?? "").trim();
    if (!newsId) continue;
    const current = targetsByNewsId.get(newsId) ?? [];
    current.push({
      target_type: String((row as any).target_type ?? "") as NewsTargetType,
      target_value: String((row as any).target_value ?? ""),
    });
    targetsByNewsId.set(newsId, current);
  }

  const clubNameById = new Map<string, string>();
  for (const row of clubsRes.data ?? []) {
    clubNameById.set(String((row as any).id ?? ""), String((row as any).name ?? "Club"));
  }

  const linkedEventById = new Map<string, { label: string; groupId: string | null }>();
  for (const row of linkedEventsRes.data ?? []) {
    linkedEventById.set(String((row as any).id ?? ""), {
      label: formatEventLabel(row),
      groupId: String((row as any).group_id ?? "").trim() || null,
    });
  }

  const linkedCampLabelById = new Map<string, string>();
  for (const row of linkedCampsRes.data ?? []) {
    linkedCampLabelById.set(String((row as any).id ?? ""), formatCampLabel(row));
  }

  return newsRows
    .map((row) => {
      const linkedEventId = String(row.linked_club_event_id ?? "").trim() || null;
      const linkedCampId = String(row.linked_camp_id ?? "").trim() || null;
      const linkedEvent = linkedEventId ? linkedEventById.get(linkedEventId) : null;
      const linkedCampLabel = linkedCampId ? linkedCampLabelById.get(linkedCampId) ?? null : null;

      return {
        id: String(row.id ?? ""),
        club_id: String(row.club_id ?? ""),
        club_name: clubNameById.get(String(row.club_id ?? "")) ?? "Club",
        title: String(row.title ?? ""),
        summary: row.summary == null ? null : String(row.summary),
        body: String(row.body ?? ""),
        status: String(row.status ?? "draft"),
        published_at: row.published_at == null ? null : String(row.published_at),
        scheduled_for: row.scheduled_for == null ? null : String(row.scheduled_for),
        created_at: String(row.created_at ?? ""),
        updated_at: String(row.updated_at ?? ""),
        linked_club_event_id: linkedEventId,
        linked_camp_id: linkedCampId,
        linked_group_id: linkedEvent?.groupId ?? null,
        linked_content_type: linkedEventId ? "event" : linkedCampId ? "camp" : null,
        linked_content_label: linkedEvent?.label ?? linkedCampLabel,
        include_linked_parents: Boolean(row.include_linked_parents),
        targets: targetsByNewsId.get(String(row.id ?? "")) ?? [],
      } satisfies VisibleNewsRow;
    })
    .filter(isNowVisible)
    .sort((left, right) => {
      const leftDate = new Date(publicationDateValue(left)).getTime();
      const rightDate = new Date(publicationDateValue(right)).getTime();
      return rightDate - leftDate;
    });
}

export async function resolvePlayerNewsContext(args: {
  supabaseAdmin: any;
  callerId: string;
  requestedChildId: string | null;
}) {
  const linksRes = await args.supabaseAdmin
    .from("player_guardians")
    .select("player_id,is_primary")
    .eq("guardian_user_id", args.callerId);
  if (linksRes.error) throw new Error(linksRes.error.message);

  const links = (linksRes.data ?? []) as Array<{ player_id: string | null; is_primary?: boolean | null }>;
  const linkedPlayerIds = links.map((row) => String(row.player_id ?? "").trim()).filter(Boolean);
  const isParentViewer = linkedPlayerIds.length > 0;

  let effectivePlayerId = args.callerId;
  if (isParentViewer) {
    effectivePlayerId =
      (args.requestedChildId && linkedPlayerIds.includes(args.requestedChildId) && args.requestedChildId) ||
      String(links.find((row) => Boolean(row.is_primary))?.player_id ?? "").trim() ||
      linkedPlayerIds[0] ||
      args.callerId;
  }

  const [profileRes, membershipsRes, groupsRes] = await Promise.all([
    args.supabaseAdmin
      .from("profiles")
      .select("id,first_name,last_name,birth_date")
      .eq("id", effectivePlayerId)
      .maybeSingle(),
    args.supabaseAdmin
      .from("club_members")
      .select("club_id")
      .eq("user_id", effectivePlayerId)
      .eq("role", "player")
      .eq("is_active", true),
    args.supabaseAdmin
      .from("coach_group_players")
      .select("group_id")
      .eq("player_user_id", effectivePlayerId),
  ]);
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (membershipsRes.error) throw new Error(membershipsRes.error.message);
  if (groupsRes.error) throw new Error(groupsRes.error.message);

  const clubIds = Array.from(
    new Set(((membershipsRes.data ?? []) as any[]).map((row) => String(row.club_id ?? "")).filter(Boolean))
  );
  const groupIds = Array.from(new Set(((groupsRes.data ?? []) as any[]).map((row) => String(row.group_id ?? "")).filter(Boolean)));

  const categoriesRes =
    groupIds.length > 0
      ? await args.supabaseAdmin.from("coach_group_categories").select("group_id,category").in("group_id", groupIds)
      : ({ data: [], error: null } as const);
  if (categoriesRes.error) throw new Error(categoriesRes.error.message);

  const profile = profileRes.data as { first_name?: string | null; last_name?: string | null; birth_date?: string | null } | null;

  return {
    viewerRole: isParentViewer ? ("parent" as const) : ("player" as const),
    actorUserId: args.callerId,
    effectivePlayerId,
    effectivePlayerName: fullName(profile?.first_name ?? null, profile?.last_name ?? null),
    clubIds,
    playerGroupIds: groupIds,
    playerGroupCategories: Array.from(
      new Set(((categoriesRes.data ?? []) as any[]).map((row) => String(row.category ?? "").trim()).filter(Boolean))
    ),
    playerAgeBand: ageBandKeyFromBirthDate(profile?.birth_date ?? null),
  };
}

export async function resolveCoachNewsContext(args: { supabaseAdmin: any; callerId: string }) {
  const membershipsRes = await args.supabaseAdmin
    .from("club_members")
    .select("club_id")
    .eq("user_id", args.callerId)
    .eq("role", "coach")
    .eq("is_active", true);
  if (membershipsRes.error) throw new Error(membershipsRes.error.message);

  const clubIds = Array.from(
    new Set(((membershipsRes.data ?? []) as any[]).map((row) => String(row.club_id ?? "")).filter(Boolean))
  );
  if (clubIds.length === 0) {
    return {
      actorUserId: args.callerId,
      clubIds: [],
      coachGroupIds: [],
      coachGroupCategories: [],
    };
  }

  const groupsRes = await args.supabaseAdmin
    .from("coach_groups")
    .select("id,club_id,head_coach_user_id")
    .in("club_id", clubIds)
    .eq("is_active", true);
  if (groupsRes.error) throw new Error(groupsRes.error.message);

  const clubGroupIds = Array.from(new Set(((groupsRes.data ?? []) as any[]).map((row) => String(row.id ?? "")).filter(Boolean)));
  const directHeadCoachGroupIds = ((groupsRes.data ?? []) as any[])
    .filter((row) => String(row.head_coach_user_id ?? "").trim() === args.callerId)
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);

  const groupCoachesRes =
    clubGroupIds.length > 0
      ? await args.supabaseAdmin
          .from("coach_group_coaches")
          .select("group_id")
          .eq("coach_user_id", args.callerId)
          .in("group_id", clubGroupIds)
      : ({ data: [], error: null } as const);
  if (groupCoachesRes.error) throw new Error(groupCoachesRes.error.message);

  const coachGroupIds = Array.from(
    new Set([
      ...directHeadCoachGroupIds,
      ...((groupCoachesRes.data ?? []) as any[]).map((row) => String(row.group_id ?? "").trim()).filter(Boolean),
    ])
  );

  const categoriesRes =
    coachGroupIds.length > 0
      ? await args.supabaseAdmin
          .from("coach_group_categories")
          .select("group_id,category")
          .in("group_id", coachGroupIds)
      : ({ data: [], error: null } as const);
  if (categoriesRes.error) throw new Error(categoriesRes.error.message);

  return {
    actorUserId: args.callerId,
    clubIds,
    coachGroupIds,
    coachGroupCategories: Array.from(
      new Set(((categoriesRes.data ?? []) as any[]).map((row) => String(row.category ?? "").trim()).filter(Boolean))
    ),
  };
}

export async function fetchVisiblePlayerNews(args: {
  supabaseAdmin: any;
  callerId: string;
  requestedChildId: string | null;
}) {
  const ctx = await resolvePlayerNewsContext(args);
  const rows = await fetchPublishedNewsForClubs(args.supabaseAdmin, ctx.clubIds);
  const visibleNews = rows.filter((row) =>
    targetMatchesPlayerNews(row, {
      actorUserId: ctx.actorUserId,
      viewerRole: ctx.viewerRole,
      effectivePlayerId: ctx.effectivePlayerId,
      clubIds: new Set(ctx.clubIds),
      playerGroupIds: new Set(ctx.playerGroupIds),
      playerGroupCategories: new Set(ctx.playerGroupCategories),
      playerAgeBand: ctx.playerAgeBand,
    })
  );

  return {
    viewer_role: ctx.viewerRole,
    effective_player_id: ctx.effectivePlayerId,
    effective_player_name: ctx.effectivePlayerName,
    news: visibleNews,
  };
}

export async function fetchVisibleCoachNews(args: { supabaseAdmin: any; callerId: string }) {
  const ctx = await resolveCoachNewsContext(args);
  const rows = await fetchPublishedNewsForClubs(args.supabaseAdmin, ctx.clubIds);
  const visibleNews = rows.filter((row) =>
    targetMatchesCoachNews(row, {
      actorUserId: ctx.actorUserId,
      clubIds: new Set(ctx.clubIds),
      coachGroupIds: new Set(ctx.coachGroupIds),
      coachGroupCategories: new Set(ctx.coachGroupCategories),
    })
  );

  return { news: visibleNews };
}
