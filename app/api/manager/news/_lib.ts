import { createClient } from "@supabase/supabase-js";

export type NewsStatus = "draft" | "scheduled" | "published" | "archived";
export type NewsTargetType = "role" | "user" | "group" | "group_category" | "age_band";
export type MemberRole = "manager" | "coach" | "player" | "parent";

export type NewsTargetInput = {
  target_type: NewsTargetType;
  target_value: string;
};

export type ManagedClubOption = {
  id: string;
  name: string;
};

export type NewsTargetOption = {
  clubs: ManagedClubOption[];
  members: Array<{
    user_id: string;
    role: MemberRole;
    full_name: string;
    birth_date: string | null;
  }>;
  groups: Array<{
    id: string;
    name: string;
  }>;
  group_categories: string[];
  age_bands: Array<{
    key: string;
    label: string;
  }>;
};

export type ClubNewsRow = {
  id: string;
  club_id: string;
  title: string;
  summary: string | null;
  body: string;
  status: NewsStatus;
  scheduled_for: string | null;
  published_at: string | null;
  send_notification: boolean;
  send_email: boolean;
  include_linked_parents: boolean;
  last_notification_sent_at: string | null;
  last_email_sent_at: string | null;
  last_dispatch_result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name: string | null;
  targets: NewsTargetInput[];
};

type ActiveClubMember = {
  user_id: string;
  role: MemberRole;
  birth_date: string | null;
  full_name: string;
};

type AuthUserLite = {
  email: string | null;
};

export function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function createSupabaseAdmin() {
  return createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

export async function getManagerContext(req: Request, supabaseAdmin: any) {
  const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing token" };

  const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerErr || !callerData.user) {
    return { ok: false as const, status: 401, error: "Invalid token" };
  }

  const callerId = callerData.user.id;

  const { data: adminRow } = await supabaseAdmin
    .from("app_admins")
    .select("user_id")
    .eq("user_id", callerId)
    .maybeSingle();

  if (adminRow) {
    const clubsRes = await supabaseAdmin.from("clubs").select("id,name").order("name", { ascending: true });
    if (clubsRes.error) return { ok: false as const, status: 400, error: clubsRes.error.message };
    return {
      ok: true as const,
      callerId,
      accessToken,
      managedClubs: ((clubsRes.data ?? []) as any[]).map((row) => ({
        id: String(row.id ?? ""),
        name: String(row.name ?? "Club"),
      })),
    };
  }

  const membershipsRes = await supabaseAdmin
    .from("club_members")
    .select("club_id")
    .eq("user_id", callerId)
    .eq("role", "manager")
    .eq("is_active", true);
  if (membershipsRes.error) return { ok: false as const, status: 400, error: membershipsRes.error.message };

  const clubIds = Array.from(
    new Set(((membershipsRes.data ?? []) as any[]).map((row) => String(row?.club_id ?? "")).filter(Boolean))
  );
  if (clubIds.length === 0) {
    return { ok: true as const, callerId, accessToken, managedClubs: [] as ManagedClubOption[] };
  }

  const clubsRes = await supabaseAdmin.from("clubs").select("id,name").in("id", clubIds);
  if (clubsRes.error) return { ok: false as const, status: 400, error: clubsRes.error.message };

  const clubNameById = new Map<string, string>();
  for (const row of clubsRes.data ?? []) {
    clubNameById.set(String((row as any).id ?? ""), String((row as any).name ?? "Club"));
  }

  return {
    ok: true as const,
    callerId,
    accessToken,
    managedClubs: clubIds.map((id) => ({ id, name: clubNameById.get(id) ?? "Club" })),
  };
}

function fullName(first: string | null | undefined, last: string | null | undefined) {
  return `${String(first ?? "").trim()} ${String(last ?? "").trim()}`.trim() || "—";
}

function computeAge(birthDate: string | null | undefined) {
  if (!birthDate) return null;
  const date = new Date(birthDate);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDelta = now.getMonth() - date.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < date.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function ageBandKeyFromBirthDate(birthDate: string | null | undefined) {
  const age = computeAge(birthDate);
  if (age == null) return null;
  if (age <= 10) return "u10";
  if (age <= 12) return "u12";
  if (age <= 14) return "u14";
  if (age <= 16) return "u16";
  if (age <= 18) return "u18";
  return "adult";
}

export const NEWS_AGE_BANDS = [
  { key: "u10", label: "U10 et moins" },
  { key: "u12", label: "U12" },
  { key: "u14", label: "U14" },
  { key: "u16", label: "U16" },
  { key: "u18", label: "U18" },
  { key: "adult", label: "Adultes" },
] as const;

export async function fetchActiveClubMembers(supabaseAdmin: any, clubId: string) {
  const membersRes = await supabaseAdmin
    .from("club_members")
    .select("user_id,role")
    .eq("club_id", clubId)
    .eq("is_active", true)
    .in("role", ["manager", "coach", "player", "parent"]);
  if (membersRes.error) throw new Error(membersRes.error.message);

  const memberRows = (membersRes.data ?? []) as Array<{ user_id: string | null; role: MemberRole | null }>;
  const userIds = Array.from(new Set(memberRows.map((row) => String(row.user_id ?? "")).filter(Boolean)));

  const profilesRes =
    userIds.length > 0
      ? await supabaseAdmin
          .from("profiles")
          .select("id,first_name,last_name,birth_date")
          .in("id", userIds)
      : ({ data: [], error: null } as const);
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const profileById = new Map<string, { first_name: string | null; last_name: string | null; birth_date: string | null }>();
  for (const row of profilesRes.data ?? []) {
    profileById.set(String((row as any).id ?? ""), {
      first_name: (row as any).first_name ?? null,
      last_name: (row as any).last_name ?? null,
      birth_date: (row as any).birth_date ?? null,
    });
  }

  const members: ActiveClubMember[] = memberRows
    .map((row) => {
      const userId = String(row.user_id ?? "");
      const role = String(row.role ?? "") as MemberRole;
      if (!userId || !role) return null;
      const profile = profileById.get(userId);
      return {
        user_id: userId,
        role,
        birth_date: profile?.birth_date ?? null,
        full_name: fullName(profile?.first_name, profile?.last_name),
      } satisfies ActiveClubMember;
    })
    .filter((row): row is ActiveClubMember => Boolean(row));

  return members;
}

async function fetchAuthUsersByIds(supabaseAdmin: any, userIds: string[]) {
  const authById = new Map<string, AuthUserLite>();
  if (userIds.length === 0) return authById;

  const authSchema = (supabaseAdmin as any).schema("auth");
  const authRes = await authSchema.from("users").select("id,email").in("id", userIds);
  if (!authRes.error) {
    for (const row of authRes.data ?? []) {
      const userId = String((row as any).id ?? "");
      if (!userId) continue;
      authById.set(userId, { email: (row as any).email ?? null });
    }
    return authById;
  }

  const wanted = new Set(userIds);
  let page = 1;
  const perPage = 1000;
  while (wanted.size > 0) {
    const adminRes = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (adminRes.error) break;
    const users = adminRes.data?.users ?? [];
    if (users.length === 0) break;
    for (const user of users) {
      if (!wanted.has(user.id)) continue;
      authById.set(user.id, { email: user.email ?? null });
      wanted.delete(user.id);
    }
    if (users.length < perPage) break;
    page += 1;
  }

  return authById;
}

export async function fetchNewsTargetOptions(supabaseAdmin: any, managedClubs: ManagedClubOption[], clubId: string) {
  const members = await fetchActiveClubMembers(supabaseAdmin, clubId);

  const groupsRes = await supabaseAdmin
    .from("coach_groups")
    .select("id,name")
    .eq("club_id", clubId)
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (groupsRes.error) throw new Error(groupsRes.error.message);

  const groupIds = Array.from(new Set((groupsRes.data ?? []).map((row: any) => String(row.id ?? "")).filter(Boolean)));
  const categoriesRes =
    groupIds.length > 0
      ? await supabaseAdmin
          .from("coach_group_categories")
          .select("group_id,category")
          .in("group_id", groupIds)
      : ({ data: [], error: null } as const);
  if (categoriesRes.error) throw new Error(categoriesRes.error.message);

  const groupCategories = Array.from(
    new Set(
      ((categoriesRes.data ?? []) as any[])
        .map((row) => String(row.category ?? "").trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, "fr"));

  return {
    clubs: managedClubs,
    members: members.sort((left, right) => left.full_name.localeCompare(right.full_name, "fr")),
    groups: ((groupsRes.data ?? []) as any[]).map((row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? "Groupe"),
    })),
    group_categories: groupCategories,
    age_bands: [...NEWS_AGE_BANDS],
  } satisfies NewsTargetOption;
}

export async function fetchClubNewsList(supabaseAdmin: any, clubId: string) {
  const newsRes = await supabaseAdmin
    .from("club_news")
    .select("id,club_id,title,summary,body,status,scheduled_for,published_at,send_notification,send_email,include_linked_parents,last_notification_sent_at,last_email_sent_at,last_dispatch_result,created_at,updated_at,created_by")
    .eq("club_id", clubId)
    .order("updated_at", { ascending: false });
  if (newsRes.error) throw new Error(newsRes.error.message);

  const newsRows = (newsRes.data ?? []) as any[];
  const newsIds = newsRows.map((row) => String(row.id ?? "")).filter(Boolean);
  const creatorIds = Array.from(new Set(newsRows.map((row) => String(row.created_by ?? "")).filter(Boolean)));

  const [targetsRes, creatorsRes] = await Promise.all([
    newsIds.length > 0
      ? supabaseAdmin
          .from("club_news_targets")
          .select("news_id,target_type,target_value")
          .in("news_id", newsIds)
      : ({ data: [], error: null } as const),
    creatorIds.length > 0
      ? supabaseAdmin
          .from("profiles")
          .select("id,first_name,last_name")
          .in("id", creatorIds)
      : ({ data: [], error: null } as const),
  ]);
  if (targetsRes.error) throw new Error(targetsRes.error.message);
  if (creatorsRes.error) throw new Error(creatorsRes.error.message);

  const targetsByNewsId = new Map<string, NewsTargetInput[]>();
  for (const row of targetsRes.data ?? []) {
    const newsId = String((row as any).news_id ?? "");
    if (!newsId) continue;
    const current = targetsByNewsId.get(newsId) ?? [];
    current.push({
      target_type: String((row as any).target_type ?? "") as NewsTargetType,
      target_value: String((row as any).target_value ?? ""),
    });
    targetsByNewsId.set(newsId, current);
  }

  const creatorNameById = new Map<string, string>();
  for (const row of creatorsRes.data ?? []) {
    creatorNameById.set(String((row as any).id ?? ""), fullName((row as any).first_name, (row as any).last_name));
  }

  return newsRows.map((row) => ({
    id: String(row.id ?? ""),
    club_id: String(row.club_id ?? ""),
    title: String(row.title ?? ""),
    summary: row.summary == null ? null : String(row.summary),
    body: String(row.body ?? ""),
    status: String(row.status ?? "draft") as NewsStatus,
    scheduled_for: row.scheduled_for ?? null,
    published_at: row.published_at ?? null,
    send_notification: Boolean(row.send_notification),
    send_email: Boolean(row.send_email),
    include_linked_parents: Boolean(row.include_linked_parents),
    last_notification_sent_at: row.last_notification_sent_at ?? null,
    last_email_sent_at: row.last_email_sent_at ?? null,
    last_dispatch_result:
      row.last_dispatch_result && typeof row.last_dispatch_result === "object"
        ? (row.last_dispatch_result as Record<string, unknown>)
        : {},
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    created_by: String(row.created_by ?? ""),
    created_by_name: creatorNameById.get(String(row.created_by ?? "")) ?? null,
    targets: targetsByNewsId.get(String(row.id ?? "")) ?? [],
  })) satisfies ClubNewsRow[];
}

export function normalizeTargets(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const targets: NewsTargetInput[] = [];
  for (const item of raw) {
    const targetType = String((item as any)?.target_type ?? "").trim() as NewsTargetType;
    const targetValue = String((item as any)?.target_value ?? "").trim();
    if (!["role", "user", "group", "group_category", "age_band"].includes(targetType)) continue;
    if (!targetValue) continue;
    const key = `${targetType}:${targetValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ target_type: targetType, target_value: targetValue });
  }
  return targets;
}

export function normalizeNewsStatus(raw: unknown) {
  const value = String(raw ?? "draft").trim().toLowerCase();
  if (value === "scheduled" || value === "published" || value === "archived") return value as NewsStatus;
  return "draft" as const;
}

export function normalizeSchedule(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function normalizePublication(status: NewsStatus, scheduledFor: string | null) {
  if (status !== "scheduled") return status;
  if (!scheduledFor) return "draft" as const;
  return new Date(scheduledFor).getTime() <= Date.now() ? ("published" as const) : ("scheduled" as const);
}

export async function resolveNewsRecipients(
  supabaseAdmin: any,
  clubId: string,
  targets: NewsTargetInput[],
  includeLinkedParents: boolean
) {
  const activeMembers = await fetchActiveClubMembers(supabaseAdmin, clubId);
  const activeByUserId = new Map(activeMembers.map((member) => [member.user_id, member]));
  const activeRoleByUserId = new Map(activeMembers.map((member) => [member.user_id, member.role]));
  const activeUserIds = new Set(activeMembers.map((member) => member.user_id));

  const groupTargets = targets.filter((target) => target.target_type === "group").map((target) => target.target_value);
  const categoryTargets = new Set(
    targets.filter((target) => target.target_type === "group_category").map((target) => target.target_value)
  );
  const ageBandTargets = new Set(
    targets.filter((target) => target.target_type === "age_band").map((target) => target.target_value)
  );
  const directRoleTargets = new Set(
    targets
      .filter((target) => target.target_type === "role")
      .map((target) => target.target_value)
      .filter((value): value is MemberRole => ["manager", "coach", "player", "parent"].includes(value))
  );
  const directUserTargets = new Set(
    targets.filter((target) => target.target_type === "user").map((target) => target.target_value)
  );

  const groupsRes = await supabaseAdmin
    .from("coach_groups")
    .select("id,head_coach_user_id")
    .eq("club_id", clubId)
    .eq("is_active", true);
  if (groupsRes.error) throw new Error(groupsRes.error.message);
  const clubGroupIds = Array.from(new Set((groupsRes.data ?? []).map((row: any) => String(row.id ?? "")).filter(Boolean)));

  const [groupPlayersRes, groupCoachesRes, groupCategoriesRes, guardiansRes] = await Promise.all([
    clubGroupIds.length > 0
      ? supabaseAdmin.from("coach_group_players").select("group_id,player_user_id").in("group_id", clubGroupIds)
      : ({ data: [], error: null } as const),
    clubGroupIds.length > 0
      ? supabaseAdmin.from("coach_group_coaches").select("group_id,coach_user_id").in("group_id", clubGroupIds)
      : ({ data: [], error: null } as const),
    clubGroupIds.length > 0
      ? supabaseAdmin.from("coach_group_categories").select("group_id,category").in("group_id", clubGroupIds)
      : ({ data: [], error: null } as const),
    includeLinkedParents
      ? supabaseAdmin.from("player_guardians").select("player_id,guardian_user_id").in(
          "player_id",
          activeMembers.filter((member) => member.role === "player").map((member) => member.user_id)
        )
      : ({ data: [], error: null } as const),
  ]);
  if (groupPlayersRes.error) throw new Error(groupPlayersRes.error.message);
  if (groupCoachesRes.error) throw new Error(groupCoachesRes.error.message);
  if (groupCategoriesRes.error) throw new Error(groupCategoriesRes.error.message);
  if (guardiansRes.error) throw new Error(guardiansRes.error.message);

  const groupIdsFromCategories = new Set<string>();
  for (const row of groupCategoriesRes.data ?? []) {
    const category = String((row as any).category ?? "").trim();
    if (!categoryTargets.has(category)) continue;
    const groupId = String((row as any).group_id ?? "").trim();
    if (groupId) groupIdsFromCategories.add(groupId);
  }

  const resolvedGroupIds = new Set([...groupTargets, ...groupIdsFromCategories]);
  const recipientUserIds = new Set<string>();
  const targetedPlayerIds = new Set<string>();

  for (const member of activeMembers) {
    if (directRoleTargets.has(member.role)) recipientUserIds.add(member.user_id);
    if (ageBandTargets.size > 0 && member.role === "player") {
      const band = ageBandKeyFromBirthDate(member.birth_date);
      if (band && ageBandTargets.has(band)) {
        recipientUserIds.add(member.user_id);
        targetedPlayerIds.add(member.user_id);
      }
    }
  }

  for (const userId of directUserTargets) {
    if (!activeUserIds.has(userId)) continue;
    recipientUserIds.add(userId);
    if (activeRoleByUserId.get(userId) === "player") targetedPlayerIds.add(userId);
  }

  for (const row of groupPlayersRes.data ?? []) {
    const groupId = String((row as any).group_id ?? "").trim();
    const playerId = String((row as any).player_user_id ?? "").trim();
    if (!groupId || !playerId || !resolvedGroupIds.has(groupId) || !activeUserIds.has(playerId)) continue;
    recipientUserIds.add(playerId);
    targetedPlayerIds.add(playerId);
  }

  const groupHeadCoachById = new Map<string, string>();
  for (const row of groupsRes.data ?? []) {
    const groupId = String((row as any).id ?? "").trim();
    const headCoachId = String((row as any).head_coach_user_id ?? "").trim();
    if (groupId && headCoachId) groupHeadCoachById.set(groupId, headCoachId);
  }

  for (const groupId of resolvedGroupIds) {
    const headCoachId = groupHeadCoachById.get(groupId);
    if (headCoachId && activeUserIds.has(headCoachId)) recipientUserIds.add(headCoachId);
  }

  for (const row of groupCoachesRes.data ?? []) {
    const groupId = String((row as any).group_id ?? "").trim();
    const coachId = String((row as any).coach_user_id ?? "").trim();
    if (!groupId || !coachId || !resolvedGroupIds.has(groupId) || !activeUserIds.has(coachId)) continue;
    recipientUserIds.add(coachId);
  }

  if (includeLinkedParents) {
    for (const row of guardiansRes.data ?? []) {
      const playerId = String((row as any).player_id ?? "").trim();
      const parentId = String((row as any).guardian_user_id ?? "").trim();
      if (!playerId || !parentId || !targetedPlayerIds.has(playerId)) continue;
      const parentMember = activeByUserId.get(parentId);
      if (!parentMember || parentMember.role !== "parent") continue;
      recipientUserIds.add(parentId);
    }
  }

  const recipientIds = Array.from(recipientUserIds);
  const authUsersById = await fetchAuthUsersByIds(supabaseAdmin, recipientIds);
  const emailRecipients = recipientIds
    .map((userId) => ({
      user_id: userId,
      full_name: activeByUserId.get(userId)?.full_name ?? "Utilisateur",
      email: authUsersById.get(userId)?.email ?? null,
    }))
    .filter((row) => row.email);

  return {
    recipientUserIds: recipientIds,
    emailRecipients,
  };
}

async function sendBrevoEmail(args: {
  toEmail: string;
  toName: string;
  subject: string;
  textContent: string;
  htmlContent: string;
}) {
  const brevoApiKey = mustEnv("BREVO_API_KEY");
  const sender = { name: "ActiviTee", email: "noreply@activitee.golf" };
  const sendRes = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender,
      to: [{ email: args.toEmail, name: args.toName }],
      subject: args.subject,
      textContent: args.textContent,
      htmlContent: args.htmlContent,
    }),
  });

  const sendJson = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    throw new Error(String((sendJson as any)?.message ?? "Email send failed"));
  }
}

function textToHtml(text: string) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
}

async function createServerNotification(args: {
  supabaseAdmin: any;
  actorUserId: string;
  title: string;
  body: string | null;
  kind: string;
  data: Record<string, unknown>;
  recipientUserIds: string[];
}) {
  const recipients = Array.from(new Set(args.recipientUserIds.filter(Boolean))).filter((userId) => userId !== args.actorUserId);
  if (recipients.length === 0) return null;

  const notificationRes = await args.supabaseAdmin
    .from("notifications")
    .insert({
      actor_user_id: args.actorUserId,
      type: args.kind,
      kind: args.kind,
      title: args.title,
      body: args.body,
      data: args.data,
    })
    .select("id")
    .single();
  if (notificationRes.error) throw new Error(notificationRes.error.message);

  const recipientsRes = await args.supabaseAdmin
    .from("notification_recipients")
    .insert(
      recipients.map((userId) => ({
        notification_id: notificationRes.data.id,
        user_id: userId,
      }))
    );
  if (recipientsRes.error) throw new Error(recipientsRes.error.message);

  return String(notificationRes.data.id ?? "");
}

export async function dispatchNews(args: {
  supabaseAdmin: any;
  callerId: string;
  clubId: string;
  newsId: string;
  title: string;
  summary: string | null;
  body: string;
  sendNotification: boolean;
  sendEmail: boolean;
  lastNotificationSentAt: string | null;
  lastEmailSentAt: string | null;
  recipientUserIds: string[];
  emailRecipients: Array<{ user_id: string; full_name: string; email: string | null }>;
}) {
  const result: Record<string, unknown> = {
    recipient_count: args.recipientUserIds.length,
    email_candidate_count: args.emailRecipients.length,
  };

  let lastNotificationSentAt = args.lastNotificationSentAt;
  let lastEmailSentAt = args.lastEmailSentAt;

  if (args.sendNotification && !args.lastNotificationSentAt && args.recipientUserIds.length > 0) {
    try {
      const notificationId = await createServerNotification({
        supabaseAdmin: args.supabaseAdmin,
        actorUserId: args.callerId,
        kind: "manager_news",
        title: args.title,
        body: args.summary ?? null,
        data: {
          club_id: args.clubId,
          news_id: args.newsId,
        },
        recipientUserIds: args.recipientUserIds,
      });
      lastNotificationSentAt = new Date().toISOString();
      result.notification_id = notificationId;
      result.notification_sent_count = args.recipientUserIds.length;
    } catch (error) {
      result.notification_error = error instanceof Error ? error.message : "Notification dispatch failed";
    }
  }

  if (args.sendEmail && !args.lastEmailSentAt && args.emailRecipients.length > 0) {
    const subject = args.title;
    const textContent = [args.summary ?? "", "", args.body].filter(Boolean).join("\n");
    const htmlContent = [args.summary ? `<p>${textToHtml(args.summary)}</p>` : "", `<p>${textToHtml(args.body)}</p>`]
      .filter(Boolean)
      .join("");

    let sent = 0;
    let failed = 0;
    let lastError: string | null = null;

    for (const recipient of args.emailRecipients) {
      if (!recipient.email) continue;
      try {
        await sendBrevoEmail({
          toEmail: recipient.email,
          toName: recipient.full_name,
          subject,
          textContent,
          htmlContent,
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        lastError = error instanceof Error ? error.message : "Email send failed";
      }
    }

    if (sent > 0) lastEmailSentAt = new Date().toISOString();
    result.email_sent_count = sent;
    result.email_failed_count = failed;
    if (lastError) result.email_last_error = lastError;
  }

  return {
    lastNotificationSentAt,
    lastEmailSentAt,
    lastDispatchResult: result,
  };
}
