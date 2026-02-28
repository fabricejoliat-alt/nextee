"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { createAppNotification, getEventAttendeeUserIds } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import {
  Calendar,
  PlusCircle,
  Repeat,
  Trash2,
  Pencil,
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
  title?: string | null;
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

type FilterMode = "upcoming" | "past" | "range";

export default function CoachGroupPlanningPage() {
  const { locale, t } = useI18n();
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);
  const params = useParams<{ id: string }>();
  const router = useRouter();
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
  const [eventTitle, setEventTitle] = useState<string>("");
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
  const [rangeFrom, setRangeFrom] = useState<string>(() => toYMD(addDays(new Date(), -30)));
  const [rangeTo, setRangeTo] = useState<string>(() => toYMD(addDays(new Date(), 30)));

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
  const personNameById = useMemo(() => {
    const map = new Map<string, string>();
    players.forEach((p) => map.set(p.id, fullName(p)));
    coaches.forEach((c) => map.set(c.id, fullName(c as any)));
    clubMembers.forEach((m) => {
      if (!map.has(m.id)) map.set(m.id, fullName(m as any));
    });
    return map;
  }, [players, coaches, clubMembers]);

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
        const to = addDays(from, 90);
        isoFrom = from.toISOString();
        isoTo = to.toISOString();
      } else if (filterMode === "past") {
        const to = new Date(); // now
        const from = addDays(to, -90);
        isoFrom = from.toISOString();
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

      const eRes = await q;
      if (eRes.error) throw new Error(eRes.error.message);
      const eList = (eRes.data ?? []) as EventRow[];
      setEvents(eList);

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
          .select("event_id,player_id")
          .in("event_id", eventIds);
        if (eaRes.error) throw new Error(eaRes.error.message);
        const attendeesByEvent: Record<string, string[]> = {};
        ((eaRes.data ?? []) as EventAttendeeRow[]).forEach((r) => {
          if (!attendeesByEvent[r.event_id]) attendeesByEvent[r.event_id] = [];
          attendeesByEvent[r.event_id].push(r.player_id);
        });
        setEventAttendeeIds(attendeesByEvent);
      } else {
        setEventCoachIds({});
        setEventAttendeeIds({});
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
      setSelectedPlayers({});
      setCoachIdsSelected([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, filterMode, rangeFrom, rangeTo]);

  async function createSingleEvent() {
    if (!group || busy) return;
    setBusy(true);
    setError(null);

    try {
      if ((eventType === "session" || eventType === "event") && !eventTitle.trim()) {
        throw new Error(eventType === "session" ? tr("Nom de la séance requis.", "Session name is required.") : tr("Nom de l’événement requis.", "Event name is required."));
      }

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
          title: eventTitle.trim() || null,
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

      if (attendeeIds.length > 0 && meId) {
        const msg = await getNotificationMessage("notif.coachEventCreated", locale, {
          eventType: eventTypeLabelLocalized(eventType),
          dateTime: fmtDateTimeRange(startDt.toISOString(), endDt.toISOString()),
          locationPart: locationText.trim() ? ` · ${locationText.trim()}` : "",
        });
        await createAppNotification({
          actorUserId: meId,
          kind: "coach_event_created",
          title: msg.title,
          body: msg.body,
          data: {
            event_id: eventId,
            group_id: groupId,
            url: `/player/golf/trainings/new?club_event_id=${eventId}`,
          },
          recipientUserIds: attendeeIds,
        });
      }

      setBusy(false);
      router.push(`/coach/groups/${groupId}/planning/${eventId}`);
      return;
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
      if ((eventType === "session" || eventType === "event") && !eventTitle.trim()) {
        throw new Error(eventType === "session" ? tr("Nom de la séance requis.", "Session name is required.") : tr("Nom de l’événement requis.", "Event name is required."));
      }
      if (!startDate || !endDate) throw new Error(tr("Dates de récurrence manquantes.", "Missing recurrence dates."));
      if (endDate < startDate) throw new Error(tr("La date de fin doit être après la date de début.", "End date must be after start date."));

      const seriesPayload: SeriesInsert = {
        group_id: group.id,
        club_id: group.club_id,
        event_type: eventType,
        title: eventTitle.trim() || null,
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
          title: eventTitle.trim() || null,
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

      if (attendeeIds.length > 0 && meId && createdEventIds.length > 0) {
        const seriesTime = timeOfDay.length >= 5 ? timeOfDay.slice(0, 5) : String(timeOfDay);
        const msg = await getNotificationMessage("notif.coachEventsCreated", locale, {
          count: createdEventIds.length,
          eventType: eventTypeLabelLocalized(eventType).toLowerCase(),
          changesSummary:
            locale === "fr"
              ? `${createdEventIds.length} occurrence(s) · ${eventTypeLabelLocalized(eventType)} · ${startDate} -> ${endDate} · ${seriesTime} · ${durationMinutes} min${locationText.trim() ? ` · ${locationText.trim()}` : ""}`
              : `${createdEventIds.length} occurrence(s) · ${eventTypeLabelLocalized(eventType)} · ${startDate} -> ${endDate} · ${seriesTime} · ${durationMinutes} min${locationText.trim() ? ` · ${locationText.trim()}` : ""}`,
        });
        await createAppNotification({
          actorUserId: meId,
          kind: "coach_event_created",
          title: msg.title,
          body: msg.body,
          data: { series_id: seriesId, group_id: groupId, url: "/player/golf/trainings" },
          recipientUserIds: attendeeIds,
        });
      }

      setBusy(false);
      if (createdEventIds.length > 0) {
        router.push(`/coach/groups/${groupId}/planning/${createdEventIds[0]}`);
        return;
      }
      await load();
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

    let recipients: string[] = [];
    try {
      recipients = await getEventAttendeeUserIds(eventId);
    } catch {
      recipients = [];
    }

    const del = await supabase.from("club_events").delete().eq("id", eventId);
    if (del.error) setError(del.error.message);

    if (!del.error && recipients.length > 0 && meId) {
      const deleted = events.find((e) => e.id === eventId);
      const eventStart = deleted?.starts_at ?? new Date().toISOString();
      const eventEnd =
        deleted?.ends_at ??
        new Date(new Date(eventStart).getTime() + Math.max(0, Number(deleted?.duration_minutes ?? 0)) * 60_000).toISOString();
      const msg = await getNotificationMessage("notif.coachEventDeleted", locale, {
        eventType: eventTypeLabelLocalized(deleted?.event_type ?? "training"),
        dateTime: fmtDateTimeRange(eventStart, eventEnd),
        locationPart: deleted?.location_text ? ` · ${deleted.location_text}` : "",
      });
      await createAppNotification({
        actorUserId: meId,
        kind: "coach_event_deleted",
        title: msg.title,
        body: msg.body,
        data: { event_id: eventId, group_id: groupId, url: "/player/golf/trainings" },
        recipientUserIds: recipients,
      });
    }

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
                {tr("Ajouter un événement", "Add event")} — {group?.name ?? tr("Groupe", "Group")}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>{t("common.club")}: {clubName}</div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning`}>
                {t("common.back")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Create */}
        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Calendar size={16} />
                  {tr("Créer un événement", "Create event")}
                </div>

                <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setMode("single")}
                    disabled={busy}
                    style={mode === "single" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
                  >
                    {tr("Unique", "Single")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setMode("series")}
                    disabled={busy}
                    style={mode === "series" ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" } : {}}
                  >
                    <Repeat size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                    {tr("Récurrent", "Recurring")}
                  </button>
                </div>
              </div>

              {mode === "single" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{tr("Type d’événement", "Event type")}</span>
                    <select value={eventType} onChange={(e) => setEventType(e.target.value as any)} disabled={busy}>
                      {EVENT_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {eventTypeLabelLocalized(opt.value)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {(eventType === "session" || eventType === "event") ? (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>
                        {eventType === "session" ? tr("Nom de la séance", "Session name") : tr("Nom de l’événement", "Event name")}
                      </span>
                      <input
                        value={eventTitle}
                        onChange={(e) => setEventTitle(e.target.value)}
                        disabled={busy}
                        placeholder={eventType === "session" ? tr("Ex: Séance putting junior", "E.g. Junior putting session") : tr("Ex: Rencontre de printemps", "E.g. Spring meetup")}
                      />
                    </label>
                  ) : null}

                  <div className="grid-2">
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{tr("Date de début", "Start date")}</span>
                      <input type="date" value={singleDate} onChange={(e) => updateSingleDate(e.target.value)} disabled={busy} />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{tr("Heure de début", "Start time")}</span>
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
                      <span style={fieldLabelStyle}>{tr("Durée", "Duration")}</span>
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
                        <span style={fieldLabelStyle}>{tr("Date de fin", "End date")}</span>
                        <input type="date" value={singleEndDate} onChange={(e) => updateSingleEndDate(e.target.value)} disabled={busy} />
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{tr("Heure de fin", "End time")}</span>
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
                    <span style={fieldLabelStyle}>{tr("Type d’événement", "Event type")}</span>
                    <select value={eventType} onChange={(e) => setEventType(e.target.value as any)} disabled={busy}>
                      {EVENT_TYPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {eventTypeLabelLocalized(opt.value)}
                        </option>
                      ))}
                    </select>
                  </label>

                  {(eventType === "session" || eventType === "event") ? (
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>
                        {eventType === "session" ? tr("Nom de la séance", "Session name") : tr("Nom de l’événement", "Event name")}
                      </span>
                      <input
                        value={eventTitle}
                        onChange={(e) => setEventTitle(e.target.value)}
                        disabled={busy}
                        placeholder={eventType === "session" ? tr("Ex: Séance putting junior", "E.g. Junior putting session") : tr("Ex: Rencontre de printemps", "E.g. Spring meetup")}
                      />
                    </label>
                  ) : null}

                  <div className="grid-2">
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{tr("Jour", "Day")}</span>
                      <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={busy}>
                        <option value={1}>{tr("Lundi", "Monday")}</option>
                        <option value={2}>{tr("Mardi", "Tuesday")}</option>
                        <option value={3}>{tr("Mercredi", "Wednesday")}</option>
                        <option value={4}>{tr("Jeudi", "Thursday")}</option>
                        <option value={5}>{tr("Vendredi", "Friday")}</option>
                        <option value={6}>{tr("Samedi", "Saturday")}</option>
                        <option value={0}>{tr("Dimanche", "Sunday")}</option>
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{tr("Heure de début", "Start time")}</span>
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
                      <span style={fieldLabelStyle}>{tr("Durée", "Duration")}</span>
                      <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} disabled={busy}>
                        {DURATION_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m} {t("common.min")}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{tr("Rythme", "Frequency")}</span>
                      <select value={intervalWeeks} onChange={(e) => setIntervalWeeks(Number(e.target.value))} disabled={busy}>
                        {[1, 2, 3, 4].map((w) => (
                          <option key={w} value={w}>
                            {locale === "en" ? `Every ${w} week${w > 1 ? "s" : ""}` : `Toutes les ${w} semaine${w > 1 ? "s" : ""}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {tr("⚠️ On matérialise les occurrences (max 80) pour que ce soit simple à éditer/supprimer par événement.", "⚠️ Occurrences are materialized (max 80) to keep per-event edit/delete simple.")}
                  </div>
                </div>
              ) : null}

              <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>{tr("Lieu (optionnel)", "Location (optional)")}</span>
                <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} placeholder={tr("Ex: Practice / putting / parcours", "E.g. range / putting / course")} />
              </label>

            <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabelStyle}>{tr("Renseignements événement (optionnel)", "Event notes (optional)")}</span>
                <textarea
                  value={coachNote}
                  onChange={(e) => setCoachNote(e.target.value)}
                  disabled={busy}
                  placeholder={tr("Ex: matériel à prévoir, tenue, consignes logistiques…", "E.g. equipment needed, dress code, logistics…")}
                  style={{ minHeight: 96 }}
                />
              </label>
            </div>

            {eventType === "training" ? (
              <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {tr("Structure de l’entraînement (postes)", "Training structure (stations)")}
                </div>

                {structureItems.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {tr("Ajoute des postes si tu veux préremplir l’entraînement des joueurs.", "Add stations if you want to prefill players' training.")}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {structureItems.map((it, idx) => (
                      <div key={idx} style={lightRowCardStyle}>
                        <div style={{ display: "grid", gap: 10, width: "100%" }}>
                          <div className="grid-2">
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{tr("Poste", "Station")}</span>
                              <select value={it.category} onChange={(e) => updateStructureLine(idx, { category: e.target.value })} disabled={busy}>
                                <option value="">-</option>
                                {TRAINING_CATEGORY_VALUES.map((cat) => (
                                  <option key={cat} value={cat}>
                                    {TRAINING_CATEGORY_LABELS[cat] ?? cat}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>{tr("Durée", "Duration")}</span>
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
                            <span style={fieldLabelStyle}>{tr("Note (optionnel)", "Note (optional)")}</span>
                            <input value={it.note} onChange={(e) => updateStructureLine(idx, { note: e.target.value })} disabled={busy} />
                          </label>

                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button type="button" className="btn btn-danger soft" onClick={() => removeStructureLine(idx)} disabled={busy}>
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
                    + {tr("Ajouter un poste", "Add a station")}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Select coaches */}
            <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
              <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Users size={16} /> {tr("Coachs attendus", "Expected coaches")}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || coaches.length === 0 || allCoachesSelected}
                  onClick={() => setCoachIdsSelected(coaches.map((c) => c.id))}
                >
                  {tr("Tout sélectionner", "Select all")}
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={busy || coaches.length === 0 || coachIdsSelected.length === 0}
                  onClick={() => setCoachIdsSelected([])}
                >
                  {tr("Tout désélectionner", "Unselect all")}
                </button>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{tr("Sélection", "Selection")} ({selectedCoachesList.length})</div>

                {coaches.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun coach dans ce groupe.", "No coach in this group.")}</div>
                ) : selectedCoachesList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun coach sélectionné.", "No coach selected.")}</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {selectedCoachesList.map((c) => (
                      <div key={c.id} style={lightRowCardStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={avatarBoxStyle} aria-hidden="true">
                            {avatarNode(c as any)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950 }}>{fullName(c)}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn btn-danger soft"
                          onClick={() => setCoachIdsSelected((prev) => prev.filter((id) => id !== c.id))}
                          disabled={busy}
                          style={{ padding: "10px 12px" }}
                          aria-label="Retirer coach"
                          title="Retirer"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{t("common.add")} ({candidateCoaches.length})</div>

                {coaches.length > 0 && candidateCoaches.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun résultat.", "No result.")}</div>
                ) : candidateCoaches.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {candidateCoaches.map((c) => (
                      <div key={c.id} style={lightRowCardStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={avatarBoxStyle} aria-hidden="true">
                            {avatarNode(c as any)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950 }}>{fullName(c)}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="glass-btn"
                          onClick={() => setCoachIdsSelected((prev) => [...prev, c.id])}
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
                          aria-label="Ajouter coach"
                          title="Ajouter"
                        >
                          <PlusCircle size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Select players */}
            <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
              <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Users size={16} /> {tr("Joueurs attendus", "Expected players")}
              </div>

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
                  {tr("Tout sélectionner", "Select all")}
                </button>

                <button
                  type="button"
                  className="btn"
                  disabled={busy || players.length === 0 || Object.keys(selectedPlayers).length === 0}
                  onClick={() => setSelectedPlayers({})}
                >
                  {tr("Tout désélectionner", "Unselect all")}
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
                  placeholder={tr("Rechercher un joueur (nom, handicap)…", "Search a player (name, handicap)…")}
                  style={{ paddingLeft: 44 }}
                />
              </div>

              {/* Selected */}
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{tr("Sélection", "Selection")} ({selectedPlayersList.length})</div>

                {players.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun joueur dans ce groupe.", "No player in this group.")}</div>
                ) : selectedPlayersList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun joueur sélectionné.", "No selected player.")}</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {selectedPlayersList.map((p) => (
                      <div key={p.id} style={lightRowCardStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={avatarBoxStyle} aria-hidden="true">
                            {avatarNode(p)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950 }}>{fullName(p)}</div>
                            <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                              Handicap {typeof p.handicap === "number" ? p.handicap.toFixed(1) : "—"}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn btn-danger soft"
                          onClick={() => toggleSelectedPlayer(p)}
                          disabled={busy}
                          style={{ padding: "10px 12px" }}
                          aria-label="Retirer"
                          title="Retirer"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add */}
              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{t("common.add")} ({candidatesPlayers.length})</div>

                {players.length > 0 && candidatesPlayers.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun résultat.", "No result.")}</div>
                ) : candidatesPlayers.length > 0 ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    {candidatesPlayers.map((p) => (
                      <div key={p.id} style={lightRowCardStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={avatarBoxStyle} aria-hidden="true">
                            {avatarNode(p)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950 }}>{fullName(p)}</div>
                            <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                              Handicap {typeof p.handicap === "number" ? p.handicap.toFixed(1) : "—"}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="glass-btn"
                          onClick={() => toggleSelectedPlayer(p)}
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
                          aria-label="Ajouter joueur"
                          title="Ajouter"
                        >
                          <PlusCircle size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Club members visible as guests */}
            <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
              <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Users size={16} /> {tr("Invités", "Guests")}
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
                  value={queryGuests}
                  onChange={(e) => setQueryGuests(e.target.value)}
                  disabled={busy}
                  placeholder={tr("Rechercher un invité (nom, rôle)…", "Search a guest (name, role)…")}
                  style={{ paddingLeft: 44 }}
                />
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div className="pill-soft">{tr("Sélection", "Selection")} ({selectedGuestsList.length})</div>
                {selectedGuestsList.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun invité sélectionné.", "No guest selected.")}</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {selectedGuestsList.map((m) => (
                      <div key={m.id} style={lightRowCardStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <div style={avatarBoxStyle} aria-hidden="true">
                            {avatarNode(m as any)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950 }}>{fullName(m)}</div>
                            <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>{memberRoleLabel(m.role)}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="btn btn-danger soft"
                          onClick={() => toggleSelectedGuest(m)}
                          disabled={busy}
                          style={{ padding: "10px 12px" }}
                          aria-label="Retirer invité"
                          title="Retirer"
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
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun résultat.", "No result.")}</div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {candidateGuests.map((m) => (
                        <div key={m.id} style={lightRowCardStyle}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <div style={avatarBoxStyle} aria-hidden="true">
                              {avatarNode(m as any)}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 950 }}>{fullName(m)}</div>
                              <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>{memberRoleLabel(m.role)}</div>
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
                            aria-label="Ajouter invité"
                            title="Ajouter"
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
                  {tr("Saisis une recherche pour ajouter des invités.", "Type a search to add guests.")}
                </div>
              )}
            </div>

            <button
              type="button"
              className="cta-green cta-green-inline"
              disabled={busy || loading || !group}
              onClick={() => (mode === "single" ? createSingleEvent() : createSeries())}
              style={{ width: "100%", justifyContent: "center" }}
            >
              <PlusCircle size={18} />
              {busy ? tr("Enregistrement…", "Saving…") : mode === "single" ? tr("Créer l’événement", "Create event") : tr("Créer la récurrence", "Create recurrence")}
            </button>
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
