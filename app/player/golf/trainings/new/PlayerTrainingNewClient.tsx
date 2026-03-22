"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { isEffectivePlayerPerformanceEnabled } from "@/lib/performanceMode";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { MessageCircle, Send } from "lucide-react";

type SessionType = "club" | "private" | "individual";

type TrainingItemDraft = {
  category: string;
  minutes: string;
  note: string;
};
type EventStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
};

type ClubRow = { id: string; name: string | null };
type ClubMemberRow = { club_id: string };

type ClubEventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};

type ExistingSessionRow = {
  id: string;
  start_at: string;
  location_text: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
  total_minutes: number | null;
};

type ExistingSessionItemRow = {
  category: string;
  minutes: number;
  note: string | null;
};

type CoachFeedbackRow = {
  event_id: string;
  player_id: string;
  coach_id: string;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  visible_to_player: boolean;
  player_note: string | null;
};

type CoachProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

type ProfileLite = { id: string; first_name: string | null; last_name: string | null; avatar_url?: string | null };
type EventAttendeeUiRow = {
  player_id: string;
  status: "expected" | "present" | "absent" | "excused";
  profile: ProfileLite | null;
};
type ThreadMessageRow = {
  id: string;
  sender_user_id: string;
  sender_name: string | null;
  body: string | null;
  created_at: string;
};

type CoachOption = {
  id: string;
  label: string;
  roleLabel: string;
  isHead: boolean;
  avatar_url?: string | null;
};

const TRAINING_CATEGORY_VALUES = [
  "warmup_mobility",
  "long_game",
  "short_game_all",
  "putting",
  "wedging",
  "pitching",
  "chipping",
  "bunker",
  "course",
  "mental",
  "fitness",
  "other",
] as const;

function buildMinuteOptions() {
  const opts: number[] = [];
  for (let m = 5; m <= 300; m += 5) opts.push(m);
  return opts;
}
const MINUTE_OPTIONS = buildMinuteOptions();

function toLocalDateTimeInputValue(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ymdToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeToQuarterHour(localValue: string) {
  if (!localValue) return localValue;
  const dt = new Date(localValue);
  if (Number.isNaN(dt.getTime())) return localValue;

  dt.setSeconds(0, 0);
  const minutes = dt.getMinutes();
  const rounded = Math.round(minutes / 15) * 15;
  dt.setMinutes(rounded);

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function fmtDateTimeRange(startIso: string, durationMinutes: number) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return "—";
  const end = new Date(start.getTime() + Math.max(0, durationMinutes) * 60_000);
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(start);
  const datePart = new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(start);
  const timeFmt = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${datePart} de ${timeFmt.format(start)} à ${timeFmt.format(end)}`;
}

function buildQuarterHourOptions() {
  const opts: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 15) {
      opts.push(`${pad(h)}:${pad(m)}`);
    }
  }
  return opts;
}
const QUARTER_HOUR_OPTIONS = buildQuarterHourOptions();

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function initialsOf(first: string | null | undefined, last: string | null | undefined) {
  const fi = (first ?? "").trim().charAt(0).toUpperCase();
  const li = (last ?? "").trim().charAt(0).toUpperCase();
  return `${fi}${li}` || "👤";
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function coachRatingPercent(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const raw = (value / 6) * 100;
  return Math.max(0, Math.min(100, raw));
}

function fmtMessageTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

async function markThreadRead(threadId: string) {
  const { data: sessRes } = await supabase.auth.getSession();
  const token = sessRes.session?.access_token ?? "";
  if (!token || !threadId) return;
  await fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

export default function PlayerTrainingNewPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const sp = useSearchParams();

  const TRAINING_CATEGORIES: { value: string; label: string }[] = useMemo(
    () =>
      TRAINING_CATEGORY_VALUES.map((value) => ({
        value,
        label: t(`cat.${value}`),
      })),
    [t]
  );

  // ✅ support both param names
  const clubEventId = String(sp.get("club_event_id") ?? sp.get("eventId") ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [performanceEnabled, setPerformanceEnabled] = useState(false);

  const [userId, setUserId] = useState("");
  const [viewerUserId, setViewerUserId] = useState("");

  // clubs
  const [clubIds, setClubIds] = useState<string[]>([]);
  const [clubsById, setClubsById] = useState<Record<string, ClubRow>>({});
  const [clubIdForTraining, setClubIdForTraining] = useState<string>("");

  // fields
  const [startAt, setStartAt] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return normalizeToQuarterHour(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  });

  const [place, setPlace] = useState<string>("");
  const [sessionType, setSessionType] = useState<SessionType>("individual");
  const [hasChosenTrainingType, setHasChosenTrainingType] = useState(false);
  const [nonPerformanceMinutes, setNonPerformanceMinutes] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [motivation, setMotivation] = useState<string>("");
  const [difficulty, setDifficulty] = useState<string>("");
  const [satisfaction, setSatisfaction] = useState<string>("");

  // items
  const [items, setItems] = useState<TrainingItemDraft[]>([]);
  const [plannedStructureItems, setPlannedStructureItems] = useState<EventStructureItemRow[]>([]);

  // planned event (optional)
  const [linkedEvent, setLinkedEvent] = useState<ClubEventRow | null>(null);
  const [linkedGroupName, setLinkedGroupName] = useState<string>("");
  const [existingSessionId, setExistingSessionId] = useState<string>("");
  const [coachFeedback, setCoachFeedback] = useState<CoachFeedbackRow[]>([]);
  const [coachProfilesById, setCoachProfilesById] = useState<Record<string, CoachProfileLite>>({});
  const [eventAttendees, setEventAttendees] = useState<EventAttendeeUiRow[]>([]);
  const [loadingEventAttendees, setLoadingEventAttendees] = useState(false);
  const [eventThreadId, setEventThreadId] = useState("");
  const [eventThreadMessages, setEventThreadMessages] = useState<ThreadMessageRow[]>([]);
  const [eventThreadParticipants, setEventThreadParticipants] = useState<string[]>([]);
  const [loadingEventThread, setLoadingEventThread] = useState(false);
  const [showAllEventAttendees, setShowAllEventAttendees] = useState(false);
  const [threadComposer, setThreadComposer] = useState("");
  const [sendingThreadMessage, setSendingThreadMessage] = useState(false);

  // ✅ coaches (planned: display only / non-planned club: checkbox list)
  const [coachOptions, setCoachOptions] = useState<CoachOption[]>([]);
  const [selectedCoachIds, setSelectedCoachIds] = useState<string[]>([]);

  const totalMinutes = useMemo(() => {
    return items.reduce((sum, it) => {
      const v = Number(it.minutes);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  }, [items]);
  const nonPerformanceTotalMinutes = useMemo(() => {
    if (linkedEvent && sessionType === "club") {
      const planned = Number(linkedEvent.duration_minutes);
      return Number.isFinite(planned) && planned > 0 ? planned : 0;
    }
    const typed = Number(nonPerformanceMinutes);
    return Number.isFinite(typed) && typed > 0 ? typed : 0;
  }, [linkedEvent, sessionType, nonPerformanceMinutes]);

  const isLinkedEventPast = useMemo(() => {
    if (!linkedEvent?.starts_at) return true;
    return new Date(linkedEvent.starts_at).getTime() < Date.now();
  }, [linkedEvent?.starts_at]);
  const linkedAttendanceStatus = useMemo<"expected" | "present" | "absent" | "excused" | null>(() => {
    if (!userId || eventAttendees.length === 0) return null;
    return eventAttendees.find((a) => a.player_id === userId)?.status ?? null;
  }, [eventAttendees, userId]);
  const linkedEventAttendanceBlocked = linkedAttendanceStatus === "absent" || linkedAttendanceStatus === "excused";
  const plannedEventLocked = Boolean(linkedEvent) && !isLinkedEventPast;
  const inputsDisabled = busy || plannedEventLocked || linkedEventAttendanceBlocked;
  const isCoachPlannedTraining = Boolean(linkedEvent);
  const showSensationsCard = useMemo(() => {
    if (!performanceEnabled) return false;
    const ts = new Date(startAt).getTime();
    return Number.isFinite(ts) && ts < Date.now();
  }, [performanceEnabled, startAt]);

  const nonPlannedCoachSummary = useMemo(() => {
    if (linkedEvent) return "";
    if (sessionType !== "club") return "";
    if (selectedCoachIds.length === 0) return "";
    const selected = coachOptions.filter((c) => selectedCoachIds.includes(c.id));
    const names = selected.map((c) => c.label).filter(Boolean);
    if (names.length === 0) return "";
    return `${t("common.coach")} : ${names.join(", ")}`;
  }, [linkedEvent, sessionType, coachOptions, selectedCoachIds, t]);

  const coachNameForSave = useMemo(() => {
    // ✅ planned: save read-only summary based on event coaches
    if (linkedEvent) {
      const heads = coachOptions.filter((c) => c.isHead).map((c) => c.label).filter((x) => x && x !== "—");
      const assists = coachOptions.filter((c) => !c.isHead).map((c) => c.label).filter((x) => x && x !== "—");
      const parts: string[] = [];
      if (heads.length) parts.push(`${t("common.coach")}: ${heads.join(", ")}`);
      if (assists.length) parts.push(`${t("trainingNew.extraCoaches")}: ${assists.join(", ")}`);
      return parts.length ? parts.join(" • ") : null;
    }

    // ✅ non-planned club: save chosen coaches
    if (sessionType === "club") {
      if (selectedCoachIds.length === 0) return null;
      const selected = coachOptions.filter((c) => selectedCoachIds.includes(c.id));
      const names = selected.map((c) => c.label).filter((x) => x && x !== "—");
      return names.length > 0 ? names.join(", ") : null;
    }

    // private/individual: none
    return null;
  }, [linkedEvent, sessionType, coachOptions, selectedCoachIds, t]);

  const canSave = useMemo(() => {
    if (busy) return false;
    if (plannedEventLocked) return false;
    if (linkedEventAttendanceBlocked) return false;
    if (!linkedEvent && !hasChosenTrainingType) return false;
    if (!userId) return false;
    if (!startAt) return false;
    if (sessionType === "club" && !clubIdForTraining) return false;

    if (!performanceEnabled) return nonPerformanceTotalMinutes > 0;

    const hasValidLine = items.some((it) => it.category && Number(it.minutes) > 0);
    if (!hasValidLine) return false;

    for (const it of items) {
      if (!it.category) return false;
      if (!it.minutes.trim()) return false;
      const v = Number(it.minutes);
      if (!Number.isFinite(v) || v <= 0 || v > 300) return false;
      if (v % 5 !== 0) return false;
    }

    return true;
  }, [busy, performanceEnabled, plannedEventLocked, linkedEventAttendanceBlocked, linkedEvent, hasChosenTrainingType, userId, startAt, sessionType, clubIdForTraining, items, nonPerformanceTotalMinutes]);

  const startDate = useMemo(() => {
    if (!startAt.includes("T")) return ymdToday();
    const v = startAt.slice(0, 10);
    return v || ymdToday();
  }, [startAt]);

  const startTime = useMemo(() => {
    if (!startAt.includes("T")) return "18:00";
    const v = startAt.slice(11, 16);
    return QUARTER_HOUR_OPTIONS.includes(v) ? v : "18:00";
  }, [startAt]);

  function updateStartDate(nextDate: string) {
    if (!nextDate) return;
    setStartAt(`${nextDate}T${startTime}`);
  }

  function updateStartTime(nextTime: string) {
    if (!nextTime) return;
    setStartAt(`${startDate}T${nextTime}`);
  }

  async function loadCoachOptionsForPlannedEvent(ev: ClubEventRow): Promise<CoachOption[]> {
  // 1) Try explicit coaches for this event (club_event_coaches)
  const coachesRes = await supabase
    .from("club_event_coaches")
    .select("coach_id")
    .eq("event_id", ev.id);

  let coachIds = uniq((coachesRes.data ?? []).map((r: any) => String(r.coach_id ?? "").trim())).filter(Boolean);

  // 2) Fallback: use group head coach + assistants (if event has no explicit coaches)
  if (coachIds.length === 0) {
    // head coach from coach_groups
    const gRes = await supabase
      .from("coach_groups")
      .select("head_coach_user_id")
      .eq("id", ev.group_id)
      .maybeSingle();

    const headId = String(gRes.data?.head_coach_user_id ?? "").trim();

    // assistants (and possibly also head) from coach_group_coaches
    const gcRes = await supabase
      .from("coach_group_coaches")
      .select("coach_user_id,is_head")
      .eq("group_id", ev.group_id);

    const assistants = (gcRes.data ?? [])
      .filter((r: any) => !Boolean(r.is_head))
      .map((r: any) => String(r.coach_user_id ?? "").trim())
      .filter(Boolean);

    // build final list: head first, then assistants (dedup)
    coachIds = uniq([headId, ...assistants]).filter(Boolean);
  }

  if (coachIds.length === 0) return [];

  // 3) Determine head/assistant flags (best-effort)
  const isHeadById: Record<string, boolean> = {};

  // prefer coach_groups.head_coach_user_id as "head"
  const g2Res = await supabase
    .from("coach_groups")
    .select("head_coach_user_id")
    .eq("id", ev.group_id)
    .maybeSingle();
  const headId2 = String(g2Res.data?.head_coach_user_id ?? "").trim();
  if (headId2) isHeadById[headId2] = true;

  // also read coach_group_coaches flags if present
  const groupRoleRes = await supabase
    .from("coach_group_coaches")
    .select("coach_user_id,is_head")
    .eq("group_id", ev.group_id)
    .in("coach_user_id", coachIds);

  if (!groupRoleRes.error) {
    (groupRoleRes.data ?? []).forEach((r: any) => {
      const id = String(r.coach_user_id ?? "").trim();
      if (!id) return;
      if (Boolean(r.is_head)) isHeadById[id] = true;
      else if (isHeadById[id] === undefined) isHeadById[id] = false;
    });
  }

  // ensure we have at least one head: if none marked, make first one head
  const anyHead = coachIds.some((id) => Boolean(isHeadById[id]));
  if (!anyHead && coachIds[0]) isHeadById[coachIds[0]] = true;

  // 4) Profiles for names
  const pRes = await supabase
    .from("profiles")
    .select("id,first_name,last_name,avatar_url")
    .in("id", coachIds);

  if (pRes.error) return [];

  const byId: Record<string, ProfileLite> = {};
  (pRes.data ?? []).forEach((p: any) => (byId[String(p.id)] = p as ProfileLite));

  // 5) Build options (head first)
  const sorted = [...coachIds].sort((a, b) => Number(Boolean(isHeadById[b])) - Number(Boolean(isHeadById[a])));

    return sorted.map((id) => {
      const p = byId[id];
      const label = p ? nameOf(p.first_name ?? null, p.last_name ?? null) : "—";
      const isHead = Boolean(isHeadById[id]);
      return {
        id,
        label,
        isHead,
        roleLabel: isHead ? t("common.coach") : t("trainingNew.extraCoach"),
        avatar_url: p?.avatar_url ?? null,
      };
    });
}

  async function loadCoachOptionsForNonPlannedClub(clubId: string): Promise<CoachOption[]> {
    // ✅ Entraînement club non lié à un groupe:
    // afficher tous les coachs du club + les head coachs des groupes du club.

    const memRes = await supabase
      .from("club_members")
      .select("user_id,role,is_active")
      .eq("club_id", clubId)
      .eq("is_active", true)
      .eq("role", "coach");

    if (memRes.error) return [];

    const memberCoachIds = uniq((memRes.data ?? []).map((r: any) => String(r.user_id ?? "").trim())).filter(Boolean);

    const grpRes = await supabase
      .from("coach_groups")
      .select("head_coach_user_id")
      .eq("club_id", clubId)
      .eq("is_active", true);

    const headCoachIds = !grpRes.error
      ? uniq((grpRes.data ?? []).map((r: any) => String(r.head_coach_user_id ?? "").trim())).filter(Boolean)
      : [];

    const coachIds = uniq([...memberCoachIds, ...headCoachIds]).filter(Boolean);
    if (coachIds.length === 0) return [];

    const pRes = await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", coachIds);
    if (pRes.error) return [];

    const byId: Record<string, ProfileLite> = {};
    (pRes.data ?? []).forEach((p: any) => {
      byId[String(p.id)] = p as ProfileLite;
    });

    const sorted = [...coachIds].sort((a, b) => {
      const na = nameOf(byId[a]?.first_name ?? null, byId[a]?.last_name ?? null);
      const nb = nameOf(byId[b]?.first_name ?? null, byId[b]?.last_name ?? null);
      return na.localeCompare(nb, "fr");
    });

    return sorted.map((id) => {
      const p = byId[id];
      return {
        id,
        label: p ? nameOf(p.first_name ?? null, p.last_name ?? null) : "—",
        isHead: false,
        roleLabel: t("common.coach"),
        avatar_url: p?.avatar_url ?? null,
      };
    });
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const { effectiveUserId: uid } = await resolveEffectivePlayerContext();
      setUserId(uid);
      const { data: authRes } = await supabase.auth.getUser();
      setViewerUserId(String(authRes.user?.id ?? ""));
      const perfEnabled = await isEffectivePlayerPerformanceEnabled(uid);
      setPerformanceEnabled(perfEnabled);

      // memberships
      const memRes = await supabase.from("club_members").select("club_id").eq("user_id", uid).eq("is_active", true);
      if (memRes.error) {
        setError(memRes.error.message);
        setLoading(false);
        return;
      }

      const ids = Array.from(new Set((memRes.data ?? []).map((r: ClubMemberRow) => r.club_id))).filter(Boolean);
      setClubIds(ids);

      // load clubs for memberships
      if (ids.length > 0) {
        const clubsRes = await supabase.from("clubs").select("id,name").in("id", ids);
        if (clubsRes.error) {
          setError(clubsRes.error.message);
          setLoading(false);
          return;
        }

        const map: Record<string, ClubRow> = {};
        for (const c of clubsRes.data ?? []) map[(c as any).id] = c as ClubRow;
        setClubsById(map);

        setClubIdForTraining(ids[0]);
      } else {
        setClubsById({});
        setClubIdForTraining("");
      }

      // If clubEventId provided: load planned club event and prefill
      if (clubEventId) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        const query = new URLSearchParams({ event_id: clubEventId, child_id: uid });
        const plannedRes = await fetch(`/api/player/training-event?${query.toString()}`, {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        const plannedJson = await plannedRes.json().catch(() => ({}));

        if (!plannedRes.ok) {
          setError(String(plannedJson?.error ?? "Impossible de charger l'entraînement planifié."));
        } else if (plannedJson?.event) {
          const ev = plannedJson.event as ClubEventRow;
          setLinkedEvent(ev);
          setLinkedGroupName(String(plannedJson?.groupName ?? "").trim());
          setExistingSessionId("");

          // ✅ force club session
          setSessionType("club");
          setHasChosenTrainingType(true);

          // ✅ prefill actual start from planned start
          setStartAt(normalizeToQuarterHour(toLocalDateTimeInputValue(ev.starts_at)));

          // ✅ prefill location
          setPlace(ev.location_text ?? "");

          // ✅ use event club_id
          if (ev.club_id) setClubIdForTraining(ev.club_id);

          // ✅ ensure event club exists in dropdown map (even if not in memberships)
          if (ev.club_id && !clubsById[ev.club_id]) {
            const plannedClubName = String(plannedJson?.clubName ?? "").trim();
            if (plannedClubName) {
              setClubsById((prev) => ({ ...prev, [ev.club_id]: { id: ev.club_id as string, name: plannedClubName } }));
              if (!ids.includes(ev.club_id)) setClubIds((prev) => Array.from(new Set([...prev, ev.club_id])));
            }
          }

          // ✅ planned coaches: read-only display (head + assistants)
          const opts: CoachOption[] = await loadCoachOptionsForPlannedEvent(ev);
          setCoachOptions(opts);
          setSelectedCoachIds([]); // pas utilisé en planned

          const fb = (plannedJson?.coachFeedback ?? []) as CoachFeedbackRow[];
          if (fb.length > 0) {
            setCoachFeedback(fb);
            const map: Record<string, CoachProfileLite> = {};
            ((plannedJson?.coachProfiles ?? []) as any[]).forEach((p: any) => {
              map[String(p.id)] = {
                id: String(p.id),
                first_name: p.first_name ?? null,
                last_name: p.last_name ?? null,
                avatar_url: p.avatar_url ?? null,
              };
            });
            setCoachProfilesById(map);
          } else {
            setCoachFeedback([]);
            setCoachProfilesById({});
          }

          let prefilledFromExistingSession = false;
          const existingSessionRes = await supabase
            .from("training_sessions")
            .select("id,start_at,location_text,motivation,difficulty,satisfaction,notes,total_minutes")
            .eq("user_id", uid)
            .eq("club_event_id", ev.id)
            .order("created_at", { ascending: false })
            .limit(1);

          if (!existingSessionRes.error) {
            const existing = ((existingSessionRes.data ?? [])[0] ?? null) as ExistingSessionRow | null;
            if (existing?.id) {
              setExistingSessionId(existing.id);
              setStartAt(normalizeToQuarterHour(toLocalDateTimeInputValue(existing.start_at)));
              setPlace((existing.location_text ?? ev.location_text ?? "").trim());
              setMotivation(existing.motivation != null ? String(existing.motivation) : "");
              setDifficulty(existing.difficulty != null ? String(existing.difficulty) : "");
              setSatisfaction(existing.satisfaction != null ? String(existing.satisfaction) : "");
              setNotes(existing.notes ?? "");
              setNonPerformanceMinutes(
                existing.total_minutes != null && Number(existing.total_minutes) > 0
                  ? String(existing.total_minutes)
                  : ""
              );

              const existingItemsRes = await supabase
                .from("training_session_items")
                .select("category,minutes,note")
                .eq("session_id", existing.id)
                .order("created_at", { ascending: true });
              if (!existingItemsRes.error) {
                const existingRows = (existingItemsRes.data ?? []) as ExistingSessionItemRow[];
                if (existingRows.length > 0) {
                  setItems(
                    existingRows.map((r) => ({
                      category: r.category ?? "",
                      minutes: String(r.minutes ?? ""),
                      note: r.note ?? "",
                    }))
                  );
                  prefilledFromExistingSession = true;
                }
              }
            }
          }

          setPlannedStructureItems((plannedJson?.plannedStructureItems ?? []) as EventStructureItemRow[]);

          if (!prefilledFromExistingSession) {
            setItems([]);
          }

        }
      } else {
        setPlannedStructureItems([]);
        setCoachFeedback([]);
        setCoachProfilesById({});
        setEventAttendees([]);
        setEventThreadId("");
        setEventThreadMessages([]);
        setEventThreadParticipants([]);
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubEventId]);

  useEffect(() => {
    (async () => {
      if (!linkedEvent?.id) {
        setEventAttendees([]);
        setShowAllEventAttendees(false);
        setEventThreadId("");
        setEventThreadMessages([]);
        setEventThreadParticipants([]);
        setLoadingEventAttendees(false);
        setLoadingEventThread(false);
        return;
      }

      setShowAllEventAttendees(false);
      setLoadingEventAttendees(true);
      try {
        const { data: sessRes } = await supabase.auth.getSession();
        const token = sessRes.session?.access_token ?? "";
        if (!token) throw new Error("Missing token");
        const q = new URLSearchParams({
          event_id: linkedEvent.id,
          child_id: userId,
        });
        const res = await fetch(`/api/player/event-attendees?${q.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Attendees load failed"));
        const rows = (json?.attendees ?? []) as Array<{
          player_id: string;
          status: "expected" | "present" | "absent" | "excused";
          first_name: string | null;
          last_name: string | null;
          avatar_url: string | null;
        }>;

        const list: EventAttendeeUiRow[] = rows.map((a) => ({
          player_id: String(a.player_id),
          status: a.status,
          profile: {
            id: String(a.player_id),
            first_name: a.first_name ?? null,
            last_name: a.last_name ?? null,
            avatar_url: a.avatar_url ?? null,
          },
        }));
        list.sort((x, y) => nameOf(x.profile?.first_name ?? null, x.profile?.last_name ?? null).localeCompare(
          nameOf(y.profile?.first_name ?? null, y.profile?.last_name ?? null),
          "fr"
        ));
        setEventAttendees(list);
      } catch {
        setEventAttendees([]);
      } finally {
        setLoadingEventAttendees(false);
      }

      setLoadingEventThread(true);
      try {
        const { data: sessRes } = await supabase.auth.getSession();
        const token = sessRes.session?.access_token ?? "";
        if (!token) {
          setEventThreadId("");
          setEventThreadMessages([]);
          setEventThreadParticipants([]);
          return;
        }
        const threadRes = await fetch(`/api/messages/event-thread?event_id=${encodeURIComponent(linkedEvent.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const threadJson = await threadRes.json().catch(() => ({}));
        if (!threadRes.ok) throw new Error(String(threadJson?.error ?? "Thread load failed"));
        const threadId = String(threadJson?.thread_id ?? "");
        setEventThreadId(threadId);
        if (!threadId) {
          setEventThreadMessages([]);
          setEventThreadParticipants([]);
          return;
        }
        const [msgRes, partRes] = await Promise.all([
          fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/messages?limit=20`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch(`/api/messages/threads/${encodeURIComponent(threadId)}/participants`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
        ]);
        const msgJson = await msgRes.json().catch(() => ({}));
        const partJson = await partRes.json().catch(() => ({}));
        if (!msgRes.ok) throw new Error(String(msgJson?.error ?? "Messages load failed"));
        if (!partRes.ok) throw new Error(String(partJson?.error ?? "Participants load failed"));
        setEventThreadMessages(((msgJson?.messages ?? []) as ThreadMessageRow[]).slice().reverse());
        setEventThreadParticipants((partJson?.participant_full_names ?? []) as string[]);
        await markThreadRead(threadId);
      } catch {
        setEventThreadId("");
        setEventThreadMessages([]);
        setEventThreadParticipants([]);
      } finally {
        setLoadingEventThread(false);
      }
    })();
  }, [linkedEvent?.id, userId]);

  useEffect(() => {
    if (!eventThreadId) return;
    void markThreadRead(eventThreadId);
  }, [eventThreadId, eventThreadMessages.length]);

  // ✅ when NOT planned: load coaches ONLY if user is creating a "club" training
  useEffect(() => {
    (async () => {
      if (!userId) return;
      if (linkedEvent) return; // planned => coaches already loaded
      if (sessionType !== "club") {
        setCoachOptions([]);
        setSelectedCoachIds([]);
        return;
      }
      if (!clubIdForTraining) {
        setCoachOptions([]);
        setSelectedCoachIds([]);
        return;
      }

      const opts: CoachOption[] = await loadCoachOptionsForNonPlannedClub(clubIdForTraining);
      setCoachOptions(opts);

      // par défaut: sélectionner tout ce qui est dispo
      setSelectedCoachIds((prev) => {
        const allowed = new Set(opts.map((o) => o.id));
        const kept = prev.filter((id) => allowed.has(id));
        return kept.length > 0 ? kept : opts.map((o) => o.id);
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, linkedEvent?.id, sessionType, clubIdForTraining]);

  function addLine() {
    if (inputsDisabled) return;
    setItems((prev) => [...prev, { category: "", minutes: "", note: "" }]);
  }

  function removeLine(idx: number) {
    if (inputsDisabled) return;
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, patch: Partial<TrainingItemDraft>) {
    if (inputsDisabled) return;
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function copyPlannedStructure() {
    if (inputsDisabled || plannedStructureItems.length === 0) return;
    setItems(
      plannedStructureItems.map((it) => ({
        category: String(it.category ?? ""),
        minutes: String(it.minutes ?? ""),
        note: String(it.note ?? "").trim(),
      }))
    );
  }

  function setType(next: SessionType) {
    // if linked to an event: type forced club
    if (linkedEvent) return;

    setHasChosenTrainingType(true);
    setSessionType(next);
    if (next === "club" && !clubIdForTraining && clubIds.length > 0) {
      setClubIdForTraining(clubIds[0]);
    }
  }

  async function sendThreadMessage() {
    const trimmed = threadComposer.trim();
    if (!eventThreadId || !trimmed || sendingThreadMessage) return;
    setSendingThreadMessage(true);
    try {
      const { data: sessRes } = await supabase.auth.getSession();
      const token = sessRes.session?.access_token ?? "";
      if (!token) throw new Error(pickLocaleText(locale, "Session invalide.", "Invalid session."));
      const res = await fetch(`/api/messages/threads/${encodeURIComponent(eventThreadId)}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message_type: "text", body: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? pickLocaleText(locale, "Envoi impossible.", "Failed to send message.")));
      const created = json?.message as ThreadMessageRow | undefined;
      if (created?.id) setEventThreadMessages((prev) => [...prev, created].slice(-20));
      setThreadComposer("");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : pickLocaleText(locale, "Envoi impossible.", "Failed to send message.");
      setError(message);
    } finally {
      setSendingThreadMessage(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setBusy(true);
    setError(null);

    if (plannedEventLocked) {
      setError(
        locale === "fr"
          ? "Tu peux saisir la structure et les sensations uniquement une fois l'entraînement passé."
          : "You can enter structure and feelings only once the training is past."
      );
      setBusy(false);
      return;
    }

    if (linkedEventAttendanceBlocked) {
      setError(
        locale === "fr"
          ? "Tu ne peux pas évaluer cet entraînement car ton statut est absent."
          : "You cannot evaluate this training because your attendance status is absent."
      );
      setBusy(false);
      return;
    }

    const dt = new Date(startAt);
    if (Number.isNaN(dt.getTime())) {
      setError("Date/heure invalide.");
      setBusy(false);
      return;
    }

    const club_id = sessionType === "club" ? clubIdForTraining : null;
    const mot = performanceEnabled && showSensationsCard && motivation ? Number(motivation) : null;
    const dif = performanceEnabled && showSensationsCard && difficulty ? Number(difficulty) : null;
    const sat = performanceEnabled && showSensationsCard && satisfaction ? Number(satisfaction) : null;

    // ✅ if linkedEvent, mark attendee present (UPDATE only)
    if (linkedEvent) {
      const upAtt = await supabase
        .from("club_event_attendees")
        .update({ status: "present" })
        .eq("event_id", linkedEvent.id)
        .eq("player_id", userId);

      if (upAtt.error) {
        setError(upAtt.error.message);
        setBusy(false);
        return;
      }
    }

    const sessionPayload = {
      start_at: dt.toISOString(),
      location_text: (linkedEvent ? (linkedEvent.location_text ?? place) : place).trim() || null,
      session_type: sessionType,
      club_id: linkedEvent ? linkedEvent.club_id : club_id,
      coach_name: coachNameForSave,
      motivation: mot,
      difficulty: dif,
      satisfaction: sat,
      notes: notes.trim() || null,
      total_minutes: performanceEnabled ? totalMinutes : nonPerformanceTotalMinutes,
      club_event_id: linkedEvent?.id ?? null,
    };

    let sessionId = "";
    if (linkedEvent && existingSessionId) {
      const updSession = await supabase
        .from("training_sessions")
        .update(sessionPayload)
        .eq("id", existingSessionId)
        .eq("user_id", userId)
        .select("id")
        .single();
      if (updSession.error) {
        setError(updSession.error.message);
        setBusy(false);
        return;
      }
      sessionId = String(updSession.data.id);

      const delItems = await supabase.from("training_session_items").delete().eq("session_id", sessionId);
      if (delItems.error) {
        setError(delItems.error.message);
        setBusy(false);
        return;
      }
    } else {
      const insertSession = await supabase
        .from("training_sessions")
        .insert({
          user_id: userId,
          ...sessionPayload,
        })
        .select("id")
        .single();

      if (insertSession.error) {
        setError(insertSession.error.message);
        setBusy(false);
        return;
      }
      sessionId = String(insertSession.data.id);
    }

    if (performanceEnabled) {
      const payload = items.map((it) => ({
        session_id: sessionId,
        category: it.category,
        minutes: Number(it.minutes),
        note: it.note.trim() || null,
      }));

      if (payload.length > 0) {
        const insertItems = await supabase.from("training_session_items").insert(payload);
        if (insertItems.error) {
          setError(insertItems.error.message);
          setBusy(false);
          return;
        }
      }
    }

    router.push("/player/golf/trainings");
  }

  const showCoachSectionAsCheckboxes = !linkedEvent && sessionType === "club";
  const showCoachSectionPlannedReadOnly = Boolean(linkedEvent);
  const plannedClubName =
    (linkedEvent?.club_id ? clubsById[linkedEvent.club_id]?.name : null) ??
    (clubIdForTraining ? clubsById[clubIdForTraining]?.name : null) ??
    t("common.club");
  const plannedTrainingTypeLabel =
    `${pickLocaleText(locale, "Entraînement", "Training")} ${plannedClubName}`;
  const infoCardTitle = linkedEvent
    ? `${pickLocaleText(locale, "Entraînement", "Training")} • ${linkedGroupName || (pickLocaleText(locale, "Groupe", "Group"))}`
    : `${t("common.date")} · ${t("common.time")} · ${t("common.place")}`;

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings?type=training">
                {t("common.back")}
              </Link>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings?type=training">
                {t("trainings.title")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}

          {sessionType === "club" && clubIds.length === 0 && !loading && (
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>
              {t("trainingNew.noActiveClub")}
            </div>
          )}
        </div>

        <div className="glass-section">
          {loading ? (
            <div
              className="glass-card"
              style={{
                padding: 14,
                background: "rgba(229,231,235,0.70)",
                border: "1px solid rgba(0,0,0,0.10)",
              }}
            >
              <CompactLoadingBlock label={pickLocaleText(locale, "Chargement...", "Loading...")} />
            </div>
          ) : (
            <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
                {linkedEvent ? (
                  <>
                    <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {pickLocaleText(locale, "Entraînement", "Training")} — {linkedGroupName || pickLocaleText(locale, "Groupe", "Group")}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span className="pill-soft">{plannedClubName || t("common.club")}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                        <div className="marketplace-item-title" style={{ fontSize: 28, lineHeight: 1.15, fontWeight: 980 }}>
                          {fmtDateTimeRange(linkedEvent.starts_at, linkedEvent.duration_minutes)}
                        </div>
                        <div className="marketplace-price-pill">{linkedEvent.duration_minutes} {t("common.min")}</div>
                      </div>
                      {linkedEvent.location_text ? (
                        <div style={{ color: "rgba(0,0,0,0.68)", fontWeight: 800, fontSize: 12 }}>
                          📍 {linkedEvent.location_text}
                        </div>
                      ) : null}
                      {linkedEventAttendanceBlocked ? (
                        <div
                          style={{
                            border: "1px solid rgba(239,68,68,0.18)",
                            background: "rgba(239,68,68,0.08)",
                            color: "rgba(127,29,29,1)",
                            borderRadius: 12,
                            padding: "10px 12px",
                            fontSize: 12,
                            fontWeight: 900,
                          }}
                        >
                          {pickLocaleText(
                            locale,
                            "Tu es indiqué absent sur cet entraînement. Il n'apparaît pas dans les entraînements à évaluer et il ne peut pas être évalué.",
                            "You are marked absent for this training. It should not appear in trainings to complete and it cannot be evaluated."
                          )}
                        </div>
                      ) : null}
                    </div>

                    <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                      <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <MessageCircle size={16} />
                        {pickLocaleText(locale, "Fil de discussion", "Discussion thread")}
                      </div>
                      {loadingEventThread ? (
                        <div aria-live="polite" aria-busy="true" style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                          <div className="route-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, boxShadow: "none" }} />
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(0,0,0,0.72)", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                            {pickLocaleText(locale, "Participants", "Participants")}: {eventThreadParticipants.length > 0 ? eventThreadParticipants.join(", ") : "—"}
                          </div>
                          <div
                            style={{
                              border: "1px solid rgba(0,0,0,0.10)",
                              borderRadius: 12,
                              background: "rgba(255,255,255,0.94)",
                              padding: 10,
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            {eventThreadMessages.length === 0 ? (
                              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                                {pickLocaleText(locale, "Aucun message.", "No message.")}
                              </div>
                            ) : (
                              <div
                                style={{
                                  overflow: "auto",
                                  maxHeight: 320,
                                  display: "grid",
                                  gap: 8,
                                  paddingTop: 2,
                                  paddingRight: 8,
                                  alignContent: "start",
                                }}
                              >
                                {eventThreadMessages.map((m) => {
                                  const mine = String(m.sender_user_id ?? "") === viewerUserId;
                                  return (
                                    <div
                                      key={m.id}
                                      style={{
                                        justifySelf: mine ? "end" : "start",
                                        maxWidth: "82%",
                                        borderRadius: 12,
                                        padding: "8px 10px",
                                        background: mine ? "#1b5e20" : "rgba(0,0,0,0.05)",
                                        color: mine ? "white" : "#111827",
                                      }}
                                    >
                                      <div style={{ fontSize: 10, fontWeight: 900, opacity: 0.85, marginBottom: 4 }}>
                                        {String(m.sender_name ?? "").trim() || pickLocaleText(locale, "Membre", "Member")} • {fmtMessageTime(m.created_at)}
                                      </div>
                                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{String(m.body ?? "").trim() || "—"}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr auto" }}>
                            <input
                              className="input"
                              value={threadComposer}
                              onChange={(e) => setThreadComposer(e.target.value)}
                              placeholder={pickLocaleText(locale, "Écrire un message…", "Write a message...")}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void sendThreadMessage();
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={!eventThreadId || !threadComposer.trim() || sendingThreadMessage}
                              onClick={() => void sendThreadMessage()}
                            >
                              <Send size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              {sendingThreadMessage ? pickLocaleText(locale, "Envoi…", "Sending...") : pickLocaleText(locale, "Envoyer", "Send")}
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {pickLocaleText(locale, "Coachs assignés", "Assigned coaches")}
                      </div>
                      {coachOptions.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.55)" }}>{t("trainingNew.noCoachOnSession")}</div>
                      ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                          {coachOptions.map((c) => (
                            <div
                              key={`coach-top-${c.id}`}
                              style={{
                                border: "1px solid rgba(0,0,0,0.10)",
                                borderRadius: 12,
                                background: "rgba(255,255,255,0.78)",
                                padding: "8px 10px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                <div
                                  style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: "50%",
                                    overflow: "hidden",
                                    border: "1px solid rgba(0,0,0,0.10)",
                                    background: "rgba(255,255,255,0.95)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontWeight: 900,
                                    fontSize: 11,
                                    color: "rgba(0,0,0,0.66)",
                                    flexShrink: 0,
                                  }}
                                >
                                  {c.avatar_url ? (
                                    <img src={c.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                  ) : (
                                    initialsOf(
                                      c.label.split(" ").slice(0, 1).join("") || null,
                                      c.label.split(" ").slice(1).join(" ") || null
                                    )
                                  )}
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(0,0,0,0.82)" }}>{c.label}</div>
                              </div>
                              <span className="pill-soft" style={{ fontWeight: 900, whiteSpace: "nowrap" }}>
                                {c.isHead ? "Head coach" : t("trainingNew.extraCoach")}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {pickLocaleText(locale, "Joueurs", "Players")} ({eventAttendees.length})
                      </div>
                      {loadingEventAttendees ? (
                        <div aria-live="polite" aria-busy="true" style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                          <div className="route-loading-spinner" style={{ width: 18, height: 18, borderWidth: 2, boxShadow: "none" }} />
                        </div>
                      ) : eventAttendees.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                          {pickLocaleText(locale, "Aucun joueur.", "No player.")}
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                          {(showAllEventAttendees ? eventAttendees : eventAttendees.slice(0, 6)).map((a) => {
                            const status = a.status;
                            const statusLabel =
                              status === "present"
                                ? pickLocaleText(locale, "Présent", "Present")
                                : status === "absent"
                                  ? pickLocaleText(locale, "Absent", "Absent")
                                  : status === "excused"
                                    ? pickLocaleText(locale, "Excusé", "Excused")
                                    : pickLocaleText(locale, "Attendu", "Expected");
                            const badgeStyle: CSSProperties =
                              status === "present"
                                ? { background: "rgba(27,94,32,0.14)", color: "#1b5e20", border: "1px solid rgba(27,94,32,0.24)" }
                                : status === "absent"
                                  ? { background: "rgba(198,40,40,0.12)", color: "#b91c1c", border: "1px solid rgba(198,40,40,0.22)" }
                                  : status === "excused"
                                    ? { background: "rgba(120,53,15,0.12)", color: "#92400e", border: "1px solid rgba(120,53,15,0.20)" }
                                    : { background: "rgba(0,0,0,0.08)", color: "rgba(0,0,0,0.72)", border: "1px solid rgba(0,0,0,0.16)" };
                            return (
                              <div
                                key={`evt-att-top-${a.player_id}`}
                                style={{
                                  border: "1px solid rgba(0,0,0,0.10)",
                                  borderRadius: 12,
                                  background: "rgba(255,255,255,0.78)",
                                  padding: "8px 10px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 10,
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                  <div
                                    style={{
                                      width: 30,
                                      height: 30,
                                      borderRadius: "50%",
                                      overflow: "hidden",
                                      border: "1px solid rgba(0,0,0,0.10)",
                                      background: "rgba(255,255,255,0.95)",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontWeight: 900,
                                      fontSize: 11,
                                      color: "rgba(0,0,0,0.66)",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {a.profile?.avatar_url ? (
                                      <img src={a.profile.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                    ) : (
                                      initialsOf(a.profile?.first_name ?? null, a.profile?.last_name ?? null)
                                    )}
                                  </div>
                                  <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(0,0,0,0.82)" }}>
                                    {nameOf(a.profile?.first_name ?? null, a.profile?.last_name ?? null)}
                                  </div>
                                </div>
                                <span className="pill-soft" style={{ ...badgeStyle, fontWeight: 900, whiteSpace: "nowrap" }}>
                                  {statusLabel}
                                </span>
                              </div>
                            );
                          })}
                          {eventAttendees.length > 6 ? (
                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setShowAllEventAttendees((prev) => !prev)}
                                style={{ minHeight: 34, fontWeight: 900, minWidth: 170 }}
                              >
                                {showAllEventAttendees
                                  ? `${pickLocaleText(locale, "Afficher moins", "Show less")} ↑`
                                  : `${pickLocaleText(locale, "Afficher plus", "Show more")} ↓`}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {pickLocaleText(locale, "Structure planifiée", "Planned structure")}
                      </div>
                      <div
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 12,
                          background: "rgba(255,255,255,0.88)",
                          padding: 10,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        {plannedStructureItems.length === 0 ? (
                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                            {pickLocaleText(locale, "Non saisi.", "Not entered.")}
                          </div>
                        ) : (
                          <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                            {plannedStructureItems.map((it, idx) => {
                              const label = TRAINING_CATEGORIES.find((c) => c.value === it.category)?.label ?? it.category;
                              const extra = String(it.note ?? "").trim();
                              return (
                                <li key={`planned-struct-top-${idx}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                                  {label} — {it.minutes} min
                                  {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}

                {Boolean(linkedEvent) && coachFeedback.length > 0 ? (
                  <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>{t("trainingDetail.coachEvaluation")}</div>
                    <div style={{ display: "grid", gap: 10 }}>
                      {coachFeedback.map((fb, idx) => {
                        const cp = coachProfilesById[fb.coach_id];
                        const coachName = cp ? nameOf(cp.first_name, cp.last_name) : t("common.coach");
                        return (
                          <div key={`${fb.coach_id}-${idx}`} style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(0,0,0,0.82)" }}>{coachName}</div>
                            <div style={{ display: "grid", gap: 10 }}>
                              <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>Engagement</div>
                                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{fb.engagement ?? "—"}</div>
                                </div>
                                <div className="bar">
                                  <span style={{ width: `${coachRatingPercent(fb.engagement)}%` }} />
                                </div>
                              </div>

                              <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>Attitude</div>
                                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{fb.attitude ?? "—"}</div>
                                </div>
                                <div className="bar">
                                  <span style={{ width: `${coachRatingPercent(fb.attitude)}%` }} />
                                </div>
                              </div>

                              <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.68)" }}>Application</div>
                                  <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{fb.performance ?? "—"}</div>
                                </div>
                                <div className="bar">
                                  <span style={{ width: `${coachRatingPercent(fb.performance)}%` }} />
                                </div>
                              </div>

                              {String(fb.player_note ?? "").trim() ? (
                                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)", whiteSpace: "pre-wrap" }}>
                                  {fb.player_note}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {!linkedEvent ? (
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{infoCardTitle}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                    <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                      <span style={fieldLabelStyle}>{t("common.date")}</span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => updateStartDate(e.target.value)}
                        disabled={inputsDisabled || isCoachPlannedTraining}
                        style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
                      />
                    </label>

                    <label style={{ display: "grid", gap: 6, minWidth: 0 }}>
                      <span style={fieldLabelStyle}>{t("common.time")}</span>
                      <select
                        value={startTime}
                        onChange={(e) => updateStartTime(e.target.value)}
                        disabled={inputsDisabled || isCoachPlannedTraining}
                        style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
                      >
                        {QUARTER_HOUR_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>
                      {t("common.place")} {!linkedEvent ? <span style={{ opacity: 0.7 }}>({t("common.optional")})</span> : null}
                    </span>
                    <input
                      value={place}
                      onChange={(e) => setPlace(e.target.value)}
                      disabled={inputsDisabled || Boolean(linkedEvent)}
                      placeholder={t("trainingNew.placePlaceholder")}
                    />
                  </label>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={fieldLabelStyle}>{t("trainingNew.trainingType")}</div>
                    {linkedEvent ? (
                      <div
                        style={{
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.10)",
                          background: "rgba(255,255,255,0.70)",
                          padding: "10px 12px",
                          fontSize: 13,
                          fontWeight: 900,
                          color: "rgba(0,0,0,0.80)",
                        }}
                      >
                        {plannedTrainingTypeLabel}
                      </div>
                    ) : (
                      <select
                        value={hasChosenTrainingType ? sessionType : ""}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (!next) return;
                          setType(next as SessionType);
                        }}
                        disabled={inputsDisabled}
                        required
                      >
                        <option value="">{pickLocaleText(locale, "Veuillez sélectionner", "Please select")}</option>
                        <option value="individual">{t("trainingDetail.typeIndividual")}</option>
                        <option value="private">{t("trainingDetail.typePrivate")}</option>
                      </select>
                    )}

                    {plannedEventLocked ? (
                      <div
                        style={{
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.10)",
                          background: "rgba(255,255,255,0.70)",
                          padding: "8px 10px",
                          fontSize: 12,
                          fontWeight: 850,
                          color: "rgba(0,0,0,0.65)",
                        }}
                      >
                        {locale === "fr"
                          ? "La structure et les sensations seront saisissables après la date de l'entraînement."
                          : "Structure and feelings will be editable after the training date."}
                      </div>
                    ) : null}

                    {sessionType === "club" && (
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("common.club")}</span>
                        <select
                          value={clubIdForTraining}
                          onChange={(e) => setClubIdForTraining(e.target.value)}
                          disabled={inputsDisabled || clubIds.length === 0 || Boolean(linkedEvent)}
                        >
                          <option value="">-</option>
                          {clubIds.map((id) => (
                            <option key={id} value={id}>
                              {clubsById[id]?.name ?? id}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    {!performanceEnabled ? (
                      linkedEvent && sessionType === "club" ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{pickLocaleText(locale, "Durée (min)", "Duration (min)")}</span>
                          <div
                            style={{
                              borderRadius: 10,
                              border: "1px solid rgba(0,0,0,0.10)",
                              background: "rgba(255,255,255,0.70)",
                              padding: "10px 12px",
                              fontSize: 13,
                              fontWeight: 900,
                              color: "rgba(0,0,0,0.80)",
                            }}
                          >
                            {nonPerformanceTotalMinutes > 0 ? `${nonPerformanceTotalMinutes} min` : "—"}
                          </div>
                        </div>
                      ) : (
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{pickLocaleText(locale, "Durée (min)", "Duration (min)")}</span>
                          <select
                            value={nonPerformanceMinutes}
                            onChange={(e) => setNonPerformanceMinutes(e.target.value)}
                            disabled={inputsDisabled}
                            required
                          >
                            <option value="">{pickLocaleText(locale, "Veuillez sélectionner", "Please select")}</option>
                            {MINUTE_OPTIONS.map((m) => (
                              <option key={`non-perf-duration-${m}`} value={String(m)}>
                                {m} min
                              </option>
                            ))}
                          </select>
                        </label>
                      )
                    ) : null}

                    {/* ✅ Coach section:
                        - Planned: read-only display head coach + coachs supplémentaires
                        - Non-planned club: checkbox list
                        - Private/Individual: nothing
                    */}
                    {showCoachSectionPlannedReadOnly && !linkedEvent ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("common.coach")}</span>
                        <div
                          style={{
                            borderRadius: 12,
                            border: "1px solid rgba(0,0,0,0.10)",
                            background: "rgba(255,255,255,0.75)",
                            padding: "10px 12px",
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          {coachOptions.length === 0 ? (
                            <div style={{ fontSize: 12, fontWeight: 850, opacity: 0.65 }}>{t("trainingNew.noCoachOnSession")}</div>
                          ) : (
                            <>
                              <div style={{ display: "grid", gap: 8 }}>
                                {coachOptions.map((c) => {
                                  const initials = c.label
                                    .split(" ")
                                    .map((p) => p.trim())
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((p) => p[0]?.toUpperCase() ?? "")
                                    .join("") || "—";

                                  return (
                                    <div
                                      key={`planned-coach-${c.id}`}
                                      style={{
                                        borderRadius: 12,
                                        border: "1px solid rgba(0,0,0,0.10)",
                                        background: "rgba(255,255,255,0.88)",
                                        padding: "8px 10px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 10,
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                        <div
                                          aria-hidden
                                          style={{
                                            width: 28,
                                            height: 28,
                                            borderRadius: "50%",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            fontSize: 11,
                                            fontWeight: 950,
                                            color: "rgba(16,56,34,0.95)",
                                            border: "1px solid rgba(32,99,62,0.28)",
                                            background: "rgba(53,72,59,0.14)",
                                            flex: "0 0 auto",
                                          }}
                                        >
                                          {initials}
                                        </div>
                                        <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(0,0,0,0.84)" }} className="truncate">
                                          {c.label}
                                        </div>
                                      </div>

                                      <div
                                        className="pill-soft"
                                        style={{
                                          background: c.isHead ? "rgba(53,72,59,0.18)" : "rgba(0,0,0,0.08)",
                                          color: c.isHead ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.72)",
                                          fontWeight: 900,
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {c.isHead ? "Head coach" : t("trainingNew.extraCoach")}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                            </>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {showCoachSectionAsCheckboxes ? (
                      <div style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingNew.coachOptional")}</span>

                        <div
                          style={{
                            borderRadius: 12,
                            border: "1px solid rgba(0,0,0,0.10)",
                            background: "rgba(255,255,255,0.75)",
                            padding: "10px 12px",
                            display: "grid",
                            gap: 10,
                            opacity: inputsDisabled ? 0.65 : 1,
                          }}
                        >
                          {coachOptions.length === 0 ? (
                            <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.55)" }}>
                              {t("trainingNew.noCoachInClub")}
                            </div>
                          ) : (
                            <>
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={inputsDisabled}
                                  onClick={() => setSelectedCoachIds(coachOptions.map((c) => c.id))}
                                >
                                  {t("trainingNew.selectAll")}
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={inputsDisabled}
                                  onClick={() => setSelectedCoachIds([])}
                                >
                                  {t("trainingNew.none")}
                                </button>
                              </div>

                              <div style={{ display: "grid", gap: 8 }}>
                                {coachOptions.map((c) => {
                                  const checked = selectedCoachIds.includes(c.id);
                                  return (
                                    <label
                                      key={c.id}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 10,
                                        padding: "10px 10px",
                                        borderRadius: 12,
                                        border: "1px solid rgba(0,0,0,0.10)",
                                        background: checked ? "rgba(53,72,59,0.10)" : "rgba(255,255,255,0.60)",
                                        cursor: inputsDisabled ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          disabled={inputsDisabled}
                                          onChange={(e) => {
                                            const next = e.target.checked;
                                            setSelectedCoachIds((prev) => {
                                              if (next) return uniq([...prev, c.id]);
                                              return prev.filter((id) => id !== c.id);
                                            });
                                          }}
                                        />
                                        <div style={{ display: "grid" }}>
                                          <div style={{ fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>{c.label}</div>
                                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>
                                            {c.roleLabel}
                                          </div>
                                        </div>
                                      </div>

                                      <div
                                        className="pill-soft"
                                        style={{
                                          background: "rgba(53,72,59,0.14)",
                                          fontWeight: 950,
                                        }}
                                      >
                                        {c.roleLabel}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>

                              {nonPlannedCoachSummary ? (
                                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>{nonPlannedCoachSummary}</div>
                              ) : (
                                <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.55)" }}>
                                  {t("trainingNew.tipNoCoach")}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ) : null}

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{pickLocaleText(locale, "Notes / remarques", "Notes / remarks")} ({t("common.optional")})</span>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        disabled={inputsDisabled}
                        placeholder={t("roundsNew.notesPlaceholder")}
                        style={{ minHeight: 90 }}
                      />
                    </label>

                  </div>
                </div>
                ) : null}

                {performanceEnabled ? (
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>{t("trainingNew.trainingStructure")}</div>
                    {plannedStructureItems.length > 0 ? (
                      <button
                        type="button"
                        className="btn"
                        onClick={copyPlannedStructure}
                        disabled={inputsDisabled}
                        style={{ minHeight: 34, fontWeight: 900 }}
                      >
                        {pickLocaleText(locale, "Copier la structure planifiée", "Copy planned structure")}
                      </button>
                    ) : null}
                  </div>

                  {linkedEvent ? (
                    <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.58)" }}>
                      {locale === "fr"
                        ? "Renseigne ci-dessous la structure réellement réalisée. La structure peut être renseignée uniquement lorsque l'entraînement a eu lieu."
                        : "Enter below the structure actually completed. Structure can only be entered once the training has taken place."}
                    </div>
                  ) : null}

                  <div style={{ display: "grid", gap: 6 }}>
                    <div
                      style={{
                        height: 42,
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.10)",
                        background: "rgba(255,255,255,0.65)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0 12px",
                        fontWeight: 950,
                        color: "rgba(0,0,0,0.78)",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span>{totalMinutes}</span>
                        <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.65 }}>{t("trainingNew.actualMin")}</span>
                      </div>
                    </div>
                  </div>

                  {items.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {t("trainingNew.addSectionHint")}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {items.map((it, idx) => (
                        <div
                          key={idx}
                          style={{
                            border: "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 14,
                            background: "rgba(255,255,255,0.65)",
                            padding: 12,
                            display: "grid",
                            gap: 10,
                            opacity: inputsDisabled ? 0.65 : 1,
                          }}
                        >
                          <div className="grid-2">
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("trainingNew.section")}</span>
                              <select value={it.category} onChange={(e) => updateLine(idx, { category: e.target.value })} disabled={inputsDisabled}>
                                <option value="">-</option>
                                {TRAINING_CATEGORIES.map((c) => (
                                  <option key={c.value} value={c.value}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("trainingNew.duration")}</span>
                              <select value={it.minutes} onChange={(e) => updateLine(idx, { minutes: e.target.value })} disabled={inputsDisabled}>
                                <option value="">-</option>
                                {MINUTE_OPTIONS.map((m) => (
                                  <option key={m} value={String(m)}>
                                    {m} min
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("trainingNew.noteOptional")}</span>
                            <input
                              value={it.note}
                              onChange={(e) => updateLine(idx, { note: e.target.value })}
                              disabled={inputsDisabled}
                              placeholder={t("trainingNew.notePlaceholder")}
                            />
                          </label>

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div className="pill-soft">{t("trainingNew.section")} {idx + 1}</div>
                            <button type="button" className="btn btn-danger soft" onClick={() => removeLine(idx)} disabled={inputsDisabled}>
                              {t("common.delete")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={addLine} disabled={inputsDisabled}>
                      + {t("trainingNew.addSection")}
                    </button>
                  </div>

                  {!showSensationsCard ? (
                    <button
                      className="cta-green"
                      type="submit"
                      disabled={!canSave || busy}
                      style={{ width: "100%" }}
                    >
                      {busy ? t("trainingNew.saving") : t("common.save")}
                    </button>
                  ) : null}
                </div>
                ) : null}

                {!performanceEnabled && !linkedEvent ? (
                  <button
                    className="cta-green"
                    type="submit"
                    disabled={!canSave || busy}
                    style={{ width: "100%" }}
                  >
                    {busy ? t("trainingNew.saving") : t("common.save")}
                  </button>
                ) : null}

                {showSensationsCard ? (
                  <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>
                      {pickLocaleText(locale, "Sensations et remarques", "Feelings and notes")}
                    </div>

                    <div style={{ display: "grid", gap: 10, opacity: inputsDisabled ? 0.65 : 1 }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingNew.motivationBefore")}</span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                          {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                            const val = String(v);
                            const active = motivation === val;
                            return (
                              <button
                                key={`mot-${v}`}
                                type="button"
                                onClick={() => setMotivation((prev) => (prev === val ? "" : val))}
                                disabled={inputsDisabled}
                                aria-pressed={active}
                                style={{
                                  width: "100%",
                                  height: 34,
                                  borderRadius: 10,
                                  border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                  background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                  color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                  fontWeight: 900,
                                  cursor: inputsDisabled ? "not-allowed" : "pointer",
                                }}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingNew.difficultyDuring")}</span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                          {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                            const val = String(v);
                            const active = difficulty === val;
                            return (
                              <button
                                key={`dif-${v}`}
                                type="button"
                                onClick={() => setDifficulty((prev) => (prev === val ? "" : val))}
                                disabled={inputsDisabled}
                                aria-pressed={active}
                                style={{
                                  width: "100%",
                                  height: 34,
                                  borderRadius: 10,
                                  border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                  background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                  color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                  fontWeight: 900,
                                  cursor: inputsDisabled ? "not-allowed" : "pointer",
                                }}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingNew.satisfactionAfter")}</span>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 6, width: "100%" }}>
                          {Array.from({ length: 6 }, (_, i) => i + 1).map((v) => {
                            const val = String(v);
                            const active = satisfaction === val;
                            return (
                              <button
                                key={`sat-${v}`}
                                type="button"
                                onClick={() => setSatisfaction((prev) => (prev === val ? "" : val))}
                                disabled={inputsDisabled}
                                aria-pressed={active}
                                style={{
                                  width: "100%",
                                  height: 34,
                                  borderRadius: 10,
                                  border: active ? "1px solid rgba(32,99,62,0.55)" : "1px solid rgba(0,0,0,0.14)",
                                  background: active ? "rgba(53,72,59,0.18)" : "rgba(255,255,255,0.80)",
                                  color: active ? "rgba(16,56,34,0.95)" : "rgba(0,0,0,0.78)",
                                  fontWeight: 900,
                                  cursor: inputsDisabled ? "not-allowed" : "pointer",
                                }}
                              >
                                {v}
                              </button>
                            );
                          })}
                        </div>
                      </label>
                    </div>

                    <button
                      className="cta-green"
                      type="submit"
                      disabled={!canSave || busy}
                      style={{ width: "100%" }}
                    >
                      {busy ? t("trainingNew.saving") : t("common.save")}
                    </button>
                  </div>
                ) : null}

              </form>
            )}
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};
