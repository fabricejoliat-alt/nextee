import { supabase } from "@/lib/supabaseClient";

export type NotificationPreferences = {
  receiveInApp: boolean;
  receivePush: boolean;
  enabledKinds: string[];
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  receiveInApp: true,
  receivePush: false,
  enabledKinds: [],
};

export const NOTIFICATION_KIND_OPTIONS: Array<{ kind: string; labelFr: string; labelEn: string }> = [
  { kind: "coach_event_created", labelFr: "Nouveaux entraînements/événements", labelEn: "New trainings/events" },
  { kind: "coach_event_updated", labelFr: "Modifications d’événements", labelEn: "Event updates" },
  { kind: "coach_event_deleted", labelFr: "Annulations d’événements", labelEn: "Event cancellations" },
  { kind: "coach_player_evaluated", labelFr: "Évaluations coach", labelEn: "Coach evaluations" },
  { kind: "player_marked_absent", labelFr: "Absences signalées", labelEn: "Absences marked" },
  { kind: "player_marked_present", labelFr: "Présences confirmées", labelEn: "Attendance confirmations" },
];

function isMissingRelationError(message: string) {
  const m = message.toLowerCase();
  return m.includes("does not exist") || m.includes("relation") || m.includes("42p01");
}

export function isKindEnabled(kind: string, prefs: NotificationPreferences) {
  if (!prefs.receiveInApp) return false;
  if (prefs.enabledKinds.length === 0) return true;
  return prefs.enabledKinds.includes(kind);
}

export function isKindEnabledForPush(kind: string, prefs: NotificationPreferences) {
  if (!prefs.receivePush) return false;
  if (prefs.enabledKinds.length === 0) return true;
  return prefs.enabledKinds.includes(kind);
}

export async function loadMyNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const res = await supabase
    .from("user_notification_preferences")
    .select("receive_in_app,receive_push,enabled_kinds")
    .eq("user_id", userId)
    .maybeSingle();

  if (res.error) {
    if (isMissingRelationError(res.error.message)) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    throw new Error(res.error.message);
  }

  const row = res.data as { receive_in_app?: boolean | null; receive_push?: boolean | null; enabled_kinds?: string[] | null } | null;
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCES };

  return {
    receiveInApp: row.receive_in_app !== false,
    receivePush: row.receive_push === true,
    enabledKinds: Array.isArray(row.enabled_kinds) ? row.enabled_kinds.filter((x): x is string => typeof x === "string" && x.length > 0) : [],
  };
}

export async function upsertMyNotificationPreferences(
  userId: string,
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const current = await loadMyNotificationPreferences(userId);
  const next: NotificationPreferences = {
    receiveInApp: patch.receiveInApp ?? current.receiveInApp,
    receivePush: patch.receivePush ?? current.receivePush,
    enabledKinds: patch.enabledKinds ?? current.enabledKinds,
  };

  const up = await supabase.from("user_notification_preferences").upsert(
    {
      user_id: userId,
      receive_in_app: next.receiveInApp,
      receive_push: next.receivePush,
      enabled_kinds: next.enabledKinds,
    },
    { onConflict: "user_id" }
  );

  if (up.error) {
    if (isMissingRelationError(up.error.message)) return next;
    throw new Error(up.error.message);
  }

  return next;
}
