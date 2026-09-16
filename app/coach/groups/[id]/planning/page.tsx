"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import ManagerStatisticsTabs from "@/components/manager/ManagerStatisticsTabs";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import {
  ArrowLeft,
  PlusCircle,
  Trash2,
  Pencil,
  AlertTriangle,
  MapPin,
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

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  coach_note: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
  requires_evaluation: boolean;
};
type EventCoachRow = {
  event_id: string;
  coach_id: string;
};
type EventAttendeeRow = {
  event_id: string;
  player_id: string;
  status: "expected" | "present" | "absent" | "excused" | null;
};
type EventCoachFeedbackLite = {
  event_id: string;
  player_id: string;
};
type TrainingItemDraft = {
  category: string;
  minutes: string;
  note: string;
};

type SeriesInsert = {
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  title: string | null;
  location_text: string | null;
  coach_note: string | null;
  duration_minutes: number;
  weekday: number;
  time_of_day: string; // "HH:mm:ss" or "HH:mm"
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

function memberRoleLabel(role: string | null | undefined) {
  switch (role) {
    case "owner":
      return "Propriétaire";
    case "admin":
      return "Admin";
    case "manager":
      return "Manager";
    case "coach":
      return "Coach";
    case "player":
      return "Joueur";
    case "parent":
      return "Parent";
    case "captain":
      return "Capitaine";
    case "staff":
      return "Staff";
    default:
      return "Membre";
  }
}

function eventDateSummary(startIso: string, endIso: string | null) {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const time = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });
  const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  return {
    day: capitalize(new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(start)),
    date: start.getDate(),
    month: capitalize(new Intl.DateTimeFormat("fr-CH", { month: "long" }).format(start)),
    startTime: time.format(start),
    endTime: end ? time.format(end) : null,
  };
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
  for (let m = 30; m <= 240; m += 15) out.push(m);
  return out;
}
const DURATION_OPTIONS = buildDurationOptions();
const MAX_DB_EVENT_DURATION_MINUTES = 240;
const TRAINING_CATEGORY_VALUES = [
  "warmup_mobility",
  "long_game",
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
const TRAINING_CATEGORY_LABELS: Record<string, string> = {
  warmup_mobility: "Échauffement / mobilité",
  long_game: "Long jeu",
  putting: "Putting",
  wedging: "Wedging",
  pitching: "Pitching",
  chipping: "Chipping",
  bunker: "Bunker",
  course: "Parcours",
  mental: "Mental",
  fitness: "Fitness",
  other: "Autre",
};
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

function startOfDayISO(ymd: string) {
  // ymd = YYYY-MM-DD (local) => ISO at local midnight
  const d = new Date(`${ymd}T00:00:00`);
  return d.toISOString();
}

function nextDayStartISO(ymd: string) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
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

type FilterMode = "all" | "upcoming" | "past" | "range";
type EventTypeFilter = "all" | "training" | "interclub" | "camp" | "session" | "event";
type FilterCounts = { all: number; upcoming: number; past: number; range: number };
type PlanningFilterTab = "all" | "upcoming" | "past" | "pending";

export default function CoachGroupPlanningPage() {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const params = useParams<{ id: string }>();
  const groupId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");
  const [canPlan, setCanPlan] = useState(false);

  const [group, setGroup] = useState<GroupRow | null>(null);

  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [players, setPlayers] = useState<ProfileLite[]>([]);
  const [clubMembers, setClubMembers] = useState<ClubMemberLite[]>([]);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventCoachIds, setEventCoachIds] = useState<Record<string, string[]>>({});
  const [eventAttendeeIds, setEventAttendeeIds] = useState<Record<string, string[]>>({});
  const [eventPresentPlayerIds, setEventPresentPlayerIds] = useState<Record<string, string[]>>({});
  const [eventAbsentPlayerIds, setEventAbsentPlayerIds] = useState<Record<string, string[]>>({});
  const [eventEvaluatedPlayerIds, setEventEvaluatedPlayerIds] = useState<Record<string, string[]>>({});
  const [pendingEvaluationCount, setPendingEvaluationCount] = useState(0);
  const [coachEditBusy, setCoachEditBusy] = useState<Record<string, boolean>>({});

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
  const [locationText, setLocationText] = useState<string>("");
  const [coachNote, setCoachNote] = useState<string>("");
  const [structureItems, setStructureItems] = useState<TrainingItemDraft[]>([]);

  // series
  const [weekday, setWeekday] = useState<number>(2); // mardi défaut
  const [timeOfDay, setTimeOfDay] = useState<string>("18:00");
  const [intervalWeeks, setIntervalWeeks] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>(() => ymdToday());
  const [endDate, setEndDate] = useState<string>(() => toYMD(addDays(new Date(), 60)));

  // ✅ NEW — filter
  const [filterMode, setFilterMode] = useState<FilterMode>("upcoming");
  const [eventTypeFilter, setEventTypeFilter] = useState<EventTypeFilter>("all");
  const [rangeFrom, setRangeFrom] = useState<string>(() => toYMD(addDays(new Date(), -30)));
  const [rangeTo, setRangeTo] = useState<string>(() => toYMD(addDays(new Date(), 30)));
  const [filterCounts, setFilterCounts] = useState<FilterCounts>({ all: 0, upcoming: 0, past: 0, range: 0 });
  const [pendingEvaluationsOnly, setPendingEvaluationsOnly] = useState(false);

  const eventTypeLabelLocalized = (v: string | null | undefined) => {
    if (v === "training") return tr("Entraînement", "Training");
    if (v === "interclub") return tr("Interclub", "Interclub");
    if (v === "camp") return tr("Stage/Camp", "Camp");
    if (v === "session") return tr("Séance", "Session");
    return tr("Événement", "Event");
  };

  const selectedPlayersList = useMemo(
    () => Object.values(selectedPlayers).sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")),
    [selectedPlayers]
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
    () => Object.values(selectedGuests).sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")),
    [selectedGuests]
  );

  const candidateGuests = useMemo(() => {
    const q = queryGuests.trim().toLowerCase();
    if (!q) return [] as ClubMemberLite[];
    const base = clubMembers.filter((m) => !guestBlockedIds.has(m.id) && !selectedGuests[m.id]);
    return base
      .filter((m) => {
        const n = fullName(m).toLowerCase();
        const role = memberRoleLabel(m.role).toLowerCase();
        return n.includes(q) || role.includes(q);
      })
      .slice(0, 30);
  }, [queryGuests, clubMembers, guestBlockedIds, selectedGuests]);

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
        .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")),
    [coaches, coachIdsSelected]
  );

  const candidateCoaches = useMemo(
    () =>
      coaches
        .filter((c) => !coachIdsSelected.includes(c.id))
        .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr")),
    [coaches, coachIdsSelected]
  );

  const allCoachesSelected = useMemo(() => {
    const total = coaches.length;
    const selectedCount = coachIdsSelected.length;
    return total > 0 && selectedCount === total;
  }, [coaches.length, coachIdsSelected.length]);

  const playerIdSet = useMemo(() => new Set(players.map((p) => p.id)), [players]);
  const personById = useMemo(() => {
    const map = new Map<string, ProfileLite | CoachLite | ClubMemberLite>();
    players.forEach((p) => map.set(p.id, p));
    coaches.forEach((c) => map.set(c.id, c));
    clubMembers.forEach((m) => {
      if (!map.has(m.id)) map.set(m.id, m);
    });
    return map;
  }, [players, coaches, clubMembers]);

  const eventNeedsEvaluation = (e: EventRow) => {
    const presentPlayerIds = Array.from(new Set(eventPresentPlayerIds[e.id] ?? []));
    const evaluatedPlayerIds = new Set(eventEvaluatedPlayerIds[e.id] ?? []);
    const nowTs = Date.now();
    const endTs = e.ends_at ? new Date(e.ends_at).getTime() : new Date(e.starts_at).getTime();
    const isPastOccurrence = endTs < nowTs;
    const requiresEvaluationCheck = e.requires_evaluation;
    if (!isPastOccurrence || !requiresEvaluationCheck) return false;
    const missingEvalCount = presentPlayerIds.filter((pid) => !evaluatedPlayerIds.has(pid)).length;
    return missingEvalCount > 0;
  };

  const listedEvents = useMemo(
    () => (pendingEvaluationsOnly ? events.filter((e) => eventNeedsEvaluation(e)) : events),
    [events, pendingEvaluationsOnly, eventPresentPlayerIds, eventEvaluatedPlayerIds]
  );
  function toggleInList(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
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

  async function saveStructureForEvents(eventIds: string[]) {
    const payload = structureItems
      .map((it, idx) => {
        const minutes = Number(it.minutes);
        if (!it.category || !Number.isFinite(minutes) || minutes <= 0) return null;
        return {
          category: it.category,
          minutes,
          note: it.note?.trim() || null,
          position: idx,
        };
      })
      .filter((x): x is { category: string; minutes: number; note: string | null; position: number } => Boolean(x));

    if (payload.length === 0 || eventIds.length === 0) return;

    const rows = eventIds.flatMap((eventId) =>
      payload.map((it) => ({
        event_id: eventId,
        category: it.category,
        minutes: it.minutes,
        note: it.note,
        position: it.position,
      }))
    );

    const ins = await supabase.from("club_event_structure_items").insert(rows);
    if (ins.error) throw new Error(ins.error.message);
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
    setLoading(true);
    setError(null);

    try {
      if (!groupId) throw new Error("Groupe manquant.");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (uErr || !uRes.user) throw new Error("Session invalide.");
      setMeId(uRes.user.id);

      // group
      const gRes = await supabase.from("coach_groups").select("id,name,club_id").eq("id", groupId).maybeSingle();
      if (gRes.error) throw new Error(gRes.error.message);
      if (!gRes.data) throw new Error("Groupe introuvable.");
      setGroup(gRes.data as GroupRow);

      // all active club members (for guests visibility)
      const cmRes = await supabase
        .from("club_members")
        .select("user_id, role, can_manage_assigned_group_planning")
        .eq("club_id", gRes.data.club_id)
        .eq("is_active", true);
      if (cmRes.error) throw new Error(cmRes.error.message);
      const cmRows = (cmRes.data ?? []) as Array<{ user_id: string; role: string | null; can_manage_assigned_group_planning?: boolean | null }>;
      const currentMembership = cmRows.find((row) => row.user_id === uRes.user.id);
      setCanPlan(currentMembership?.role === "manager" || Boolean(currentMembership?.can_manage_assigned_group_planning));
      const memberIds = Array.from(new Set(cmRows.map((r) => r.user_id).filter(Boolean)));

      const profilesById = new Map<string, { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }>();
      if (memberIds.length > 0) {
        const profRes = await supabase
          .from("profiles")
          .select("id, first_name, last_name, avatar_url")
          .in("id", memberIds);
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
      cmList.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
      setClubMembers(cmList);

      // coaches in group
      const coRes = await supabase
        .from("coach_group_coaches")
        .select("coach_user_id, profiles:coach_user_id ( id, first_name, last_name, avatar_url )")
        .eq("group_id", groupId);

      if (coRes.error) throw new Error(coRes.error.message);
      const coList: CoachLite[] = (coRes.data ?? []).map((r: any) => ({
        id: r.coach_user_id,
        first_name: r.profiles?.first_name ?? null,
        last_name: r.profiles?.last_name ?? null,
        avatar_url: r.profiles?.avatar_url ?? null,
      }));
      setCoaches(coList);

      // players in group
      const plRes = await supabase
        .from("coach_group_players")
        .select("player_user_id, profiles:player_user_id ( id, first_name, last_name, handicap, avatar_url )")
        .eq("group_id", groupId);

      if (plRes.error) throw new Error(plRes.error.message);
      const plList: ProfileLite[] = (plRes.data ?? []).map((r: any) => ({
        id: r.profiles?.id ?? r.player_user_id,
        first_name: r.profiles?.first_name ?? null,
        last_name: r.profiles?.last_name ?? null,
        handicap: r.profiles?.handicap ?? null,
        avatar_url: r.profiles?.avatar_url ?? null,
      }));
      plList.sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
      setPlayers(plList);

      // defaults selections
      setCoachIdsSelected(coList.map((c) => c.id));

      // default: all players selected
      const defaultSelected: Record<string, ProfileLite> = {};
      plList.forEach((p) => (defaultSelected[p.id] = p));
      setSelectedPlayers(defaultSelected);

      // ✅ events filtered
      let isoFrom: string | null = null;
      let isoTo: string | null = null;

      if (filterMode === "upcoming") {
        const from = new Date();
        isoFrom = from.toISOString();
      } else if (filterMode === "past") {
        const to = new Date(); // now
        isoTo = to.toISOString();
      } else if (filterMode === "range") {
        // range
        if (rangeFrom) isoFrom = startOfDayISO(rangeFrom);
        if (rangeTo) isoTo = nextDayStartISO(rangeTo); // inclusive end date
      }

      let q = supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status,requires_evaluation")
        .eq("group_id", groupId)
        .order("starts_at", { ascending: true });

      if (isoFrom) q = q.gte("starts_at", isoFrom);
      if (isoTo) q = q.lt("starts_at", isoTo);
      if (eventTypeFilter !== "all") q = q.eq("event_type", eventTypeFilter);

      const eRes = await q;
      if (eRes.error) throw new Error(eRes.error.message);
      const eList = (eRes.data ?? []) as EventRow[];
      setEvents(eList);

      const nowIso = new Date().toISOString();
      const withType = (qq: any) => (eventTypeFilter !== "all" ? qq.eq("event_type", eventTypeFilter) : qq);

      const allCountQ = withType(
        supabase.from("club_events").select("id", { count: "exact", head: true }).eq("group_id", groupId)
      );
      const upCountQ = withType(
        supabase.from("club_events").select("id", { count: "exact", head: true }).eq("group_id", groupId).gte("starts_at", nowIso)
      );
      const pastCountQ = withType(
        supabase.from("club_events").select("id", { count: "exact", head: true }).eq("group_id", groupId).lt("starts_at", nowIso)
      );
      let rangeCountQ = withType(
        supabase.from("club_events").select("id", { count: "exact", head: true }).eq("group_id", groupId)
      );
      if (rangeFrom) rangeCountQ = rangeCountQ.gte("starts_at", startOfDayISO(rangeFrom));
      if (rangeTo) rangeCountQ = rangeCountQ.lt("starts_at", nextDayStartISO(rangeTo));

      const [allCountRes, upCountRes, pastCountRes, rangeCountRes] = await Promise.all([allCountQ, upCountQ, pastCountQ, rangeCountQ]);
      if (allCountRes.error) throw new Error(allCountRes.error.message);
      if (upCountRes.error) throw new Error(upCountRes.error.message);
      if (pastCountRes.error) throw new Error(pastCountRes.error.message);
      if (rangeCountRes.error) throw new Error(rangeCountRes.error.message);
      setFilterCounts({
        all: allCountRes.count ?? 0,
        upcoming: upCountRes.count ?? 0,
        past: pastCountRes.count ?? 0,
        range: rangeCountRes.count ?? 0,
      });

      // Count past events requiring evaluation (independent from current visible filter)
      const pastEvalEventsRes = await supabase
        .from("club_events")
        .select("id,event_type,starts_at,ends_at,requires_evaluation")
        .eq("group_id", groupId)
        .eq("requires_evaluation", true);
      if (pastEvalEventsRes.error) throw new Error(pastEvalEventsRes.error.message);

      const nowTs = Date.now();
      const pastEvalEvents = ((pastEvalEventsRes.data ?? []) as Array<{
        id: string;
        event_type: "training" | "interclub" | "camp" | "session" | "event";
        starts_at: string;
        ends_at: string | null;
        requires_evaluation: boolean;
      }>).filter((ev) => {
        const endTs = ev.ends_at ? new Date(ev.ends_at).getTime() : new Date(ev.starts_at).getTime();
        return endTs < nowTs;
      });

      const pastEvalEventIds = pastEvalEvents.map((ev) => ev.id);
      if (pastEvalEventIds.length === 0) {
        setPendingEvaluationCount(0);
      } else {
        const [pastAttendeesRes, pastFeedbackRes] = await Promise.all([
          supabase
            .from("club_event_attendees")
            .select("event_id,player_id,status")
            .in("event_id", pastEvalEventIds),
          supabase
            .from("club_event_coach_feedback")
            .select("event_id,player_id")
            .eq("coach_id", uRes.user.id)
            .in("event_id", pastEvalEventIds),
        ]);

        if (pastAttendeesRes.error) throw new Error(pastAttendeesRes.error.message);
        if (pastFeedbackRes.error) throw new Error(pastFeedbackRes.error.message);

        const presentByEvent: Record<string, Set<string>> = {};
        ((pastAttendeesRes.data ?? []) as EventAttendeeRow[]).forEach((r) => {
          if (r.status !== "present") return;
          if (!presentByEvent[r.event_id]) presentByEvent[r.event_id] = new Set<string>();
          presentByEvent[r.event_id].add(r.player_id);
        });

        const evaluatedByEvent: Record<string, Set<string>> = {};
        ((pastFeedbackRes.data ?? []) as EventCoachFeedbackLite[]).forEach((r) => {
          if (!evaluatedByEvent[r.event_id]) evaluatedByEvent[r.event_id] = new Set<string>();
          evaluatedByEvent[r.event_id].add(r.player_id);
        });

        const pendingCount = pastEvalEventIds.reduce((acc, eventId) => {
          const presentSet = presentByEvent[eventId] ?? new Set<string>();
          if (presentSet.size === 0) return acc;
          const evaluatedSet = evaluatedByEvent[eventId] ?? new Set<string>();
          for (const pid of presentSet) {
            if (!evaluatedSet.has(pid)) return acc + 1;
          }
          return acc;
        }, 0);
        setPendingEvaluationCount(pendingCount);
      }

      const eventIds = eList.map((e) => e.id);
      if (eventIds.length > 0) {
        const ecRes = await supabase
          .from("club_event_coaches")
          .select("event_id,coach_id")
          .in("event_id", eventIds);
        if (ecRes.error) throw new Error(ecRes.error.message);
        const byEvent: Record<string, string[]> = {};
        ((ecRes.data ?? []) as EventCoachRow[]).forEach((r) => {
          if (!byEvent[r.event_id]) byEvent[r.event_id] = [];
          byEvent[r.event_id].push(r.coach_id);
        });
        setEventCoachIds(byEvent);

        const eaRes = await supabase
          .from("club_event_attendees")
          .select("event_id,player_id,status")
          .in("event_id", eventIds);
        if (eaRes.error) throw new Error(eaRes.error.message);
        const attendeesByEvent: Record<string, string[]> = {};
        const presentByEvent: Record<string, string[]> = {};
        const absentByEvent: Record<string, string[]> = {};
        ((eaRes.data ?? []) as EventAttendeeRow[]).forEach((r) => {
          if (!attendeesByEvent[r.event_id]) attendeesByEvent[r.event_id] = [];
          attendeesByEvent[r.event_id].push(r.player_id);
          if (r.status === "present") {
            if (!presentByEvent[r.event_id]) presentByEvent[r.event_id] = [];
            presentByEvent[r.event_id].push(r.player_id);
          } else if (r.status === "absent" || r.status === "excused") {
            if (!absentByEvent[r.event_id]) absentByEvent[r.event_id] = [];
            absentByEvent[r.event_id].push(r.player_id);
          }
        });
        setEventAttendeeIds(attendeesByEvent);
        setEventPresentPlayerIds(presentByEvent);
        setEventAbsentPlayerIds(absentByEvent);

        const cfRes = await supabase
          .from("club_event_coach_feedback")
          .select("event_id,player_id")
          .in("event_id", eventIds)
          .eq("coach_id", uRes.user.id);
        if (cfRes.error) throw new Error(cfRes.error.message);
        const evaluatedByEvent: Record<string, string[]> = {};
        ((cfRes.data ?? []) as EventCoachFeedbackLite[]).forEach((r) => {
          if (!evaluatedByEvent[r.event_id]) evaluatedByEvent[r.event_id] = [];
          evaluatedByEvent[r.event_id].push(r.player_id);
        });
        setEventEvaluatedPlayerIds(evaluatedByEvent);
      } else {
        setEventCoachIds({});
        setEventAttendeeIds({});
        setEventPresentPlayerIds({});
        setEventAbsentPlayerIds({});
        setEventEvaluatedPlayerIds({});
      }

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setGroup(null);
      setCoaches([]);
      setPlayers([]);
      setClubMembers([]);
      setEvents([]);
      setEventCoachIds({});
      setEventAttendeeIds({});
      setEventPresentPlayerIds({});
      setEventAbsentPlayerIds({});
      setEventEvaluatedPlayerIds({});
      setPendingEvaluationCount(0);
      setFilterCounts({ all: 0, upcoming: 0, past: 0, range: 0 });
      setSelectedPlayers({});
      setCoachIdsSelected([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, filterMode, eventTypeFilter, rangeFrom, rangeTo]);

  async function createSingleEvent() {
    if (!group || busy) return;
    setBusy(true);
    setError(null);

    try {
      const startDt = new Date(startsAtLocal);
      if (Number.isNaN(startDt.getTime())) throw new Error("Date/heure invalide.");
      let endDt = new Date(endsAtLocal);
      let computedDuration = Math.max(1, Math.round((endDt.getTime() - startDt.getTime()) / 60000));

      if (eventType === "training") {
        computedDuration = Math.max(30, Number(durationMinutes) || 60);
        endDt = new Date(startDt);
        endDt.setMinutes(endDt.getMinutes() + computedDuration);
      } else {
        if (Number.isNaN(endDt.getTime())) throw new Error("Date/heure invalide.");
        if (endDt <= startDt) throw new Error("La fin doit être après le début.");
        computedDuration = Math.max(1, Math.round((endDt.getTime() - startDt.getTime()) / 60000));
      }
      const durationForDb = eventType === "training" ? computedDuration : Math.min(computedDuration, MAX_DB_EVENT_DURATION_MINUTES);

      const { data: insData, error: insErr } = await supabase
        .from("club_events")
        .insert({
          group_id: group.id,
          club_id: group.club_id,
          event_type: eventType,
          starts_at: startDt.toISOString(),
          ends_at: endDt.toISOString(),
          duration_minutes: durationForDb,
          location_text: locationText.trim() || null,
          coach_note: coachNote.trim() || null,
          created_by: meId,
        })
        .select("id")
        .single();

      if (insErr) throw new Error(insErr.message);
      const eventId = insData.id as string;

      // coaches link
      if (coachIdsSelected.length > 0) {
        const rows = coachIdsSelected.map((cid) => ({ event_id: eventId, coach_id: cid }));
        const cIns = await supabase.from("club_event_coaches").insert(rows);
        if (cIns.error) throw new Error(cIns.error.message);
      }

      // attendees
      const attendeeIds = Array.from(new Set([...Object.keys(selectedPlayers), ...Object.keys(selectedGuests)]));
      if (attendeeIds.length > 0) {
        const rows = attendeeIds.map((pid) => ({ event_id: eventId, player_id: pid, status: "present" }));
        const aIns = await supabase.from("club_event_attendees").insert(rows);
        if (aIns.error) throw new Error(aIns.error.message);
      }

      await saveStructureForEvents([eventId]);

      await load();
      setBusy(false);
    } catch (e: any) {
      setError(e?.message ?? "Creation error.");
      setBusy(false);
    }
  }

  function weekdayFromDate(d: Date) {
    return d.getDay(); // 0=Sun..6=Sat
  }

  function nextWeekdayOnOrAfter(start: Date, targetWeekday: number) {
    const d = new Date(start);
    const w = weekdayFromDate(d);
    const diff = (targetWeekday - w + 7) % 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function combineDateAndTime(localYMD: string, hhmm: string) {
    const t = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
    return new Date(`${localYMD}T${t}`);
  }

  async function createSeries() {
    if (!group || busy) return;
    setBusy(true);
    setError(null);

    try {
      if (!startDate || !endDate) throw new Error(tr("Dates de récurrence manquantes.", "Missing recurrence dates."));
      if (endDate < startDate) throw new Error(tr("La date de fin doit être après la date de début.", "End date must be after start date."));

      const seriesPayload: SeriesInsert = {
        group_id: group.id,
        club_id: group.club_id,
        event_type: eventType,
        title: null,
        location_text: locationText.trim() || null,
        coach_note: coachNote.trim() || null,
        duration_minutes: durationMinutes,
        weekday,
        time_of_day: timeOfDay.length === 5 ? `${timeOfDay}:00` : timeOfDay,
        interval_weeks: intervalWeeks,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        created_by: meId,
      };

      const sIns = await supabase.from("club_event_series").insert(seriesPayload).select("id").single();
      if (sIns.error) throw new Error(sIns.error.message);
      const seriesId = sIns.data.id as string;

      // generate occurrences (cap 80)
      const startLocal = new Date(`${startDate}T00:00:00`);
      const endLocal = new Date(`${endDate}T23:59:59`);

      let cursor = nextWeekdayOnOrAfter(startLocal, weekday);
      let count = 0;

      const occurrences: any[] = [];
      while (cursor <= endLocal) {
        const dt = combineDateAndTime(toYMD(cursor), timeOfDay);
        const endDt = new Date(dt);
        endDt.setMinutes(endDt.getMinutes() + durationMinutes);
        occurrences.push({
          group_id: group.id,
          club_id: group.club_id,
          event_type: eventType,
          starts_at: dt.toISOString(),
          ends_at: endDt.toISOString(),
          duration_minutes: durationMinutes,
          location_text: locationText.trim() || null,
          coach_note: coachNote.trim() || null,
          series_id: seriesId,
          created_by: meId,
        });

        count += 1;
        if (count >= 80) break;
        cursor = addDays(cursor, intervalWeeks * 7);
      }

      if (occurrences.length === 0) throw new Error(tr("Aucune occurrence générée (vérifie jour/heure).", "No occurrence generated (check day/time)."));

      const eIns = await supabase.from("club_events").insert(occurrences).select("id");
      if (eIns.error) throw new Error(eIns.error.message);

      const createdEventIds = (eIns.data ?? []).map((r: any) => r.id as string);

      // link coaches
      if (coachIdsSelected.length > 0 && createdEventIds.length > 0) {
        const coachRows = createdEventIds.flatMap((eid) => coachIdsSelected.map((cid) => ({ event_id: eid, coach_id: cid })));
        const cIns = await supabase.from("club_event_coaches").insert(coachRows);
        if (cIns.error) throw new Error(cIns.error.message);
      }

      // attendees
      const attendeeIds = Array.from(new Set([...Object.keys(selectedPlayers), ...Object.keys(selectedGuests)]));
      if (attendeeIds.length > 0 && createdEventIds.length > 0) {
        const attRows = createdEventIds.flatMap((eid) => attendeeIds.map((pid) => ({ event_id: eid, player_id: pid, status: "present" })));
        const aIns = await supabase.from("club_event_attendees").insert(attRows);
        if (aIns.error) throw new Error(aIns.error.message);
      }

      await saveStructureForEvents(createdEventIds);

      await load();
      setBusy(false);
    } catch (e: any) {
      setError(e?.message ?? tr("Erreur de création de la récurrence.", "Recurrence creation error."));
      setBusy(false);
    }
  }

  async function deleteEvent(event: EventRow) {
    setBusy(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");

      if (event.series_id) {
        const deleteOccurrence = window.confirm(
          tr(
            "Cet événement appartient à une récurrence.\n\nOK : supprimer seulement cette occurrence\nAnnuler : choisir la suppression de toute la récurrence",
            "This event belongs to a recurrence.\n\nOK: delete only this occurrence\nCancel: choose deletion of the full recurrence"
          )
        );

        if (deleteOccurrence) {
          const res = await fetch(`/api/coach/events/${encodeURIComponent(event.id)}?scope=occurrence`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
          await load();
          return;
        }

        const deleteSeries = window.confirm(
          tr(
            "Supprimer toute la récurrence ?\n\nToutes les occurrences passées et futures seront supprimées.",
            "Delete the whole recurrence?\n\nAll past and future occurrences will be deleted."
          )
        );
        if (!deleteSeries) return;

        const res = await fetch(`/api/coach/events/series/${encodeURIComponent(event.series_id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
        await load();
        return;
      }

      const ok = window.confirm(tr("Supprimer cet événement planifié ? (irréversible)", "Delete this planned event? (irreversible)"));
      if (!ok) return;

      const res = await fetch(`/api/coach/events/${encodeURIComponent(event.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
      await load();
    } catch (e: any) {
      setError(e?.message ?? tr("Suppression impossible.", "Delete failed."));
    } finally {
      setBusy(false);
    }
  }

  async function addCoachToEvent(eventId: string, coachId: string) {
    const key = `${eventId}:${coachId}`;
    if (coachEditBusy[key]) return;
    setCoachEditBusy((prev) => ({ ...prev, [key]: true }));

    const ins = await supabase.from("club_event_coaches").insert({ event_id: eventId, coach_id: coachId });
    if (ins.error) {
      setError(ins.error.message);
      setCoachEditBusy((prev) => ({ ...prev, [key]: false }));
      return;
    }

    setEventCoachIds((prev) => {
      const current = prev[eventId] ?? [];
      if (current.includes(coachId)) return prev;
      return { ...prev, [eventId]: [...current, coachId] };
    });
    setCoachEditBusy((prev) => ({ ...prev, [key]: false }));
  }

  async function removeCoachFromEvent(eventId: string, coachId: string) {
    const key = `${eventId}:${coachId}`;
    if (coachEditBusy[key]) return;
    setCoachEditBusy((prev) => ({ ...prev, [key]: true }));

    const del = await supabase
      .from("club_event_coaches")
      .delete()
      .eq("event_id", eventId)
      .eq("coach_id", coachId);
    if (del.error) {
      setError(del.error.message);
      setCoachEditBusy((prev) => ({ ...prev, [key]: false }));
      return;
    }

    setEventCoachIds((prev) => ({ ...prev, [eventId]: (prev[eventId] ?? []).filter((id) => id !== coachId) }));
    setCoachEditBusy((prev) => ({ ...prev, [key]: false }));
  }

  return (
    <main className={styles.page}>
      <nav aria-label="Fil d’Ariane" style={{ color: "#53675a", fontSize: 12, fontWeight: 700 }}>
        <Link href="/coach/groups">Mes groupes</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <Link href={`/coach/groups/${groupId}`}>{group?.name ?? "Groupe"}</Link>
        <span aria-hidden="true" style={{ margin: "0 8px" }}>/</span>
        <span>Planification</span>
      </nav>

      <div className={styles.topline}>
        <div>
          <h1>Planification</h1>
          <p className={styles.lead}>Consultez les activités du groupe {group?.name ?? ""}.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Link className={actionStyles.backButton} href={`/coach/groups/${groupId}`}>
            <ArrowLeft size={16} aria-hidden="true" />
            Retour au groupe
          </Link>
          {canPlan ? (
            <Link className={actionStyles.primaryButton} href={`/coach/groups/${groupId}/planning/add`}>
              <PlusCircle size={16} aria-hidden="true" />
              Ajouter une activité
            </Link>
          ) : null}
        </div>
      </div>

      {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}

      <ManagerStatisticsTabs<PlanningFilterTab>
        ariaLabel={tr("Période des activités", "Activity period")}
        value={pendingEvaluationsOnly ? "pending" : filterMode === "range" ? "all" : filterMode}
        items={[
          { value: "all", label: `${tr("Toutes", "All")} (${filterCounts.all})` },
          { value: "upcoming", label: `${tr("À venir", "Upcoming")} (${filterCounts.upcoming})` },
          { value: "past", label: `${tr("Passés", "Past")} (${filterCounts.past})` },
          { value: "pending", label: `${tr("À évaluer", "To evaluate")} (${pendingEvaluationCount})` },
        ]}
        onChange={(value) => {
          if (value === "pending") {
            setFilterMode("past");
            setEventTypeFilter("all");
            setPendingEvaluationsOnly(true);
            return;
          }
          setPendingEvaluationsOnly(false);
          setFilterMode(value);
        }}
      />

      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Filtrer les activités</h2>
            <p>Affinez la liste par type d’activité.</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={fieldLabelStyle}>{tr("Type d’activité", "Activity type")}</span>
            <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value as EventTypeFilter)} disabled={busy}>
              <option value="all">{tr("Tous les types", "All types")}</option>
              <option value="training">{tr("Entraînement", "Training")}</option>
              <option value="interclub">{tr("Interclub", "Interclub")}</option>
              <option value="camp">{tr("Stage/Camp", "Camp")}</option>
              <option value="session">{tr("Séance", "Session")}</option>
              <option value="event">{tr("Événement", "Event")}</option>
            </select>
          </label>
        </div>
      </section>

      <section className={styles.quickPanel}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Activités</h2>
            <p>{listedEvents.length} activité{listedEvents.length > 1 ? "s" : ""} affichée{listedEvents.length > 1 ? "s" : ""}.</p>
          </div>
        </div>

        {loading ? (
          <CompactLoadingBlock label={t("common.loading")} />
        ) : listedEvents.length === 0 ? (
          <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
            {pendingEvaluationsOnly
              ? tr("Aucun événement passé à évaluer.", "No past event to evaluate.")
              : filterMode === "upcoming"
                ? tr("Aucun événement à venir.", "No upcoming event.")
                : filterMode === "past"
                  ? tr("Aucun événement passé.", "No past event.")
                  : tr("Aucun événement sur cette plage de dates.", "No event in this date range.")}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {listedEvents.map((event) => {
              const coachIds = Array.from(new Set(eventCoachIds[event.id] ?? []));
              const attendeeIds = Array.from(new Set(eventAttendeeIds[event.id] ?? []));
              const playerIds = attendeeIds.filter((id) => playerIdSet.has(id));
              const presentIds = new Set((eventPresentPlayerIds[event.id] ?? []).filter((id) => playerIdSet.has(id)));
              const showEvaluationWarning = eventNeedsEvaluation(event);
              const date = eventDateSummary(event.starts_at, event.ends_at);

              const renderPeopleLine = (label: string, ids: string[], withAttendance = false) => {
                const people = ids.map((id) => personById.get(id)).filter(Boolean) as Array<ProfileLite | CoachLite | ClubMemberLite>;
                const preview = people.slice(0, 8);
                return (
                  <div style={{ display: "grid", gap: 2 }}>
                    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", color: "rgba(0,0,0,0.58)" }}>
                      {label.toUpperCase()}
                    </div>
                    {people.length === 0 ? (
                      <span style={{ color: "rgba(0,0,0,0.50)" }}>{tr("Aucun", "None")}</span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        {preview.map((person) => (
                          <div key={`${label}-${person.id}`} style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 10, background: "rgba(255,255,255,0.74)", padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 180 }}>
                            <span className="user-mgmt-member-avatar" aria-hidden="true">{avatarNode(person as ProfileLite)}</span>
                            {withAttendance ? (
                              <span
                                aria-label={presentIds.has(person.id) ? tr("Présent", "Present") : tr("Absent", "Absent")}
                                title={presentIds.has(person.id) ? tr("Présent", "Present") : tr("Absent", "Absent")}
                                style={{ width: 8, height: 8, borderRadius: 999, background: presentIds.has(person.id) ? "#4f8a4b" : "#c84a40", boxShadow: "0 0 0 2px rgba(255,255,255,.86)", flex: "0 0 auto" }}
                              />
                            ) : null}
                            <span className="truncate" style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.78)" }}>{fullName(person)}</span>
                          </div>
                        ))}
                        {people.length > 8 ? <span style={{ color: "rgba(0,0,0,0.55)", fontSize: 12, fontWeight: 800 }}>+{people.length - 8}</span> : null}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <article key={event.id} className="planning-event-card">
                  <div className="planning-event-card-inner">
                    <div className="planning-event-date">
                      <div className="planning-event-day">{date.day}</div>
                      <div className="planning-event-number">{date.date}</div>
                      <div className="planning-event-month">{date.month}</div>
                      <div className="planning-event-time-divider" />
                      <div className="planning-event-times">
                        <span>{date.startTime}</span>
                        {date.endTime ? <span>{date.endTime}</span> : null}
                      </div>
                    </div>

                    <div className="planning-event-content">
                      <div style={{ display: "grid", gap: 10 }}>
                        <div className="planning-event-title-row">
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                            <h3 className="planning-event-title">{eventTypeLabelLocalized(event.event_type)}</h3>
                            <span className="pill-soft">{event.series_id ? tr("Récurrent", "Recurring") : tr("Unique", "Single")}</span>
                            {showEvaluationWarning ? (
                              <span className="manager-calendar-warning-pill"><AlertTriangle size={14} aria-hidden="true" />{tr("Évaluation", "Evaluation")}</span>
                            ) : null}
                          </div>
                          <span className="pill-soft">{event.duration_minutes} min</span>
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          {renderPeopleLine(tr("Coachs", "Coaches"), coachIds)}
                          <div style={{ height: 1, background: "rgba(0,0,0,0.08)" }} />
                          {renderPeopleLine(tr("Juniors", "Juniors"), playerIds, true)}
                        </div>

                        <div className="planning-event-footer">
                          <span className="planning-event-location"><MapPin size={16} aria-hidden="true" /><span>{event.location_text?.trim() || "Lieu non disponible"}</span></span>
                          <div className="user-mgmt-card-actions">
                            <Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning/${event.id}`}>{tr("Ouvrir", "Open")}</Link>
                            {canPlan ? (
                              <Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning/${event.id}/edit`}><Pencil size={16} aria-hidden="true" />{t("common.edit")}</Link>
                            ) : null}
                            {canPlan ? (
                              <button type="button" className={actionStyles.dangerButton} disabled={busy} onClick={() => deleteEvent(event)} title="Supprimer"><Trash2 size={16} aria-hidden="true" />{t("common.delete")}</button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
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
