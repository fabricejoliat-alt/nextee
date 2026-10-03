"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { managerEditorFormat } from "@/lib/managerEditorPresentation";
import { managerActivityLabel, managerLocaleTag, managerFormat, type ManagerTranslate } from "@/lib/managerLocale";
import type { AppLocale } from "@/lib/i18n/messages";
import groupStyles from "@/components/manager/GroupsManagement.module.css";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { loadCoachPlanningRoster } from "@/lib/coachPlanningRoster";
import { coachEventSaveErrorKey, coachCreationErrorIsDefinite } from "@/lib/coachEventEditor";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { createAppNotification } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import EventCriteriaSelector from "@/components/evaluations/EventCriteriaSelector";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import {
  ArrowLeft,
  PlusCircle,
  Repeat,
  Trash2,
  Search,
} from "lucide-react";

type GroupRow = { id: string; name: string | null; club_id: string };

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap?: number | null;
  avatar_url?: string | null;
};

type CoachLite = {
  id: string; // coach_user_id
  first_name: string | null;
  last_name: string | null;
  avatar_url?: string | null;
};
type ClubMemberLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url?: string | null;
  role: string | null;
};
type TrainingItemDraft = {
  category: string;
  minutes: string;
  note: string;
};

const EVENT_TYPE_OPTIONS: Array<{ value: "training" | "interclub" | "camp" | "session" | "event"; label: string }> = [
  { value: "training", label: "Entraînement" },
  { value: "interclub", label: "Interclub" },
  { value: "camp", label: "Stage/Camp" },
  { value: "session", label: "Séance" },
  { value: "event", label: "Événement" },
];

function memberRoleLabel(t: ManagerTranslate, role: string | null | undefined) {
  return t(`coach.form.role.${role && ["owner","admin","manager","coach","player","parent","captain","staff"].includes(role) ? role : "member"}`);
}

function fmtDateTime(iso: string, locale: AppLocale) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(managerLocaleTag(locale), {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtDateTimeRange(startIso: string, endIso: string | null, locale: AppLocale) {
  if (!endIso) return fmtDateTime(startIso, locale);
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    const datePart = new Intl.DateTimeFormat(managerLocaleTag(locale), {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(start);
    const timeFmt = new Intl.DateTimeFormat(managerLocaleTag(locale), { hour: "2-digit", minute: "2-digit" });
    return `${datePart} • ${timeFmt.format(start)} → ${timeFmt.format(end)}`;
  }
  return `${fmtDateTime(startIso, locale)} → ${fmtDateTime(endIso, locale)}`;
}

function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowLocalDatetime() {
  const d = new Date();
  return isoToLocalInput(d.toISOString());
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

function ymdToday() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function toYMD(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildDurationOptions() {
  const out: number[] = [];
  for (let m = 30; m <= 300; m += 15) out.push(m);
  return out;
}
const DURATION_OPTIONS = buildDurationOptions();
const MAX_DB_EVENT_DURATION_MINUTES = 300;
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

function buildQuarterHourOptions() {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 15) {
      out.push(`${pad(h)}:${pad(m)}`);
    }
  }
  return out;
}
const QUARTER_HOUR_OPTIONS = buildQuarterHourOptions();

function fullName(p?: { first_name: string | null; last_name: string | null } | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  return `${f} ${l}`.trim() || "—";
}

function initials(p?: { first_name: string | null; last_name: string | null } | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return fi + li || "👤";
}

function avatarNode(p?: ProfileLite | null) {
  if (p?.avatar_url) {
    return (
      <img
        src={p.avatar_url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return initials(p);
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

const compactGreenButtonStyle: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  borderRadius: 9,
  background: "#eef4eb",
  borderColor: "#c9d7c4",
  color: "#35483b",
  fontSize: 12,
  fontWeight: 800,
  boxShadow: "none",
};

export default function ManagerGroupActivityCreatePage() {
  const { locale, t } = useI18n();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const groupId = String(params?.id ?? "").trim();
  const seasonId = useSearchParams().get("season");
  const seasonQuery = seasonId ? `?season=${encodeURIComponent(seasonId)}` : "";
  const planningHref = `/manager/groups/${groupId}/planning${seasonQuery}`;

  const [loading, setLoading] = useState(true);
  const [saving, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const busy = saving || Boolean(createdId) || uncertain;
  const mutationInFlight = useRef(false);
  const loadVersion = useRef(0);
  const currentGroup = useRef(groupId);
  currentGroup.current = groupId;
  const attempt = useRef<{ requestId: string; mode: "single" | "series"; template: Record<string, unknown>;
    criterionIds: string[]; coachIds: string[]; playerIds: string[]; structure: Array<{ category: string; minutes: number; note: string | null }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [, setClubName] = useState("");

  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [players, setPlayers] = useState<ProfileLite[]>([]);
  const [clubMembers, setClubMembers] = useState<ClubMemberLite[]>([]);


  // Coaches selected (simple chips)
  const [coachIdsSelected, setCoachIdsSelected] = useState<string[]>([]);

  // Players selected (same design as group creation)
  const [queryPlayers, setQueryPlayers] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<string, ProfileLite>>({});
  const [queryGuests, setQueryGuests] = useState("");
  const [selectedGuests, setSelectedGuests] = useState<Record<string, ClubMemberLite>>({});

  // create form
  const [mode, setMode] = useState<"single" | "series">("single");
  const [eventType, setEventType] = useState<"training" | "interclub" | "camp" | "session" | "event">("training");

  // single
  const [startsAtLocal, setStartsAtLocal] = useState<string>(() =>
    normalizeToQuarterHour(nowLocalDatetime())
  );
  const [endsAtLocal, setEndsAtLocal] = useState<string>(() => {
    const start = new Date(normalizeToQuarterHour(nowLocalDatetime()));
    start.setHours(start.getHours() + 1);
    return normalizeToQuarterHour(isoToLocalInput(start.toISOString()));
  });
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [eventTitle, setEventTitle] = useState<string>("");
  const [locationText, setLocationText] = useState<string>("");
  const [coachNote, setCoachNote] = useState<string>("");
  const [requiresEvaluation, setRequiresEvaluation] = useState(true);
  const [evaluationCriterionIds, setEvaluationCriterionIds] = useState<string[]>([]);
  const [structureItems, setStructureItems] = useState<TrainingItemDraft[]>([]);

  // series
  const [weekday, setWeekday] = useState<number>(2); // mardi défaut
  const [timeOfDay, setTimeOfDay] = useState<string>("18:00");
  const [intervalWeeks, setIntervalWeeks] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>(() => ymdToday());
  const [endDate, setEndDate] = useState<string>(() => toYMD(addDays(new Date(), 60)));

  // ✅ NEW — filter

  const eventTypeLabelLocalized = (v: string | null | undefined) => managerActivityLabel(t, v ?? "event");

  const selectedPlayersList = useMemo(
    () => Object.values(selectedPlayers).sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale))),
    [selectedPlayers, locale]
  );

  const singleDate = useMemo(() => {
    if (!startsAtLocal.includes("T")) return ymdToday();
    const v = startsAtLocal.slice(0, 10);
    return v || ymdToday();
  }, [startsAtLocal]);

  const singleTime = useMemo(() => {
    if (!startsAtLocal.includes("T")) return "18:00";
    const v = startsAtLocal.slice(11, 16);
    return QUARTER_HOUR_OPTIONS.includes(v) ? v : "18:00";
  }, [startsAtLocal]);

  function updateSingleDate(nextDate: string) {
    if (!nextDate) return;
    setStartsAtLocal(`${nextDate}T${singleTime}`);
  }

  function updateSingleTime(nextTime: string) {
    if (!nextTime) return;
    setStartsAtLocal(`${singleDate}T${nextTime}`);
  }

  const singleEndDate = useMemo(() => {
    if (!endsAtLocal.includes("T")) return singleDate;
    const v = endsAtLocal.slice(0, 10);
    return v || singleDate;
  }, [endsAtLocal, singleDate]);

  const singleEndTime = useMemo(() => {
    if (!endsAtLocal.includes("T")) return singleTime;
    const v = endsAtLocal.slice(11, 16);
    return QUARTER_HOUR_OPTIONS.includes(v) ? v : singleTime;
  }, [endsAtLocal, singleTime]);

  function updateSingleEndDate(nextDate: string) {
    if (!nextDate) return;
    setEndsAtLocal(`${nextDate}T${singleEndTime}`);
  }

  function updateSingleEndTime(nextTime: string) {
    if (!nextTime) return;
    setEndsAtLocal(`${singleEndDate}T${nextTime}`);
  }

  const candidatesPlayers = useMemo(() => {
    const q = queryPlayers.trim().toLowerCase();
    const base = players.filter((p) => !selectedPlayers[p.id]);

    const filtered = !q
      ? base
      : base.filter((p) => {
          const n = fullName(p).toLowerCase();
          const h = typeof p.handicap === "number" ? String(p.handicap) : "";
          return n.includes(q) || h.includes(q);
        });

    return filtered.slice(0, 30);
  }, [players, queryPlayers, selectedPlayers]);

  const allPlayersSelected = useMemo(() => {
    const total = players.length;
    const selectedCount = Object.keys(selectedPlayers).length;
    return total > 0 && selectedCount === total;
  }, [players.length, selectedPlayers]);

  const guestBlockedIds = useMemo(() => {
    const blocked = new Set<string>();
    players.forEach((p) => blocked.add(p.id));
    coaches.forEach((c) => blocked.add(c.id));
    return blocked;
  }, [players, coaches]);

  const selectedGuestsList = useMemo(
    () => Object.values(selectedGuests).sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale))),
    [selectedGuests, locale]
  );

  const candidateGuests = useMemo(() => {
    const q = queryGuests.trim().toLowerCase();
    if (!q) return [] as ClubMemberLite[];
    const base = clubMembers.filter((m) => !guestBlockedIds.has(m.id) && !selectedGuests[m.id]);
    return base
      .filter((m) => {
        const n = fullName(m).toLowerCase();
        const role = memberRoleLabel(t, m.role).toLowerCase();
        return n.includes(q) || role.includes(q);
      })
      .slice(0, 30);
  }, [queryGuests, clubMembers, guestBlockedIds, selectedGuests, t]);

  useEffect(() => {
    setSelectedGuests((prev) => {
      const next: Record<string, ClubMemberLite> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (!guestBlockedIds.has(id)) next[id] = value;
      }
      return next;
    });
  }, [guestBlockedIds]);

  const selectedCoachesList = useMemo(
    () =>
      coaches
        .filter((c) => coachIdsSelected.includes(c.id))
        .sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale))),
    [coaches, coachIdsSelected, locale]
  );

  const candidateCoaches = useMemo(
    () =>
      coaches
        .filter((c) => !coachIdsSelected.includes(c.id))
        .sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale))),
    [coaches, coachIdsSelected, locale]
  );

  const allCoachesSelected = useMemo(() => {
    const total = coaches.length;
    const selectedCount = coachIdsSelected.length;
    return total > 0 && selectedCount === total;
  }, [coaches.length, coachIdsSelected.length]);

  function addStructureLine() {
    setStructureItems((prev) => [...prev, { category: "", minutes: "", note: "" }]);
  }

  function removeStructureLine(idx: number) {
    setStructureItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateStructureLine(idx: number, patch: Partial<TrainingItemDraft>) {
    setStructureItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function toggleSelectedPlayer(p: ProfileLite) {
    setSelectedPlayers((prev) => {
      const next = { ...prev };
      if (next[p.id]) delete next[p.id];
      else next[p.id] = p;
      return next;
    });
  }

  function toggleSelectedGuest(m: ClubMemberLite) {
    setSelectedGuests((prev) => {
      const next = { ...prev };
      if (next[m.id]) delete next[m.id];
      else next[m.id] = m;
      return next;
    });
  }

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);

    try {
      if (!groupId) throw new Error("manager.planning.groupMissing");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (version !== loadVersion.current) return;
      if (uErr || !uRes.user) throw new Error("manager.home.invalidSession");
      setMeId(uRes.user.id);

      const roster = await loadCoachPlanningRoster(supabase, groupId, uRes.user.id);
      if (version !== loadVersion.current) return;
      setGroup(roster.group); setClubName(roster.clubName);
      setClubMembers(roster.members); setCoaches(roster.coaches); setPlayers(roster.players);
      setCoachIdsSelected(roster.coaches.map((coach) => coach.id));
      setSelectedPlayers(Object.fromEntries(roster.players.map((player) => [player.id, player])));
      setSelectedGuests({});
      setLoading(false);
    } catch (e: unknown) {
      if (version !== loadVersion.current) return;
      setError(e instanceof Error && e.message === "forbidden" ? "coach.error.forbidden" : "coach.error.load");
      setGroup(null);
      setClubName("");
      setCoaches([]);
      setPlayers([]);
      setClubMembers([]);
      setSelectedPlayers({});
      setCoachIdsSelected([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    setCreatedId(null); setUncertain(false); setBusy(false); setGroup(null);
    mutationInFlight.current = false; attempt.current = null;
    void load();
    return () => { loadVersion.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function createEvents() {
    if (!group || loading || saving || createdId || mutationInFlight.current) return;
    mutationInFlight.current = true;
    const savedGroup = groupId;
    let committed = false;
    setBusy(true); setError(null);
    try {
      if (!attempt.current) {
        if (["session", "event", "camp"].includes(eventType) && !eventTitle.trim()) throw new Error("title_required");
        const template: Record<string, unknown> = { event_type: eventType, title: eventTitle.trim() || null,
          location_text: locationText.trim() || null, coach_note: coachNote.trim() || null, duration_minutes: durationMinutes, requires_evaluation: ["training", "camp"].includes(eventType) && requiresEvaluation };
        if (mode === "single") {
          const start = new Date(startsAtLocal);
          const end = eventType === "training" ? new Date(start.getTime() + durationMinutes * 60_000) : new Date(endsAtLocal);
          if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error("invalid_event");
          Object.assign(template, { starts_at: start.toISOString(), ends_at: end.toISOString(),
            duration_minutes: Math.min(MAX_DB_EVENT_DURATION_MINUTES, Math.round((end.getTime() - start.getTime()) / 60_000)) });
        } else {
          if (!startDate || !endDate || endDate < startDate) throw new Error("invalid_recurrence");
          Object.assign(template, { weekday, time_of_day: timeOfDay, interval_weeks: intervalWeeks, start_date: startDate, end_date: endDate });
        }
        attempt.current = { requestId: crypto.randomUUID(), mode, template, criterionIds: template.requires_evaluation ? [...evaluationCriterionIds] : [], coachIds: [...coachIdsSelected],
          playerIds: [...new Set([...Object.keys(selectedPlayers), ...Object.keys(selectedGuests)])],
          structure: structureItems.map((item) => ({ category: item.category, minutes: Number(item.minutes), note: item.note.trim() || null })) };
      }
      const request = attempt.current;
      const result = await supabase.rpc("create_manager_events_v1", {
        p_request_id: request.requestId, p_group_id: group.id, p_mode: request.mode, p_template: request.template,
        p_coach_ids: request.coachIds, p_player_ids: request.playerIds, p_structure: request.structure, p_criterion_ids: request.criterionIds,
      });
      if (result.error) throw result.error;
      const ids: string[] = Array.isArray(result.data?.event_ids) ? result.data.event_ids : [];
      if (result.data?.ok !== true || !ids[0]) throw new Error("unconfirmed_creation");
      committed = true;
      if (savedGroup !== currentGroup.current) return;
      setCreatedId(ids[0]); setUncertain(false);
      // A replay is confirmation only: its original notification outcome is unknown.
      if (result.data.replayed) { setError("coach.error.creationRecovered"); return; }
      if (request.playerIds.length && meId) {
        const msg = await getNotificationMessage(request.mode === "single" ? "notif.coachEventCreated" : "notif.coachEventsCreated", locale, {
          eventType: eventTypeLabelLocalized(String(request.template.event_type)), count: ids.length,
          dateTime: request.mode === "single" ? fmtDateTimeRange(String(request.template.starts_at), String(request.template.ends_at), locale) : "",
          locationPart: request.template.location_text ? ` · ${request.template.location_text}` : "",
          changesSummary: `${ids.length} · ${request.template.start_date} → ${request.template.end_date} · ${request.template.time_of_day}`,
        });
        await createAppNotification({ actorUserId: meId, kind: "coach_event_created", title: msg.title, body: msg.body,
          data: { event_id: ids[0], series_id: result.data.series_id, group_id: groupId,
            url: request.mode === "single" ? `/player/golf/trainings/new?club_event_id=${ids[0]}` : "/player/golf/trainings" },
          recipientUserIds: request.playerIds });
      }
      if (savedGroup === currentGroup.current) router.push(`/manager/groups/${groupId}/planning/${ids[0]}${seasonQuery}`);
    } catch (cause) {
      if (savedGroup !== currentGroup.current) return;
      if (committed) setError("coach.error.planningNotification");
      else if (!attempt.current || (coachCreationErrorIsDefinite(cause) || (cause && typeof cause === "object" && "message" in cause && cause.message === "invalid_criteria"))) {
        attempt.current = null; setUncertain(false); setError(cause && typeof cause === "object" && "message" in cause && cause.message === "invalid_criteria" ? "manager.editor.invalidCriteria" : coachEventSaveErrorKey(cause));
      } else {
        setUncertain(true); setError("coach.error.creationUncertain");
      }
    } finally {
      if (savedGroup === currentGroup.current) { mutationInFlight.current = false; setBusy(false); }
    }
  }

  return (
    <main className={`${styles.page} ${groupStyles.page}`}>
      <nav aria-label={t("manager.content.breadcrumb")} style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/manager/groups">{t("manager.content.groups")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/manager/groups/${groupId}`}>{group?.name ?? t("coachHome.groupFallback")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={planningHref}>{t("manager.groups.planning")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>{t("coach.form.addTitle")}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{t("coach.form.addTitle")}</h1>
          <p className={styles.lead}>{managerEditorFormat(t, "addLead", { name: group?.name ?? "" })}</p>
        </div>
        <Link className={actionStyles.backButton} href={planningHref}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t("coach.form.backPlanning")}</Link>
      </div>

      {error && <div className={actionStyles.errorAlert} role="alert">{t(error)}</div>}
      {createdId ? <p role="status">{t("coach.editor.saved")} <Link href={`/manager/groups/${groupId}/planning/${createdId}${seasonQuery}`}>{t("coach.editor.viewSaved")}</Link></p> : null}

      {loading ? (
        <section className={styles.quickPanel}><CompactLoadingBlock label={t("common.loading")} /></section>
      ) : group ? (
        <>
          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>{t("coach.form.information")}</h2>
                <p>{t("coach.form.informationHint")}</p>
              </div>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {mode === "single" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("coach.form.recurrence")}</span>
                    <div className="mode-radio-group" role="radiogroup" aria-label={t("coach.form.recurrence")}>
                      <label className={`mode-radio-option ${mode === "single" ? "is-active" : ""}`}>
                        <input
                          type="radio"
                          name="event-mode"
                          checked={mode === "single"}
                          onChange={() => setMode("single")}
                          disabled={busy}
                        />
                        <span>{t("coach.form.single")}</span>
                      </label>

                      <label className={`mode-radio-option ${String(mode) === "series" ? "is-active" : ""}`}>
                        <input
                          type="radio"
                          name="event-mode"
                          checked={String(mode) === "series"}
                          onChange={() => setMode("series")}
                          disabled={busy}
                        />
                        <span>
                          <Repeat size={16} />
                          {t("coach.form.recurring")}
                        </span>
                      </label>
                    </div>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("coach.form.eventType")}</span>
                    <select value={eventType} onChange={(e) => { const next = e.target.value as typeof eventType; setEventType(next); if (next !== "training") setRequiresEvaluation(false); }} disabled={busy}>
                      {EVENT_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {eventTypeLabelLocalized(opt.value)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {(eventType === "session" || eventType === "event" || eventType === "camp") ? (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>
                        {eventType === "session" ? t("coach.form.sessionName") : eventType === "camp" ? t("coach.form.campName") : t("coach.form.eventName")}
                      </span>
                      <input
                        value={eventTitle}
                        onChange={(e) => setEventTitle(e.target.value)}
                        disabled={busy}
                        placeholder={eventType === "session" ? t("coach.form.sessionExample") : eventType === "camp" ? t("coach.form.campExample") : t("coach.form.eventExample")}
                      />
                    </label>
                  ) : null}

                  <div className="grid-2">
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("coach.form.startDate")}</span>
                      <input type="date" value={singleDate} onChange={(e) => updateSingleDate(e.target.value)} disabled={busy} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("coach.form.startTime")}</span>
                      <select value={singleTime} onChange={(e) => updateSingleTime(e.target.value)} disabled={busy}>
                        {QUARTER_HOUR_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {eventType === "training" ? (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("coach.form.duration")}</span>
                      <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} disabled={busy}>
                        {DURATION_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m} {t("common.min")}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="grid-2">
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("coach.form.endDate")}</span>
                        <input type="date" value={singleEndDate} onChange={(e) => updateSingleEndDate(e.target.value)} disabled={busy} />
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("coach.form.endTime")}</span>
                        <select value={singleEndTime} onChange={(e) => updateSingleEndTime(e.target.value)} disabled={busy}>
                          {QUARTER_HOUR_OPTIONS.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              ) : null}

              {mode === "series" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("coach.form.recurrence")}</span>
                    <div className="mode-radio-group" role="radiogroup" aria-label={t("coach.form.recurrence")}>
                      <label className={`mode-radio-option ${String(mode) === "single" ? "is-active" : ""}`}>
                        <input
                          type="radio"
                          name="event-mode"
                          checked={String(mode) === "single"}
                          onChange={() => setMode("single")}
                          disabled={busy}
                        />
                        <span>{t("coach.form.single")}</span>
                      </label>

                      <label className={`mode-radio-option ${String(mode) === "series" ? "is-active" : ""}`}>
                        <input
                          type="radio"
                          name="event-mode"
                          checked={String(mode) === "series"}
                          onChange={() => setMode("series")}
                          disabled={busy}
                        />
                        <span>
                          <Repeat size={16} />
                          {t("coach.form.recurring")}
                        </span>
                      </label>
                    </div>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("coach.form.eventType")}</span>
                    <select value={eventType} onChange={(e) => { const next = e.target.value as typeof eventType; setEventType(next); if (next !== "training") setRequiresEvaluation(false); }} disabled={busy}>
                      {EVENT_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {eventTypeLabelLocalized(opt.value)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {(eventType === "session" || eventType === "event" || eventType === "camp") ? (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>
                        {eventType === "session" ? t("coach.form.sessionName") : eventType === "camp" ? t("coach.form.campName") : t("coach.form.eventName")}
                      </span>
                      <input
                        value={eventTitle}
                        onChange={(e) => setEventTitle(e.target.value)}
                        disabled={busy}
                        placeholder={eventType === "session" ? t("coach.form.sessionExample") : eventType === "camp" ? t("coach.form.campExample") : t("coach.form.eventExample")}
                      />
                    </label>
                  ) : null}

                  <div className="grid-2">
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("coach.form.day")}</span>
                      <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={busy}>
                        <option value={1}>{t("coach.form.monday")}</option>
                        <option value={2}>{t("coach.form.tuesday")}</option>
                        <option value={3}>{t("coach.form.wednesday")}</option>
                        <option value={4}>{t("coach.form.thursday")}</option>
                        <option value={5}>{t("coach.form.friday")}</option>
                        <option value={6}>{t("coach.form.saturday")}</option>
                        <option value={0}>{t("coach.form.sunday")}</option>
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("coach.form.startTime")}</span>
                      <select value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} disabled={busy}>
                        {QUARTER_HOUR_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid-2">
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("common.from")}</span>
                      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("common.to")}</span>
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={busy} />
                    </label>
                  </div>

                  <div className="grid-2">
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("coach.form.duration")}</span>
                      <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} disabled={busy}>
                        {DURATION_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m} {t("common.min")}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("coach.form.frequency")}</span>
                      <select value={intervalWeeks} onChange={(e) => setIntervalWeeks(Number(e.target.value))} disabled={busy}>
                        {[1, 2, 3, 4].map((w) => (
                          <option key={w} value={w}>
                            {w === 1 ? t("coach.form.everyWeek") : managerFormat(t, "coach.form.everyWeeks", { count: w })}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("coach.form.limitHint")}
                  </div>
                </div>
              ) : null}

              <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>{t("coach.form.location")}</span>
                <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} placeholder={t("coach.form.locationExample")} />
              </label>

            <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>{t("coach.form.notes")}</span>
                <textarea
                  value={coachNote}
                  onChange={(e) => setCoachNote(e.target.value)}
                  disabled={busy}
                  placeholder={t("coach.form.notesExample")}
                  style={{ minHeight: 96 }}
                />
              </label>
              {(eventType === "training" || eventType === "camp") ? (
                <label className="user-mgmt-checkbox-label">
                  <input type="checkbox" checked={requiresEvaluation} onChange={(e) => setRequiresEvaluation(e.target.checked)} disabled={busy} />
                  <span>
                    <b>{t("manager.editor.evaluation")}</b>
                  </span>
                </label>
              ) : null}
              {(eventType === "training" || eventType === "camp") && requiresEvaluation && group ? (
                <EventCriteriaSelector clubId={group.club_id} eventType={eventType} selectedIds={evaluationCriterionIds} onChange={setEvaluationCriterionIds} disabled={busy} />
              ) : null}
            </div>

          </section>

            {eventType === "training" ? (
              <section className={styles.quickPanel}>
                <div className={styles.sectionHeading}><div><h2>{t("manager.editor.structure")}</h2><p>{t("manager.editor.structureHelp")}</p></div></div>

                {structureItems.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("coach.form.structureHint")}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {structureItems.map((it, idx) => (
                      <div key={idx} style={lightRowCardStyle}>
                        <div style={{ display: "grid", gap: 10, width: "100%" }}>
                          <div className="grid-2">
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("coach.form.station")}</span>
                              <select value={it.category} onChange={(e) => updateStructureLine(idx, { category: e.target.value })} disabled={busy}>
                                <option value="">-</option>
                                {TRAINING_CATEGORY_VALUES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {t(`coach.form.category.${cat}`)}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("coach.form.duration")}</span>
                              <select value={it.minutes} onChange={(e) => updateStructureLine(idx, { minutes: e.target.value })} disabled={busy}>
                                <option value="">-</option>
                                {MINUTE_OPTIONS.map((m) => (
                                  <option key={m} value={String(m)}>
                                      {m} {t("common.min")}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("coach.form.note")}</span>
                            <input value={it.note} onChange={(e) => updateStructureLine(idx, { note: e.target.value })} disabled={busy} />
                          </label>

                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button type="button" className="btn" onClick={() => removeStructureLine(idx)} disabled={busy} style={compactGreenButtonStyle}>
                              {t("common.delete")}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="btn" onClick={addStructureLine} disabled={busy}>
                    + {t("coach.form.addStation")}
                  </button>
                </div>
              </section>
            ) : null}

            {/* Select coaches */}
            <section className={styles.quickPanel}>
              <div className={styles.sectionHeading}><div><h2>{t("coach.form.coaches")}</h2><p>{t("manager.editor.coachesHelp")}</p></div></div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || coaches.length === 0 || allCoachesSelected}
                  onClick={() => setCoachIdsSelected(coaches.map((c) => c.id))}
                >
                  {t("coach.form.selectAll")}
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={busy || coaches.length === 0 || coachIdsSelected.length === 0}
                  onClick={() => setCoachIdsSelected([])}
                >
                  {t("coach.form.deselectAll")}
                </button>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{t("coach.form.selection")} ({selectedCoachesList.length})</div>

                {coaches.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noCoaches")}</div>
                ) : selectedCoachesList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noSelectedCoaches")}</div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("coach.directory.actions")} /></tr></thead>
                      <tbody>{selectedCoachesList.map((c) => (
                        <tr key={c.id}>
                          <td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(c)}</span></td>
                          <td><b>{fullName(c)}</b></td>
                          <td><button type="button" className="btn" onClick={() => setCoachIdsSelected((prev) => prev.filter((id) => id !== c.id))} disabled={busy} aria-label={managerFormat(t, "coach.form.removeNamed", { name: fullName(c) })} title={t("coach.group.remove")} style={compactGreenButtonStyle}><Trash2 size={16} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{t("common.add")} ({candidateCoaches.length})</div>

                {coaches.length > 0 && candidateCoaches.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noResults")}</div>
                ) : candidateCoaches.length > 0 ? (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("coach.directory.actions")} /></tr></thead>
                      <tbody>{candidateCoaches.map((c) => (
                        <tr key={c.id}>
                          <td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(c)}</span></td>
                          <td><b>{fullName(c)}</b></td>
                          <td><button type="button" className={actionStyles.secondaryButton} onClick={() => setCoachIdsSelected((prev) => [...prev, c.id])} disabled={busy} aria-label={managerFormat(t, "coach.form.addNamed", { name: fullName(c) })} title={t("common.add")} style={{ width: 42, padding: 0 }}><PlusCircle size={16} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </section>

            {/* Select players */}
            <section className={styles.quickPanel}>
              <div className={styles.sectionHeading}><div><h2>{t("manager.editor.players")}</h2><p>{t("manager.editor.playersHelp")}</p></div></div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || players.length === 0 || allPlayersSelected}
                  onClick={() => {
                    const map: Record<string, ProfileLite> = {};
                    players.forEach((p) => (map[p.id] = p));
                    setSelectedPlayers(map);
                  }}
                >
                  {t("coach.form.selectAll")}
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={busy || players.length === 0 || Object.keys(selectedPlayers).length === 0}
                  onClick={() => setSelectedPlayers({})}
                >
                  {t("coach.form.deselectAll")}
                </button>
              </div>

              <div style={{ position: "relative" }}>
                <Search
                  size={18}
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    opacity: 0.7,
                  }}
                />
                <input
                  value={queryPlayers}
                  onChange={(e) => setQueryPlayers(e.target.value)}
                  disabled={busy}
                  placeholder={t("manager.groups.juniorSearch")}
                  style={{ paddingLeft: 44 }}
                />
              </div>

              {/* Selected */}
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{t("coach.form.selection")} ({selectedPlayersList.length})</div>

                {players.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("manager.groups.noJuniors")}</div>
                ) : selectedPlayersList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("manager.groups.noSelectedJuniors")}</div>
                ) : (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("coach.directory.actions")} /></tr></thead>
                      <tbody>{selectedPlayersList.map((p) => (
                        <tr key={p.id}>
                          <td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(p)}</span></td>
                          <td><b>{fullName(p)}</b></td>
                          <td><button type="button" className="btn" onClick={() => toggleSelectedPlayer(p)} disabled={busy} aria-label={managerFormat(t, "coach.form.removeNamed", { name: fullName(p) })} title={t("coach.group.remove")} style={compactGreenButtonStyle}><Trash2 size={16} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Add */}
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{t("common.add")} ({candidatesPlayers.length})</div>

                {players.length > 0 && candidatesPlayers.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noResults")}</div>
                ) : candidatesPlayers.length > 0 ? (
                  <div className="user-mgmt-table-wrap">
                    <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                      <thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("coach.directory.actions")} /></tr></thead>
                      <tbody>{candidatesPlayers.map((p) => (
                        <tr key={p.id}>
                          <td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(p)}</span></td>
                          <td><b>{fullName(p)}</b></td>
                          <td><button type="button" className={actionStyles.secondaryButton} onClick={() => toggleSelectedPlayer(p)} disabled={busy} aria-label={managerFormat(t, "coach.form.addNamed", { name: fullName(p) })} title={t("common.add")} style={{ width: 42, padding: 0 }}><PlusCircle size={16} /></button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </section>

            {/* Club members visible as guests */}
            <section className={styles.quickPanel}>
              <div className={styles.sectionHeading}><div><h2>{t("coach.form.guests")}</h2><p>{t("manager.editor.guestsHelp")}</p></div></div>

              <div style={{ position: "relative" }}>
                <Search
                  size={18}
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    opacity: 0.7,
                  }}
                />
                <input
                  value={queryGuests}
                  onChange={(e) => setQueryGuests(e.target.value)}
                  disabled={busy}
                  placeholder={t("coach.form.searchGuests")}
                  style={{ paddingLeft: 44 }}
                />
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{t("coach.form.selection")} ({selectedGuestsList.length})</div>
                {selectedGuestsList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noGuests")}</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {selectedGuestsList.map((m) => (
                      <div key={m.id} style={lightRowCardStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={avatarBoxStyle} aria-hidden="true">
                            {avatarNode(m)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950 }}>{fullName(m)}</div>
                            <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>{memberRoleLabel(t, m.role)}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn"
                          onClick={() => toggleSelectedGuest(m)}
                          disabled={busy}
                          style={{ ...compactGreenButtonStyle, padding: "0 12px" }}
                          aria-label={managerFormat(t, "coach.form.removeNamed", { name: fullName(m) })}
                          title={t("coach.group.remove")}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {queryGuests.trim().length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="pill-soft">{t("common.add")} ({candidateGuests.length})</div>
                  {candidateGuests.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noResults")}</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {candidateGuests.map((m) => (
                        <div key={m.id} style={lightRowCardStyle}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <div style={avatarBoxStyle} aria-hidden="true">
                              {avatarNode(m)}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 950 }}>{fullName(m)}</div>
                              <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>{memberRoleLabel(t, m.role)}</div>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="glass-btn"
                            onClick={() => toggleSelectedGuest(m)}
                            disabled={busy}
                            style={{
                              width: 44,
                              height: 42,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background: "rgba(255,255,255,0.70)",
                              border: "1px solid rgba(0,0,0,0.08)",
                            }}
                            aria-label={t("common.add")}
                            title={t("common.add")}
                          >
                            <PlusCircle size={18} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                  {t("coach.form.guestsHint")}
                </div>
              )}
            </section>

            <div className="user-mgmt-card-actions" style={{ paddingBottom: 8 }}>
              <button
                type="button"
                className={actionStyles.primaryButton}
                disabled={saving || loading || Boolean(createdId) || !group}
                onClick={createEvents}
              >
                <PlusCircle size={18} />
                {saving ? t("coachDebrief.saving") : uncertain ? t("coach.editor.resolveCreation") : mode === "single" ? t("coach.form.create") : t("coach.form.createSeries")}
              </button>
            </div>
        </>
      ) : null}
    </main>
  );
}

const avatarBoxStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 14,
  overflow: "hidden",
  background: "rgba(255,255,255,0.65)",
  border: "1px solid rgba(0,0,0,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  color: "var(--green-dark)",
  flexShrink: 0,
};

const lightRowCardStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: 14,
  background: "rgba(255,255,255,0.65)",
  padding: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};
