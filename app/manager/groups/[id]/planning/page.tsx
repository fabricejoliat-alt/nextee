"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import {
  Calendar,
  PlusCircle,
  Repeat,
  Trash2,
  Pencil,
  AlertTriangle,
  Users,
  Search,
  SlidersHorizontal,
} from "lucide-react";

type GroupRow = { id: string; name: string | null; club_id: string };
type ClubRow = { id: string; name: string | null };

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
  { value: "camp", label: "Stage" },
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

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtDateTimeRange(startIso: string, endIso: string | null) {
  if (!endIso) return fmtDateTime(startIso);
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    const datePart = new Intl.DateTimeFormat("fr-CH", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(start);
    const timeFmt = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" });
    return `${datePart} • ${timeFmt.format(start)} → ${timeFmt.format(end)}`;
  }
  return `${fmtDateTime(startIso)} → ${fmtDateTime(endIso)}`;
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
  for (let m = 5; m <= 120; m += 5) opts.push(m);
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

const filterButtonBaseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: 12,
  border: "1px solid #ddd",
  background: "#f2f2f2",
  color: "#111",
  padding: "8px 12px",
  fontSize: 14,
  fontWeight: 700,
  lineHeight: 1,
  textDecoration: "none",
  cursor: "pointer",
};

const selectedFilterStyle: React.CSSProperties = {
  background: "rgba(31,41,55,0.92)",
  borderColor: "rgba(17,24,39,0.98)",
  color: "rgba(255,255,255,0.96)",
};

const pendingFilterStyle: React.CSSProperties = {
  background: "rgba(249,115,22,0.16)",
  borderColor: "rgba(249,115,22,0.45)",
  color: "rgba(124,45,18,1)",
  fontWeight: 900,
};

const pendingFilterActiveStyle: React.CSSProperties = {
  background: "rgba(249,115,22,0.95)",
  borderColor: "rgba(194,65,12,1)",
  color: "#fff",
  fontWeight: 900,
};

type FilterMode = "upcoming" | "past" | "range";
type EventTypeFilter = "all" | "training" | "interclub" | "camp" | "session" | "event";
type FilterCounts = { upcoming: number; past: number; range: number };

export default function CoachGroupPlanningPage() {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);
  const params = useParams<{ id: string }>();
  const groupId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  const [group, setGroup] = useState<GroupRow | null>(null);
  const [clubName, setClubName] = useState("");

  const [coaches, setCoaches] = useState<CoachLite[]>([]);
  const [players, setPlayers] = useState<ProfileLite[]>([]);
  const [clubMembers, setClubMembers] = useState<ClubMemberLite[]>([]);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventCoachIds, setEventCoachIds] = useState<Record<string, string[]>>({});
  const [eventAttendeeIds, setEventAttendeeIds] = useState<Record<string, string[]>>({});
  const [eventPresentPlayerIds, setEventPresentPlayerIds] = useState<Record<string, string[]>>({});
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
  const [filterCounts, setFilterCounts] = useState<FilterCounts>({ upcoming: 0, past: 0, range: 0 });
  const [pendingEvaluationsOnly, setPendingEvaluationsOnly] = useState(false);

  const eventTypeLabelLocalized = (v: string | null | undefined) => {
    if (v === "training") return tr("Entraînement", "Training");
    if (v === "interclub") return tr("Interclub", "Interclub");
    if (v === "camp") return tr("Stage", "Camp");
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
  const coachIdSet = useMemo(() => new Set(coaches.map((c) => c.id)), [coaches]);
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
    const requiresEvaluationCheck = e.event_type === "training" || e.event_type === "camp" || e.event_type === "interclub";
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

      // club name
      const cRes = await supabase.from("clubs").select("id,name").eq("id", gRes.data.club_id).maybeSingle();
      if (!cRes.error && cRes.data) setClubName((cRes.data as ClubRow).name ?? "Club");
      else setClubName("Club");

      // all active club members (for guests visibility)
      const cmRes = await supabase
        .from("club_members")
        .select("user_id, role")
        .eq("club_id", gRes.data.club_id)
        .eq("is_active", true);
      if (cmRes.error) throw new Error(cmRes.error.message);
      const cmRows = (cmRes.data ?? []) as Array<{ user_id: string; role: string | null }>;
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
      } else {
        // range
        if (rangeFrom) isoFrom = startOfDayISO(rangeFrom);
        if (rangeTo) isoTo = nextDayStartISO(rangeTo); // inclusive end date
      }

      let q = supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status")
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

      const [upCountRes, pastCountRes, rangeCountRes] = await Promise.all([upCountQ, pastCountQ, rangeCountQ]);
      if (upCountRes.error) throw new Error(upCountRes.error.message);
      if (pastCountRes.error) throw new Error(pastCountRes.error.message);
      if (rangeCountRes.error) throw new Error(rangeCountRes.error.message);
      setFilterCounts({
        upcoming: upCountRes.count ?? 0,
        past: pastCountRes.count ?? 0,
        range: rangeCountRes.count ?? 0,
      });

      // Count past events requiring evaluation (independent from current visible filter)
      const pastEvalEventsRes = await supabase
        .from("club_events")
        .select("id,event_type,starts_at,ends_at")
        .eq("group_id", groupId)
        .in("event_type", ["training", "interclub", "camp"]);
      if (pastEvalEventsRes.error) throw new Error(pastEvalEventsRes.error.message);

      const nowTs = Date.now();
      const pastEvalEvents = ((pastEvalEventsRes.data ?? []) as Array<{
        id: string;
        event_type: "training" | "interclub" | "camp" | "session" | "event";
        starts_at: string;
        ends_at: string | null;
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
        ((eaRes.data ?? []) as EventAttendeeRow[]).forEach((r) => {
          if (!attendeesByEvent[r.event_id]) attendeesByEvent[r.event_id] = [];
          attendeesByEvent[r.event_id].push(r.player_id);
          if (r.status === "present") {
            if (!presentByEvent[r.event_id]) presentByEvent[r.event_id] = [];
            presentByEvent[r.event_id].push(r.player_id);
          }
        });
        setEventAttendeeIds(attendeesByEvent);
        setEventPresentPlayerIds(presentByEvent);

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
        setEventEvaluatedPlayerIds({});
      }

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setGroup(null);
      setClubName("");
      setCoaches([]);
      setPlayers([]);
      setClubMembers([]);
      setEvents([]);
      setEventCoachIds({});
      setEventAttendeeIds({});
      setEventPresentPlayerIds({});
      setEventEvaluatedPlayerIds({});
      setPendingEvaluationCount(0);
      setFilterCounts({ upcoming: 0, past: 0, range: 0 });
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

  async function deleteEvent(eventId: string) {
    const ok = window.confirm(tr("Supprimer cet événement planifié ? (irréversible)", "Delete this planned event? (irreversible)"));
    if (!ok) return;

    setBusy(true);
    setError(null);

    const del = await supabase.from("club_events").delete().eq("id", eventId);
    if (del.error) setError(del.error.message);
    setBusy(false);
    await load();
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
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {tr("Planification", "Planning")} — {group?.name ?? tr("Groupe", "Group")}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>{t("common.club")}: {clubName}</div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/manager/groups/${groupId}`}>
                {t("common.back")}
              </Link>
              <Link className="cta-green cta-green-inline" href={`/manager/groups/${groupId}/planning/add`}>
                {tr("Ajouter un événement", "Add event")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* ✅ Filters for list */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
              <SlidersHorizontal size={16} />
              {tr("Filtrer les évènements", "Filter events")}
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={fieldLabelStyle}>{tr("Type d’événement", "Event type")}</span>
              <select value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value as EventTypeFilter)} disabled={busy}>
                <option value="all">{tr("Tous les types", "All types")}</option>
                <option value="training">{tr("Entraînement", "Training")}</option>
                <option value="interclub">{tr("Interclub", "Interclub")}</option>
                <option value="camp">{tr("Stage", "Camp")}</option>
                <option value="session">{tr("Séance", "Session")}</option>
                <option value="event">{tr("Événement", "Event")}</option>
              </select>
            </label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPendingEvaluationsOnly(false);
                  setFilterMode("upcoming");
                }}
                style={{
                  ...filterButtonBaseStyle,
                  ...(filterMode === "upcoming" && !pendingEvaluationsOnly ? selectedFilterStyle : {}),
                  ...(busy ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                }}
              >
                {tr("À venir", "Upcoming")} ({filterCounts.upcoming})
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPendingEvaluationsOnly(false);
                  setFilterMode("past");
                }}
                style={{
                  ...filterButtonBaseStyle,
                  ...(filterMode === "past" && !pendingEvaluationsOnly ? selectedFilterStyle : {}),
                  ...(busy ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                }}
              >
                {tr("Passés", "Past")} ({filterCounts.past})
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPendingEvaluationsOnly(false);
                  setFilterMode("range");
                }}
                style={{
                  ...filterButtonBaseStyle,
                  ...(filterMode === "range" && !pendingEvaluationsOnly ? selectedFilterStyle : {}),
                  ...(busy ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                }}
              >
                {tr("Plage de dates", "Date range")} ({filterCounts.range})
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setFilterMode("past");
                  setEventTypeFilter("all");
                  setPendingEvaluationsOnly((prev) => !prev);
                }}
                style={{
                  ...filterButtonBaseStyle,
                  ...(pendingEvaluationsOnly ? pendingFilterActiveStyle : pendingFilterStyle),
                  ...(busy ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                }}
              >
                {tr("À évaluer", "To evaluate")} ({pendingEvaluationCount})
              </button>
            </div>

            {filterMode === "range" ? (
              <>
                <div className="hr-soft" />
                <div className="grid-2">
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("common.from")}</span>
                    <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} disabled={busy} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("common.to")}</span>
                    <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} disabled={busy} />
                  </label>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* List */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
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
              <div className="marketplace-list marketplace-list-top">
                {listedEvents.map((e) => (
                  <div key={e.id} className="marketplace-item">
                    {(() => {
                      const coachIds = Array.from(new Set(eventCoachIds[e.id] ?? []));
                      const attendeeIds = Array.from(new Set(eventAttendeeIds[e.id] ?? []));
                      const showEvaluationWarning = eventNeedsEvaluation(e);
                      const playerIds = attendeeIds.filter((id) => playerIdSet.has(id));
                      const inviteIds = attendeeIds.filter((id) => !playerIdSet.has(id) && !coachIdSet.has(id));

                      const renderPeopleLine = (label: string, ids: string[]) => {
                        const people = ids
                          .map((id) => personById.get(id))
                          .filter(Boolean) as Array<ProfileLite | CoachLite | ClubMemberLite>;
                        const preview = people.slice(0, 8);
                        const hasMore = people.length > 8;
                        return (
                          <div style={{ display: "grid", gap: 2 }}>
                            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", color: "rgba(0,0,0,0.58)" }}>
                              {label.toUpperCase()}
                            </div>
                            <div>
                              {people.length === 0 ? (
                                <span style={{ color: "rgba(0,0,0,0.50)" }}>{tr("Aucun", "None")}</span>
                              ) : (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                                  {preview.map((person, idx) => (
                                    <div
                                      key={`${label}-${person.id}-${idx}`}
                                      style={{
                                        border: "1px solid rgba(0,0,0,0.10)",
                                        borderRadius: 10,
                                        background: "rgba(255,255,255,0.74)",
                                        padding: "4px 8px",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                        maxWidth: 180,
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: 22,
                                          height: 22,
                                          borderRadius: 999,
                                          overflow: "hidden",
                                          background: "rgba(255,255,255,0.75)",
                                          border: "1px solid rgba(0,0,0,0.10)",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          fontWeight: 950,
                                          color: "var(--green-dark)",
                                          flexShrink: 0,
                                          fontSize: 10,
                                        }}
                                      >
                                        {avatarNode(person as any)}
                                      </div>
                                      <span className="truncate" style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.78)" }}>
                                        {fullName(person as any)}
                                      </span>
                                    </div>
                                  ))}
                                  {hasMore ? <span style={{ color: "rgba(0,0,0,0.55)", fontSize: 12, fontWeight: 800 }}>{tr("Afficher plus...", "Show more...")}</span> : null}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      };

                      return (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                        <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                          {fmtDateTimeRange(e.starts_at, e.ends_at)}
                        </div>

                        <div className="marketplace-price-pill">{e.duration_minutes} min</div>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span className="pill-soft">{eventTypeLabelLocalized(e.event_type)}</span>
                        <span className="pill-soft">{clubName || "Club"}</span>
                        {e.series_id ? <span className="pill-soft">{tr("Récurrent", "Recurring")}</span> : <span className="pill-soft">{tr("Unique", "Single")}</span>}
                        {showEvaluationWarning ? (
                          <span
                            className="pill-soft"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              color: "rgba(127,29,29,1)",
                              background: "rgba(239,68,68,0.16)",
                              borderColor: "rgba(239,68,68,0.35)",
                              fontWeight: 900,
                            }}
                          >
                            <AlertTriangle size={14} />
                            {tr("Évaluation", "Evaluation")}
                          </span>
                        ) : null}
                        {e.location_text ? (
                          <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}>📍 {e.location_text}</span>
                        ) : null}
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        {renderPeopleLine(tr("Coachs", "Coaches"), coachIds)}
                        <div style={{ height: 1, background: "rgba(0,0,0,0.08)" }} />
                        {renderPeopleLine(tr("Joueurs", "Players"), playerIds)}
                        <div style={{ height: 1, background: "rgba(0,0,0,0.08)" }} />
                        {renderPeopleLine(tr("Invités", "Guests"), inviteIds)}
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                        <Link className="btn" href={`/manager/groups/${groupId}/planning/${e.id}`}>
                          {tr("Ouvrir", "Open")}
                        </Link>

                        <Link className="btn" href={`/manager/groups/${groupId}/planning/${e.id}/edit`}>
                          <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                          {t("common.edit")}
                        </Link>

                        <button
                          type="button"
                          className="btn btn-danger soft"
                          disabled={busy}
                          onClick={() => deleteEvent(e.id)}
                          title="Supprimer"
                        >
                          <Trash2 size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                          {t("common.delete")}
                        </button>
                      </div>
                    </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
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
