import { supabase } from "@/lib/supabaseClient";
import { dispatchPush } from "@/lib/pushClient";

export type AppNotificationInput = {
  actorUserId: string;
  kind: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  recipientUserIds: string[];
};

export async function createAppNotification(input: AppNotificationInput) {
  const recipients = Array.from(new Set(input.recipientUserIds.filter(Boolean))).filter((id) => id !== input.actorUserId);
  if (recipients.length === 0) return { ok: true as const, notificationId: null as string | null };

  const nIns = await supabase
    .from("notifications")
    .insert({
      actor_user_id: input.actorUserId,
      type: input.kind,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? {},
    })
    .select("id")
    .single();

  if (nIns.error) throw new Error(nIns.error.message);

  const notificationId = nIns.data.id as string;

  const rIns = await supabase
    .from("notification_recipients")
    .insert(recipients.map((userId) => ({ notification_id: notificationId, user_id: userId })));

  if (rIns.error) throw new Error(rIns.error.message);

  // Fire-and-forget web push dispatch (PWA) for recipients.
  dispatchPush({
    notificationId,
    title: input.title,
    body: input.body ?? null,
    url: (input.data?.url as string | undefined) ?? undefined,
    recipientUserIds: recipients,
  }).catch(() => {});

  return { ok: true as const, notificationId };
}

export async function getUnreadNotificationsCount(userId: string) {
  const res = await supabase
    .from("notification_recipients")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_deleted", false)
    .eq("is_read", false);

  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

export type NotificationRecipientRow = {
  id: number;
  notification_id: string;
  user_id: string;
  is_read: boolean;
  read_at: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  actor_user_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  created_at: string;
};

export async function loadMyNotifications(userId: string) {
  const recRes = await supabase
    .from("notification_recipients")
    .select("id,notification_id,user_id,is_read,read_at,is_deleted,deleted_at,created_at")
    .eq("user_id", userId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(200);

  if (recRes.error) throw new Error(recRes.error.message);
  const recipients = (recRes.data ?? []) as NotificationRecipientRow[];
  const ids = recipients.map((r) => r.notification_id);
  if (ids.length === 0) return [] as Array<{ recipient: NotificationRecipientRow; notification: NotificationRow | null }>;

  const nRes = await supabase
    .from("notifications")
    .select("id,actor_user_id,kind,title,body,data,created_at")
    .in("id", ids);

  if (nRes.error) throw new Error(nRes.error.message);
  const byId = new Map((nRes.data ?? ([] as NotificationRow[])).map((n) => [n.id, n]));

  return recipients.map((recipient) => ({ recipient, notification: byId.get(recipient.notification_id) ?? null }));
}

export async function markNotificationRead(recipientId: number) {
  const res = await supabase
    .from("notification_recipients")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", recipientId);
  if (res.error) throw new Error(res.error.message);
}

export async function markAllNotificationsRead(userId: string) {
  const res = await supabase
    .from("notification_recipients")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("is_deleted", false)
    .eq("is_read", false);
  if (res.error) throw new Error(res.error.message);
}

export async function deleteNotificationRecipient(recipientId: number) {
  const res = await supabase
    .from("notification_recipients")
    .update({ is_deleted: true, deleted_at: new Date().toISOString() })
    .eq("id", recipientId);
  if (res.error) throw new Error(res.error.message);
}

export function applyPwaBadge(unreadCount: number) {
  if (typeof window === "undefined") return;
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (typeof nav.setAppBadge === "function") {
    if (unreadCount > 0) nav.setAppBadge(unreadCount).catch(() => {});
    else if (typeof nav.clearAppBadge === "function") nav.clearAppBadge().catch(() => {});
  }
}

export async function getEventAttendeeUserIds(eventId: string) {
  if (!eventId) return [] as string[];

  const res = await supabase
    .from("club_event_attendees")
    .select("player_id")
    .eq("event_id", eventId);

  if (res.error) throw new Error(res.error.message);
  const rows = (res.data ?? []) as Array<{ player_id: string | null }>;
  return Array.from(new Set(rows.map((r) => String(r.player_id ?? "").trim()).filter(Boolean)));
}

export async function getEventCoachUserIds(eventId: string, groupId?: string | null) {
  if (!eventId) return [] as string[];

  const directRes = await supabase
    .from("club_event_coaches")
    .select("coach_id")
    .eq("event_id", eventId);

  if (directRes.error) throw new Error(directRes.error.message);

  const directIds = Array.from(
    new Set(((directRes.data ?? []) as Array<{ coach_id: string | null }>).map((r) => String(r.coach_id ?? "").trim()).filter(Boolean))
  );

  if (directIds.length > 0 || !groupId) return directIds;

  const [headRes, addRes] = await Promise.all([
    supabase.from("coach_groups").select("head_coach_user_id").eq("id", groupId).maybeSingle(),
    supabase.from("coach_group_coaches").select("coach_user_id").eq("group_id", groupId),
  ]);

  if (headRes.error) throw new Error(headRes.error.message);
  if (addRes.error) throw new Error(addRes.error.message);

  const fallback = [
    String(headRes.data?.head_coach_user_id ?? "").trim(),
    ...((addRes.data ?? []) as Array<{ coach_user_id: string | null }>).map((r) => String(r.coach_user_id ?? "").trim()),
  ].filter(Boolean);

  return Array.from(new Set(fallback));
}
