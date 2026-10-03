"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { managerEditorFormat, managerEditorSaveError } from "@/lib/managerEditorPresentation";
import { managerPlanningFeedback } from "@/lib/managerPlanningPresentation";
import { managerActivityLabel, managerLocaleTag, managerFormat, type ManagerTranslate } from "@/lib/managerLocale";
import type { AppLocale } from "@/lib/i18n/messages";
import groupStyles from "@/components/manager/GroupsManagement.module.css";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ArrowLeft, Repeat, Trash2, PlusCircle, Search } from "lucide-react";
import { createAppNotification } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import EventCriteriaSelector from "@/components/evaluations/EventCriteriaSelector";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

type PlanningSnapshot = {
  event: EventRow;
  coach_ids: string[];
  player_ids: string[];
  structure: Array<{ category: string; minutes: number; note: string | null; position: number }>;
  criterion_ids: string[];
  camp_day?: { camp_id: string } | null;
  series?: SeriesRow;
  future?: PlanningSnapshot[];
};



type GroupRow = { id: string; name: string | null; club_id: string };
type ClubRow = { id: string; name: string | null };

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  coach_note: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
  requires_evaluation: boolean;
};

type SeriesRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  title: string | null;
  location_text: string | null;
  coach_note: string | null;
  duration_minutes: number;
  weekday: number; // 0..6 (JS)
  time_of_day: string; // "HH:mm:ss"
  interval_weeks: number;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  is_active: boolean;
  created_by: string;
};
const EVENT_TYPE_OPTIONS: Array<{ value: "training" | "interclub" | "camp" | "session" | "event"; label: string }> = [
  { value: "training", label: "Entraînement" },
  { value: "interclub", label: "Interclub" },
  { value: "camp", label: "Stage/Camp" },
  { value: "session", label: "Séance" },
  { value: "event", label: "Événement" },
];

type CoachLite = { id: string; first_name: string | null; last_name: string | null; avatar_url?: string | null };
type ClubMemberLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url?: string | null;
  role: string | null;
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap?: number | null;
  avatar_url?: string | null;
};
type TrainingItemDraft = {
  category: string;
  minutes: string;
  note: string;
};

function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

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
  return (fi + li) || "👤";
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
  width: 42,
  height: 32,
  padding: 0,
  borderRadius: 9,
  background: "#eef4eb",
  borderColor: "#c9d7c4",
  color: "#35483b",
  boxShadow: "none",
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
  const out: number[] = [];
  for (let m = 5; m <= 300; m += 5) out.push(m);
  return out;
}
const MINUTE_OPTIONS = buildMinuteOptions();
function buildDurationOptions() {
  const out: number[] = [];
  for (let m = 30; m <= 300; m += 15) out.push(m);
  return out;
}
const DURATION_OPTIONS = buildDurationOptions();
const MAX_DB_EVENT_DURATION_MINUTES = 300;
function buildQuarterHourOptions() {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 15) out.push(`${pad(h)}:${pad(m)}`);
  }
  return out;
}
const QUARTER_HOUR_OPTIONS = buildQuarterHourOptions();

function memberRoleLabel(t: ManagerTranslate, role: string | null | undefined) {
  return t(`coach.form.role.${role && ["owner","admin","manager","coach","player","parent","captain","staff"].includes(role) ? role : "member"}`);
}

function fmtDateTime(iso: string, locale: AppLocale) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale === "fr" ? managerLocaleTag(locale) : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US", {
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
  const localeTag = locale === "fr" ? managerLocaleTag(locale) : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";

  if (sameDay) {
    const datePart = new Intl.DateTimeFormat(localeTag, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(start);
    const timeFmt = new Intl.DateTimeFormat(localeTag, { hour: "2-digit", minute: "2-digit" });
    return `${datePart} • ${timeFmt.format(start)} → ${timeFmt.format(end)}`;
  }
  return `${fmtDateTime(startIso, locale)} → ${fmtDateTime(endIso, locale)}`;
}


export default function ManagerEventEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string }>();
  const { locale, t } = useI18n();
  const groupId = String(params?.id ?? "").trim();
  const seasonId = useSearchParams().get("season");
  const seasonQuery = seasonId ? `?season=${encodeURIComponent(seasonId)}` : "";
  const planningHref = `/manager/groups/${groupId}/planning${seasonQuery}`;
  const eventId = String(params?.eventId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [, setClubName] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [series, setSeries] = useState<SeriesRow | null>(null);

  // UI mode
  const [editScope, setEditScope] = useState<"occurrence" | "series">("occurrence");

  // occurrence fields
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const [eventType, setEventType] = useState<"training" | "interclub" | "camp" | "session" | "event">("training");
  const [eventTitle, setEventTitle] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [locationText, setLocationText] = useState<string>("");
  const [coachNote, setCoachNote] = useState<string>("");
  const [requiresEvaluation, setRequiresEvaluation] = useState(true);
  const [evaluationCriterionIds, setEvaluationCriterionIds] = useState<string[]>([]);

  // series fields
  const [weekday, setWeekday] = useState<number>(2);
  const [timeOfDay, setTimeOfDay] = useState<string>("18:00");
  const [intervalWeeks, setIntervalWeeks] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>(() => ymdToday());
  const [endDate, setEndDate] = useState<string>(() => toYMD(addDays(new Date(), 60)));
  const [seriesActive, setSeriesActive] = useState<boolean>(true);

  // coaches
  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [coachIdsSelected, setCoachIdsSelected] = useState<string[]>([]);
  const [clubMembers, setClubMembers] = useState<ClubMemberLite[]>([]);

  // players (same design as planning page)
  const [players, setPlayers] = useState<ProfileLite[]>([]);
  const [queryPlayers, setQueryPlayers] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<string, ProfileLite>>({});
  const [queryGuests, setQueryGuests] = useState("");
  const [selectedGuests, setSelectedGuests] = useState<Record<string, ClubMemberLite>>({});
  const [editSnapshot, setEditSnapshot] = useState<PlanningSnapshot | null>(null);
  const [saveCommitted, setSaveCommitted] = useState(false);
  const mutationInFlight = useRef(false);
  const loadVersion = useRef(0);
  const [deleteCommitted, setDeleteCommitted] = useState(false);
  const [structureItems, setStructureItems] = useState<TrainingItemDraft[]>([]);

  const occDate = useMemo(() => {
    if (!startsAtLocal.includes("T")) return ymdToday();
    return startsAtLocal.slice(0, 10) || ymdToday();
  }, [startsAtLocal]);
  const occTime = useMemo(() => {
    if (!startsAtLocal.includes("T")) return "18:00";
    const v = startsAtLocal.slice(11, 16);
    return QUARTER_HOUR_OPTIONS.includes(v) ? v : "18:00";
  }, [startsAtLocal]);
  const occEndDate = useMemo(() => {
    if (!endsAtLocal.includes("T")) return occDate;
    return endsAtLocal.slice(0, 10) || occDate;
  }, [endsAtLocal, occDate]);
  const occEndTime = useMemo(() => {
    if (!endsAtLocal.includes("T")) return occTime;
    const v = endsAtLocal.slice(11, 16);
    return QUARTER_HOUR_OPTIONS.includes(v) ? v : occTime;
  }, [endsAtLocal, occTime]);

  function updateOccDate(nextDate: string) {
    if (!nextDate) return;
    setStartsAtLocal(`${nextDate}T${occTime}`);
  }
  function updateOccTime(nextTime: string) {
    if (!nextTime) return;
    setStartsAtLocal(`${occDate}T${nextTime}`);
  }
  function updateOccEndDate(nextDate: string) {
    if (!nextDate) return;
    setEndsAtLocal(`${nextDate}T${occEndTime}`);
  }
  function updateOccEndTime(nextTime: string) {
    if (!nextTime) return;
    setEndsAtLocal(`${occEndDate}T${nextTime}`);
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

  function addStructureLine() {
    setStructureItems((prev) => [...prev, { category: "", minutes: "", note: "" }]);
  }

  function removeStructureLine(idx: number) {
    setStructureItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateStructureLine(idx: number, patch: Partial<TrainingItemDraft>) {
    setStructureItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  const selectedPlayersList = useMemo(
    () =>
      Object.values(selectedPlayers).sort((a, b) =>
        fullName(a).localeCompare(fullName(b), managerLocaleTag(locale))
      ),
    [selectedPlayers, locale]
  );

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

  const selectedCoachesList = useMemo(
    () =>
      coaches
        .filter((c) => coachIdsSelected.includes(c.id))
        .sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), managerLocaleTag(locale))),
    [coaches, coachIdsSelected, locale]
  );

  const candidateCoaches = useMemo(
    () =>
      coaches
        .filter((c) => !coachIdsSelected.includes(c.id))
        .sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), managerLocaleTag(locale))),
    [coaches, coachIdsSelected, locale]
  );

  const allCoachesSelected = useMemo(() => {
    const total = coaches.length;
    const selectedCount = coachIdsSelected.length;
    return total > 0 && selectedCount === total;
  }, [coaches.length, coachIdsSelected.length]);

  const guestBlockedIds = useMemo(() => {
    const blocked = new Set<string>();
    players.forEach((p) => blocked.add(p.id));

    return blocked;
  }, [players]);

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

  async function load() {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);

    try {
      if (!groupId || !eventId) throw new Error("manager.planning.eventMissing");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (version !== loadVersion.current) return;
      if (uErr || !uRes.user) throw new Error("manager.home.invalidSession");
      setMeId(uRes.user.id);

      const snapshotResult = await supabase.rpc("get_manager_planning_snapshot_v1", { p_event_id: eventId });
      if (version !== loadVersion.current) return;
      if (snapshotResult.error || !snapshotResult.data?.event) throw snapshotResult.error ?? new Error("manager.planning.eventNotFound");
      const snapshot = snapshotResult.data as PlanningSnapshot;
      const ev = snapshot.event;
      if (snapshot.camp_day) {
        router.push(`/manager/camps/new?campId=${encodeURIComponent(snapshot.camp_day.camp_id)}`);
        return;
      }
      if (ev.group_id !== groupId) throw new Error("manager.groups.notFound");
      setEditSnapshot(snapshot);
      setSaveCommitted(false);
      setEvent(ev);

      setStartsAtLocal(isoToLocalInput(ev.starts_at));
      setEndsAtLocal(isoToLocalInput(ev.ends_at ?? new Date(new Date(ev.starts_at).getTime() + ev.duration_minutes * 60000).toISOString()));
      setEventType(ev.event_type ?? "training");
      setEventTitle(ev.title ?? "");
      setDurationMinutes(ev.duration_minutes);
      setLocationText(ev.location_text ?? "");
      setCoachNote(ev.coach_note ?? "");
      setRequiresEvaluation(Boolean(ev.requires_evaluation));
      setEvaluationCriterionIds(snapshot.criterion_ids);

      // group
      const gRes = await supabase.from("coach_groups").select("id,name,club_id").eq("id", groupId).maybeSingle();
      if (version !== loadVersion.current) return;
      if (gRes.error) throw new Error(gRes.error.message);
      if (!gRes.data) throw new Error("manager.groups.notFound");
      setGroup(gRes.data as GroupRow);
      const isSpecificGroup =
        String(gRes.data.name ?? "").trim() === "Groupe spécifique" ||
        String(gRes.data.name ?? "").startsWith("__EVENT_SPECIFIQUE__");

      // club name
      const cRes = await supabase.from("clubs").select("id,name").eq("id", gRes.data.club_id).maybeSingle();
      if (version !== loadVersion.current) return;
      if (!cRes.error && cRes.data) setClubName((cRes.data as ClubRow).name ?? t("common.club"));
      else setClubName(t("common.club"));

      // all active club members (for guests)
      const cmRes = await supabase
        .from("club_members")
        .select("user_id, role")
        .eq("club_id", gRes.data.club_id)
        .eq("is_active", true);
      if (version !== loadVersion.current) return;
      if (cmRes.error) throw new Error(cmRes.error.message);
      const cmRows = (cmRes.data ?? []) as Array<{ user_id: string; role: string | null }>;
      const memberIds = Array.from(new Set(cmRows.map((r) => r.user_id).filter(Boolean)));
      const profilesById = new Map<
        string,
        { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }
      >();
      if (memberIds.length > 0) {
        const profRes = await supabase.from("profiles").select("id, first_name, last_name, avatar_url").in("id", memberIds);
        if (version !== loadVersion.current) return;
        if (profRes.error) throw new Error(profRes.error.message);
        ((profRes.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>).forEach((p) => {
          profilesById.set(p.id, p);
        });
      }
      const cmList: ClubMemberLite[] = cmRows.map((r) => {
        const p = profilesById.get(r.user_id);
        return {
          id: r.user_id,
          first_name: p?.first_name ?? null,
          last_name: p?.last_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          role: r.role ?? null,
        };
      });
      cmList.sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale)));
      setClubMembers(cmList);

      // series
      if (ev.series_id) {
        const s = snapshot.series ?? null;
        setSeries(s);

        if (s) {
          setEditScope("occurrence");
          setWeekday(s.weekday);
          setTimeOfDay((s.time_of_day ?? "18:00:00").slice(0, 5));
          setIntervalWeeks(s.interval_weeks ?? 1);
          setStartDate(s.start_date ?? ymdToday());
          setEndDate(s.end_date ?? toYMD(addDays(new Date(), 60)));
          setSeriesActive(!!s.is_active);
          // Keep the selected occurrence as the draft, including its individual changes.
        } else {
          setEditScope("occurrence");
        }
      } else {
        setSeries(null);
        setEditScope("occurrence");
      }

      // coachs disponibles pour cette occurrence: tous les coachs actifs du club
      const clubCoachRows = cmList.filter((m) => m.role === "coach");
      let coList: CoachLite[] = clubCoachRows.map((m) => ({
        id: m.id,
        first_name: m.first_name ?? null,
        last_name: m.last_name ?? null,
        avatar_url: m.avatar_url ?? null,
      }));

      // A specific activity is not restricted to the members of its support
      // group: any active junior of the club may be expected.
      let plList: ProfileLite[];
      if (isSpecificGroup) {
        plList = cmList
          .filter((member) => member.role === "player")
          .map((member) => ({
            id: member.id,
            first_name: member.first_name,
            last_name: member.last_name,
            avatar_url: member.avatar_url ?? null,
            handicap: null,
          }));
      } else {
        const plRes = await supabase
          .from("coach_group_players")
          .select("player_user_id, profiles:player_user_id ( id, first_name, last_name, handicap, avatar_url )")
          .eq("group_id", groupId);
        if (version !== loadVersion.current) return;

        if (plRes.error) throw new Error(plRes.error.message);
        plList = ((plRes.data ?? []) as unknown as Array<{ player_user_id: string; profiles: ProfileLite | null }>).map((r) => ({
          id: r.profiles?.id ?? r.player_user_id,
          first_name: r.profiles?.first_name ?? null,
          last_name: r.profiles?.last_name ?? null,
          handicap: r.profiles?.handicap ?? null,
          avatar_url: r.profiles?.avatar_url ?? null,
        }));
      }
      plList.sort((a, b) => fullName(a).localeCompare(fullName(b), managerLocaleTag(locale)));
      setPlayers(plList);

      // selected coaches on event (BD: club_event_coaches.coach_id)
      const selectedCoachIds = snapshot.coach_ids;
      const missingCoachIds = selectedCoachIds.filter((id) => !coList.some((c) => c.id === id));
      if (missingCoachIds.length > 0) {
        const missingCoachProfiles = await supabase
          .from("profiles")
          .select("id,first_name,last_name,avatar_url")
          .in("id", missingCoachIds);
        if (version !== loadVersion.current) return;
        if (missingCoachProfiles.error) throw new Error(missingCoachProfiles.error.message);
        coList = [
          ...coList,
          ...((missingCoachProfiles.data ?? []) as Array<{
            id: string;
            first_name: string | null;
            last_name: string | null;
            avatar_url: string | null;
          }>).map((p) => ({
            id: p.id,
            first_name: p.first_name ?? null,
            last_name: p.last_name ?? null,
            avatar_url: p.avatar_url ?? null,
          })),
        ];
      }
      coList.sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), managerLocaleTag(locale)));
      setCoaches(coList);
      setCoachIdsSelected(selectedCoachIds);

      // selected attendees -> selectedPlayers map
      const selectedIds = snapshot.player_ids;
      // Keep historical members visible, including people no longer active in the club.
      const missingPlayers = selectedIds.filter((id) => !plList.some((p) => p.id === id) && !cmList.some((m) => m.id === id));
      if (missingPlayers.length) {
        const result = await supabase.from("profiles").select("id,first_name,last_name,handicap,avatar_url").in("id", missingPlayers);
        if (version !== loadVersion.current) return;
        if (result.error) throw result.error;
        plList = [...plList, ...(result.data ?? [])];
        setPlayers(plList);
      }

      const defaultSelected: Record<string, ProfileLite> = {};
      plList.forEach((p) => {
        if (selectedIds.includes(p.id)) defaultSelected[p.id] = p;
      });
      setSelectedPlayers(defaultSelected);

      const guestsSelected: Record<string, ClubMemberLite> = {};
      cmList.forEach((m) => {
        if (selectedIds.includes(m.id) && !plList.some((p) => p.id === m.id)) {
          guestsSelected[m.id] = m;
        }
      });
      setSelectedGuests(guestsSelected);

      setStructureItems(snapshot.structure.map((r) => ({ category: r.category, minutes: String(r.minutes), note: r.note ?? "" })));

      setLoading(false);
    } catch (cause) {
      if (version !== loadVersion.current) return;
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "common.errorLoading");
      setGroup(null);
      setClubName("");
      setEvent(null);
      setSeries(null);
      setCoaches([]);
      setPlayers([]);
      setClubMembers([]);
      setCoachIdsSelected([]);
      setSelectedPlayers({});
      setSelectedGuests({});
      setEditSnapshot(null);
      setLoading(false);
    }
  }

  useEffect(() => {
    setEvent(null); setGroup(null); setEditSnapshot(null); setSaveCommitted(false); setDeleteCommitted(false); setBusy(false);
    mutationInFlight.current = false;
    void load();
    return () => { loadVersion.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, eventId]);

  const attendeeIdsSelected = useMemo(
    () => Array.from(new Set([...Object.keys(selectedPlayers), ...Object.keys(selectedGuests)])),
    [selectedPlayers, selectedGuests]
  );

  const canSaveOccurrence = useMemo(() => {
    if (busy || loading || saveCommitted || !editSnapshot) return false;
    if (!event) return false;
    if (!startsAtLocal) return false;
    if (eventType !== "training" && !endsAtLocal) return false;
    return true;
  }, [busy, loading, saveCommitted, editSnapshot, event, startsAtLocal, endsAtLocal, eventType]);

  const canSaveSeries = useMemo(() => {
    if (busy || loading || saveCommitted || !editSnapshot) return false;
    if (!event?.series_id) return false;
    if (!series) return false;
    if (!startDate || !endDate) return false;
    if (endDate < startDate) return false;
    if (!timeOfDay) return false;
    if (intervalWeeks < 1) return false;
    return true;
  }, [busy, loading, saveCommitted, editSnapshot, event?.series_id, series, startDate, endDate, timeOfDay, intervalWeeks]);

  async function saveOccurrenceOnly() {
    if (!event || !editSnapshot || saveCommitted || mutationInFlight.current) return;
    mutationInFlight.current = true;
    const version = loadVersion.current;
    let dataSaved = false;
    setBusy(true);
    setError(null);

    try {
      if ((eventType === "session" || eventType === "event" || eventType === "camp") && !eventTitle.trim()) {
        throw new Error("coach.error.planningTitle");
      }
      const startDt = new Date(startsAtLocal);
      if (Number.isNaN(startDt.getTime())) throw new Error("manager.planning.invalidDate");
      let endDt = new Date(endsAtLocal);
      let computedDuration = Math.max(1, Math.round((endDt.getTime() - startDt.getTime()) / 60000));
      if (eventType === "training") {
        computedDuration = Math.max(30, Number(durationMinutes) || 60);
        endDt = new Date(startDt);
        endDt.setMinutes(endDt.getMinutes() + computedDuration);
      } else {
        if (Number.isNaN(endDt.getTime())) throw new Error("manager.planning.invalidDate");
        if (endDt <= startDt) throw new Error("coach.error.planningDates");
        computedDuration = Math.max(1, Math.round((endDt.getTime() - startDt.getTime()) / 60000));
      }
      const durationForDb = eventType === "training" ? computedDuration : Math.min(computedDuration, MAX_DB_EVENT_DURATION_MINUTES);
      const nextStartIso = startDt.toISOString();
      const nextEndIso = endDt.toISOString();
      const prevType = String(event.event_type ?? "training");
      const nextType = String(eventType);
      const prevTitle = String(event.title ?? "").trim();
      const nextTitle = eventTitle.trim();
      const prevNote = String(event.coach_note ?? "").trim();
      const nextNote = coachNote.trim();
      const prevLocRaw = String(event.location_text ?? "").trim();
      const nextLocRaw = locationText.trim();
      const oldDuration = Math.max(0, Number(event.duration_minutes ?? 0));
      const newDuration = Math.max(0, Number(durationForDb ?? 0));

      const hasPlayerVisibleChange =
        prevType !== nextType ||
        prevTitle !== nextTitle ||
        event.starts_at !== nextStartIso ||
        (event.ends_at ?? null) !== (nextEndIso ?? null) ||
        oldDuration !== newDuration ||
        prevLocRaw !== nextLocRaw ||
        prevNote !== nextNote;

      const eventUpdatePayload = {
        event_type: eventType,
        title: eventTitle.trim() || null,
        starts_at: nextStartIso,
        ends_at: nextEndIso,
        duration_minutes: durationForDb,
        location_text: locationText.trim() || null,
        coach_note: coachNote.trim() || null,
        requires_evaluation: (eventType === "training" || eventType === "camp") && requiresEvaluation,
      };
      const saved = await supabase.rpc("update_manager_event_occurrence_v1", {
        p_event_id: eventId, p_expected: editSnapshot, p_changes: eventUpdatePayload,
        p_coach_ids: coachIdsSelected, p_player_ids: editSnapshot.camp_day ? null : attendeeIdsSelected,
        p_structure: structureItems.map((item) => ({ category: item.category, minutes: Number(item.minutes), note: item.note.trim() || null })),
        p_criterion_ids: eventUpdatePayload.requires_evaluation ? evaluationCriterionIds : [],
      });
      if (saved.error) throw saved.error;
      if (saved.data?.ok !== true) throw new Error("unconfirmed_save");
      dataSaved = true;
      if (version !== loadVersion.current) return;
      setSaveCommitted(true);

      if (hasPlayerVisibleChange && attendeeIdsSelected.length > 0 && meId) {
        const recipientIds: string[] = saved.data.recipient_ids ?? [];
        if (recipientIds.length > 0) {
          const oldStart = new Date(event.starts_at);
          const oldEnd = event.ends_at
            ? new Date(event.ends_at)
            : new Date(new Date(event.starts_at).getTime() + Math.max(0, event.duration_minutes || 0) * 60_000);
          const oldRange = fmtDateTimeRange(oldStart.toISOString(), oldEnd.toISOString(), locale);
          const newRange = fmtDateTimeRange(startDt.toISOString(), endDt.toISOString(), locale);
          const oldLocRaw = prevLocRaw;
          const newLocRaw = nextLocRaw;
          const oldLoc = oldLocRaw || t("manager.content.noLocation");
          const newLoc = newLocRaw || t("manager.content.noLocation");

          const pieces: string[] = [];
          if (prevTitle !== nextTitle) pieces.push(managerEditorFormat(t, "changedName", { before: prevTitle || "—", after: nextTitle || "—" }));
          if (prevType !== nextType || event.starts_at !== nextStartIso || event.ends_at !== nextEndIso) pieces.push(managerEditorFormat(t, "changedTime", { before: oldRange, after: newRange }));
          if (oldDuration !== newDuration) pieces.push(managerEditorFormat(t, "changedDuration", { before: oldDuration, after: newDuration }));
          if (oldLocRaw !== newLocRaw) pieces.push(managerEditorFormat(t, "changedLocation", { before: oldLoc, after: newLoc }));
          if (prevNote !== nextNote) pieces.push(managerEditorFormat(t, "changedNote", { before: prevNote || "—", after: nextNote || "—" }));
          const msg = await getNotificationMessage("notif.coachEventUpdated", locale, { changesSummary: pieces.join(" · ") });
          await createAppNotification({ actorUserId: meId, kind: "coach_event_updated", title: msg.title, body: msg.body,
            data: { event_id: eventId, group_id: groupId, url: `/player/golf/trainings/new?club_event_id=${eventId}` }, recipientUserIds: recipientIds });

        }
      }

      if (version !== loadVersion.current) return;
      setBusy(false);
      router.push(`/manager/groups/${groupId}/planning/${eventId}${seasonQuery}`);
    } catch (e: unknown) {
      if (version !== loadVersion.current) return;
      setError(dataSaved ? "coach.error.planningNotification" : managerEditorSaveError(e));
    } finally {
      if (version === loadVersion.current) { setBusy(false); if (!dataSaved) mutationInFlight.current = false; }
    }
  }

  async function saveFutureSeries() {
    if (!event?.series_id || !series || !group || !editSnapshot || saveCommitted || mutationInFlight.current) return;

    const ok = window.confirm(
      t("coach.form.seriesConfirmHint")
    );
    if (!ok) return;

    mutationInFlight.current = true;
    const version = loadVersion.current;
    let dataSaved = false;
    setBusy(true);
    setError(null);

    try {
      if ((eventType === "session" || eventType === "event" || eventType === "camp") && !eventTitle.trim()) {
        throw new Error("coach.error.planningTitle");
      }
      if (!startDate || !endDate) throw new Error("coach.error.planningRecurrence");
      if (endDate < startDate) throw new Error("coach.error.planningRecurrence");

      const saved = await supabase.rpc("update_manager_event_series_v1", {
        p_event_id: eventId, p_expected: editSnapshot,
        p_series: { event_type: eventType, title: eventTitle.trim() || null, weekday, time_of_day: timeOfDay,
          interval_weeks: intervalWeeks, start_date: startDate, end_date: endDate, duration_minutes: durationMinutes,
          location_text: locationText.trim() || null, coach_note: coachNote.trim() || null, is_active: seriesActive,
          requires_evaluation: (eventType === "training" || eventType === "camp") && requiresEvaluation },
        p_coach_ids: coachIdsSelected, p_player_ids: attendeeIdsSelected,
        p_structure: structureItems.map((item) => ({ category: item.category, minutes: Number(item.minutes), note: item.note.trim() || null })),
        p_criterion_ids: requiresEvaluation ? evaluationCriterionIds : [],
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (saved.error) throw saved.error;
      if (saved.data?.ok !== true) throw new Error("unconfirmed_save");
      dataSaved = true;
      if (version !== loadVersion.current) return;
      setSaveCommitted(true);
      const recipientIds: string[] = saved.data.recipient_ids ?? [];

      if (recipientIds.length > 0 && meId) {
        const seriesTime = timeOfDay.length >= 5 ? timeOfDay.slice(0, 5) : String(timeOfDay);
        const summary = managerFormat(t, "coach.form.updatedSummary", { type: managerActivityLabel(t, eventType), when: `${startDate} → ${endDate} · ${seriesTime}`, minutes: durationMinutes, place: locationText.trim() || t("manager.content.noLocation") });
        const msg = await getNotificationMessage("notif.coachSeriesUpdated", locale, {
          changesSummary: summary,
        });
        await createAppNotification({
          actorUserId: meId,
          kind: "coach_event_updated",
          title: msg.title,
          body: msg.body,
          data: { series_id: event.series_id, group_id: groupId, url: "/player/golf/trainings" },
          recipientUserIds: recipientIds,
        });
      }

      if (version !== loadVersion.current) return;
      setBusy(false);
      router.push(planningHref);
    } catch (e: unknown) {
      if (version !== loadVersion.current) return;
      setError(dataSaved ? "coach.error.planningNotification" : managerEditorSaveError(e));
    } finally {
      if (version === loadVersion.current) { setBusy(false); if (!dataSaved) mutationInFlight.current = false; }
    }
  }

  async function removeEvent(scope: "occurrence" | "series") {
    if (!event || busy || saveCommitted || mutationInFlight.current) return;
    if (scope === "series" && !event.series_id) return;
    if (!window.confirm(t(scope === "series" ? "manager.editor.deleteSeriesConfirm" : "manager.planning.confirmDelete"))) return;
    mutationInFlight.current = true;
    const version = loadVersion.current;
    setBusy(true); setError(null);
    let committed = false;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("manager.home.invalidSession");
      const path = scope === "series" ? `/api/manager/events/series/${encodeURIComponent(event.series_id!)}` : `/api/manager/events/${encodeURIComponent(eventId)}?scope=occurrence`;
      const response = await fetch(path, { method: "DELETE", headers: { Authorization: `Bearer ${data.session.access_token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(result.error === "forbidden" ? "manager.settings.forbidden" : "manager.editor.deleteFailed");
      committed = true;
      if (version !== loadVersion.current) return;
      setSaveCommitted(true); setDeleteCommitted(true);
      if (result.notification_warning) setError("manager.editor.deleteNotification");
      else router.push(planningHref);
    } catch (cause) {
      if (version !== loadVersion.current) return;
      setError(cause instanceof Error && /^(manager|coach)\./.test(cause.message) ? cause.message : "manager.editor.deleteFailed");
    } finally { if (version === loadVersion.current) { setBusy(false); if (!committed) mutationInFlight.current = false; } }
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
        <Link href={`/manager/groups/${groupId}/planning/${eventId}${seasonQuery}`}>{t("coach.activity.other")}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>{t("manager.content.edit")}</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>{t("manager.editor.editTitle")}</h1>
          <p className={styles.lead}>{managerEditorFormat(t, "editLead", { name: group?.name ?? "" })}</p>
        </div>
        <Link className={actionStyles.backButton} href={deleteCommitted ? planningHref : `/manager/groups/${groupId}/planning/${eventId}${seasonQuery}`}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t(deleteCommitted ? "coach.form.backPlanning" : "manager.editor.backActivity")}</Link>
      </div>

      {error && <div className={actionStyles.errorAlert} role="alert">{managerPlanningFeedback(t, error)}</div>}

      {loading ? (
        <section className={styles.quickPanel}><CompactLoadingBlock label={t("manager.content.loading")} /></section>
      ) : !event ? (
        <section className={styles.quickPanel}><div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("manager.planning.eventNotFound")}</div></section>
            ) : (
              <>
                <section className={styles.quickPanel}>
                  <div className={styles.sectionHeading}>
                    <div><h2>{t("manager.editor.information")}</h2><p>{t("manager.editor.informationHelp")}</p></div>
                  </div>
                  {/* Recurrence scope */}
                  {
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("coach.form.recurrence")}</span>
                      <div className="mode-radio-group" role="radiogroup" aria-label={t("coach.form.recurrence")}>
                        <label className={`mode-radio-option ${editScope === "occurrence" ? "is-active" : ""}`}>
                          <input type="radio" name="edit-scope" checked={editScope === "occurrence"} onChange={() => setEditScope("occurrence")} disabled={busy} />
                          <span>{t("coach.form.single")}</span>
                        </label>
                        <label className={`mode-radio-option ${editScope === "series" ? "is-active" : ""}`}>
                          <input type="radio" name="edit-scope" checked={editScope === "series"} onChange={() => setEditScope("series")} disabled={busy || !series} />
                          <span><Repeat size={16} />{t("coach.form.recurring")}</span>
                        </label>
                      </div>
                      {event.series_id ? <p style={{ margin: 0, color: "#778278", fontSize: 12, lineHeight: 1.45 }}>{t("manager.editor.futureHint")}</p> : null}
                    </label>
                  }

                  {event.series_id ? <div className="hr-soft" /> : null}

                  {/* OCCURRENCE */}
                  {editScope === "occurrence" ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("coach.form.eventType")}</span>
                        <select value={eventType} onChange={(e) => setEventType(e.target.value as typeof eventType)} disabled={busy}>
                          {EVENT_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {managerActivityLabel(t, opt.value)}
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
                          <input type="date" value={occDate} onChange={(e) => updateOccDate(e.target.value)} disabled={busy} />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>{t("coach.form.startTime")}</span>
                          <select value={occTime} onChange={(e) => updateOccTime(e.target.value)} disabled={busy}>
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
                                {m} {t("common.min")}</option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <div className="grid-2">
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("coach.form.endDate")}</span>
                            <input type="date" value={occEndDate} onChange={(e) => updateOccEndDate(e.target.value)} disabled={busy} />
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("coach.form.endTime")}</span>
                            <select value={occEndTime} onChange={(e) => updateOccEndTime(e.target.value)} disabled={busy}>
                              {QUARTER_HOUR_OPTIONS.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("coach.form.location")}</span>
                        <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} />
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
                          <input
                            type="checkbox"
                            checked={requiresEvaluation}
                            onChange={(e) => setRequiresEvaluation(e.target.checked)}
                            disabled={busy}
                          />
                          <span><b>{t("manager.editor.evaluation")}</b></span>
                        </label>
                      ) : null}
                      {(eventType === "training" || eventType === "camp") && requiresEvaluation && group ? (
                        <EventCriteriaSelector clubId={group.club_id} eventType={eventType} selectedIds={evaluationCriterionIds} onChange={setEvaluationCriterionIds} disabled={busy} />
                      ) : null}
                    </div>
                  ) : null}

                  {/* SERIES */}
                  {editScope === "series" ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      {!series ? (
                        <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                          {t("coach.form.seriesMissing")}</div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("coach.form.eventType")}</span>
                            <select value={eventType} onChange={(e) => setEventType(e.target.value as typeof eventType)} disabled={busy}>
                              {EVENT_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {managerActivityLabel(t, opt.value)}
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
                              <span style={fieldLabelStyle}>{t("common.time")}</span>
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
                              <span style={fieldLabelStyle}>{t("manager.performance.from")}</span>
                              <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                disabled={busy}
                              />
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("manager.performance.to")}</span>
                              <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                disabled={busy}
                              />
                            </label>
                          </div>

                          <div className="grid-2">
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("coach.form.duration")}</span>
                              <select
                                value={durationMinutes}
                                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                                disabled={busy}
                              >
                                {DURATION_OPTIONS.map((m) => (
                                  <option key={m} value={m}>
                                    {m} {t("common.min")}</option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("coach.form.frequency")}</span>
                              <select
                                value={intervalWeeks}
                                onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                                disabled={busy}
                              >
                                {[1, 2, 3, 4].map((w) => (
                                  <option key={w} value={w}>
                                    {w === 1 ? t("coach.form.everyWeek") : managerFormat(t, "coach.form.everyWeeks", { count: w })}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>{t("coach.form.location")}</span>
                            <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} />
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
                              <input
                                type="checkbox"
                                checked={requiresEvaluation}
                                onChange={(e) => setRequiresEvaluation(e.target.checked)}
                                disabled={busy}
                              />
                              <span><b>{t("manager.editor.evaluation")}</b></span>
                            </label>
                          ) : null}
                          {(eventType === "training" || eventType === "camp") && requiresEvaluation && group ? (
                            <EventCriteriaSelector clubId={group.club_id} eventType={eventType} selectedIds={evaluationCriterionIds} onChange={setEvaluationCriterionIds} disabled={busy} />
                          ) : null}

                          <label className="user-mgmt-checkbox-label">
                            <input
                              type="checkbox"
                              checked={seriesActive}
                              onChange={(e) => setSeriesActive(e.target.checked)}
                              disabled={busy}
                            />
                            <span><b>{t("coach.form.seriesActive")}</b></span>
                          </label>

                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                            {t("coach.form.futureHint")}</div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>

                {eventType === "training" ? (
                <section className={styles.quickPanel}>
                  <div className={styles.sectionHeading}><div><h2>{t("manager.editor.structure")}</h2><p>{t("manager.editor.structureHelp")}</p></div></div>

                  {structureItems.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {t("coach.form.emptyStructure")}</div>
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
                                      {m} {t("common.min")}</option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{t("coach.form.note")}</span>
                              <input value={it.note} onChange={(e) => updateStructureLine(idx, { note: e.target.value })} disabled={busy} />
                            </label>

                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <button type="button" className="btn btn-danger soft" onClick={() => removeStructureLine(idx)} disabled={busy}>
                                {t("manager.content.delete")}</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={addStructureLine} disabled={busy}>
                      {t("coach.form.addStation")}</button>
                  </div>
                </section>
                ) : null}

                {/* Coachs attendus */}
                <section className={styles.quickPanel}>
                  <div className={styles.sectionHeading}><div><h2>{t("coach.form.coaches")}</h2><p>{t("manager.editor.coachesHelp")}</p></div></div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || coaches.length === 0 || allCoachesSelected}
                      onClick={() => setCoachIdsSelected(coaches.map((c) => c.id))}
                    >
                      {t("coach.form.selectAll")}</button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || coaches.length === 0 || coachIdsSelected.length === 0}
                      onClick={() => setCoachIdsSelected([])}
                    >
                      {t("coach.form.deselectAll")}</button>
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
                          <tbody>
                        {selectedCoachesList.map((c) => (
                          <tr key={c.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(c)}</span></td><td><b>{fullName(c)}</b></td><td><button type="button" className="btn" onClick={() => setCoachIdsSelected((prev) => prev.filter((id) => id !== c.id))} disabled={busy} aria-label={managerFormat(t, "coach.form.removeNamed", { name: fullName(c) })} title={t("coach.group.remove")} style={compactGreenButtonStyle}><Trash2 size={16} /></button></td></tr>
                        ))}
                          </tbody>
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
                          <tbody>
                        {candidateCoaches.map((c) => (
                          <tr key={c.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(c)}</span></td><td><b>{fullName(c)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => setCoachIdsSelected((prev) => [...prev, c.id])} disabled={busy} aria-label={managerFormat(t, "coach.form.addNamed", { name: fullName(c) })} title={t("common.add")} style={{ width: 42, padding: 0 }}><PlusCircle size={16} /></button></td></tr>
                        ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                </section>

                {/* Joueurs attendus */}
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
                      {t("coach.form.selectAll")}</button>

                    <button
                      type="button"
                      className="btn"
                      disabled={busy || players.length === 0 || Object.keys(selectedPlayers).length === 0}
                      onClick={() => setSelectedPlayers({})}
                    >
                      {t("coach.form.deselectAll")}</button>
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
                      placeholder={t("coach.form.searchPlayers")}
                      style={{ paddingLeft: 44 }}
                    />
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="pill-soft">{t("coach.form.selection")} ({selectedPlayersList.length})</div>

                    {players.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noPlayers")}</div>
                    ) : selectedPlayersList.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noSelectedPlayers")}</div>
                    ) : (
                      <div className="user-mgmt-table-wrap">
                        <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                          <thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("coach.directory.actions")} /></tr></thead>
                          <tbody>
                        {selectedPlayersList.map((p) => (
                          <tr key={p.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(p)}</span></td><td><b>{fullName(p)}</b></td><td><button type="button" className="btn" onClick={() => toggleSelectedPlayer(p)} disabled={busy} aria-label={managerFormat(t, "coach.form.removeNamed", { name: fullName(p) })} title={t("coach.group.remove")} style={compactGreenButtonStyle}><Trash2 size={16} /></button></td></tr>
                        ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="pill-soft">{t("common.add")} ({candidatesPlayers.length})</div>

                    {players.length > 0 && candidatesPlayers.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noResults")}</div>
                    ) : candidatesPlayers.length > 0 ? (
                      <div className="user-mgmt-table-wrap">
                        <table className="user-mgmt-table user-mgmt-table--compact user-mgmt-table--member-list user-mgmt-table--group-selection">
                          <thead><tr><th aria-label={t("manager.performance.avatar")} /><th>{t("manager.administration.fullName")}</th><th aria-label={t("coach.directory.actions")} /></tr></thead>
                          <tbody>
                        {candidatesPlayers.map((p) => (
                          <tr key={p.id}><td><span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(p)}</span></td><td><b>{fullName(p)}</b></td><td><button type="button" className={actionStyles.secondaryButton} onClick={() => toggleSelectedPlayer(p)} disabled={busy} aria-label={managerFormat(t, "coach.form.addNamed", { name: fullName(p) })} title={t("common.add")} style={{ width: 42, padding: 0 }}><PlusCircle size={16} /></button></td></tr>
                        ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                </section>

                {/* Invités */}
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
                              className="btn btn-danger soft"
                              onClick={() => toggleSelectedGuest(m)}
                              disabled={busy}
                              style={{ padding: "10px 12px" }}
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
                      {t("coach.form.guestsHint")}</div>
                  )}
                </section>

                <div className="user-mgmt-card-actions" style={{ paddingBottom: 8 }}>
                  {editScope === "occurrence" ? (
                    <button type="button" className={actionStyles.primaryButton} disabled={!canSaveOccurrence} onClick={saveOccurrenceOnly}>
                      {busy ? t("coachDebrief.saving") : t("coach.editor.saveOccurrence")}
                    </button>
                  ) : (
                    <button type="button" className={actionStyles.primaryButton} disabled={!canSaveSeries} onClick={saveFutureSeries}>
                      {busy ? t("coachDebrief.saving") : t("coach.editor.saveSeries")}
                    </button>
                  )}
                </div>

                <section className={actionStyles.dangerZone}>
                  <div>
                    <div className={actionStyles.dangerIcon}><Trash2 size={18} aria-hidden="true" /></div>
                    <div><h2>{t("manager.editor.deleteTitle")}</h2><p>{t("manager.editor.deleteWarning")}</p></div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className={actionStyles.dangerButton} disabled={busy || saveCommitted} onClick={() => removeEvent("occurrence")}>
                      {t("coach.form.deleteOccurrence")}</button>
                    {event.series_id ? <button type="button" className={actionStyles.dangerButton} disabled={busy || saveCommitted} onClick={() => removeEvent("series")}>{t("coach.form.deleteSeries")}</button> : null}
                  </div>
                </section>
              </>
            )}
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
