"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Repeat, Trash2, PlusCircle, Search, Users } from "lucide-react";
import { createAppNotification, getEventAttendeeUserIds } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type GroupRow = { id: string; name: string | null; club_id: string };
type ClubRow = { id: string; name: string | null };

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
  { value: "camp", label: "Stage" },
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

function weekdayFromDate(d: Date) {
  // JS: 0=Sun..6=Sat
  return d.getDay();
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

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};
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
  const out: number[] = [];
  for (let m = 5; m <= 120; m += 5) out.push(m);
  return out;
}
const MINUTE_OPTIONS = buildMinuteOptions();
function buildDurationOptions() {
  const out: number[] = [];
  for (let m = 30; m <= 240; m += 15) out.push(m);
  return out;
}
const DURATION_OPTIONS = buildDurationOptions();
const MAX_DB_EVENT_DURATION_MINUTES = 240;
function buildQuarterHourOptions() {
  const out: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let h = 0; h < 24; h += 1) {
    for (let m = 0; m < 60; m += 15) out.push(`${pad(h)}:${pad(m)}`);
  }
  return out;
}
const QUARTER_HOUR_OPTIONS = buildQuarterHourOptions();

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

function fmtDateTime(iso: string, locale: "fr" | "en") {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtDateTimeRange(startIso: string, endIso: string | null, locale: "fr" | "en") {
  if (!endIso) return fmtDateTime(startIso, locale);
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  const localeTag = locale === "fr" ? "fr-CH" : "en-US";

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

function eventTypeLabelLocalized(v: string | null | undefined, locale: "fr" | "en") {
  if (v === "training") return locale === "fr" ? "Entraînement" : "Training";
  if (v === "interclub") return "Interclub";
  if (v === "camp") return locale === "fr" ? "Stage" : "Camp";
  if (v === "session") return locale === "fr" ? "Séance" : "Session";
  return locale === "fr" ? "Événement" : "Event";
}

export default function CoachEventEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string }>();
  const { locale } = useI18n();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [clubName, setClubName] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [series, setSeries] = useState<SeriesRow | null>(null);

  // UI mode
  const [editScope, setEditScope] = useState<"occurrence" | "series">("occurrence");

  // occurrence fields
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [endsAtLocal, setEndsAtLocal] = useState("");
  const [eventType, setEventType] = useState<"training" | "interclub" | "camp" | "session" | "event">("training");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [locationText, setLocationText] = useState<string>("");
  const [coachNote, setCoachNote] = useState<string>("");

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
  const [initialSelectedAttendeeIds, setInitialSelectedAttendeeIds] = useState<string[]>([]);
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

  async function replaceStructureForEvent(targetEventId: string) {
    const del = await supabase.from("club_event_structure_items").delete().eq("event_id", targetEventId);
    if (del.error) throw new Error(del.error.message);

    const payload = structureItems
      .map((it, idx) => {
        const minutes = Number(it.minutes);
        if (!it.category || !Number.isFinite(minutes) || minutes <= 0) return null;
        return {
          event_id: targetEventId,
          category: it.category,
          minutes,
          note: it.note?.trim() || null,
          position: idx,
        };
      })
      .filter(
        (x): x is { event_id: string; category: string; minutes: number; note: string | null; position: number } =>
          Boolean(x)
      );

    if (payload.length === 0) return;
    const ins = await supabase.from("club_event_structure_items").insert(payload);
    if (ins.error) throw new Error(ins.error.message);
  }

  async function applyStructureForEvents(eventIds: string[]) {
    if (eventIds.length === 0) return;
    for (const eid of eventIds) {
      await replaceStructureForEvent(eid);
    }
  }

  const selectedPlayersList = useMemo(
    () =>
      Object.values(selectedPlayers).sort((a, b) =>
        fullName(a).localeCompare(fullName(b), "fr")
      ),
    [selectedPlayers]
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
        .sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), "fr")),
    [coaches, coachIdsSelected]
  );

  const candidateCoaches = useMemo(
    () =>
      coaches
        .filter((c) => !coachIdsSelected.includes(c.id))
        .sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), "fr")),
    [coaches, coachIdsSelected]
  );

  const allCoachesSelected = useMemo(() => {
    const total = coaches.length;
    const selectedCount = coachIdsSelected.length;
    return total > 0 && selectedCount === total;
  }, [coaches.length, coachIdsSelected.length]);

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

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!groupId || !eventId) throw new Error("Missing parameters.");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (uErr || !uRes.user) throw new Error("Session invalide.");
      setMeId(uRes.user.id);

      // event
      const eRes = await supabase
        .from("club_events")
        .select("id,group_id,club_id,event_type,starts_at,ends_at,duration_minutes,location_text,coach_note,series_id,status")
        .eq("id", eventId)
        .maybeSingle();

      if (eRes.error) throw new Error(eRes.error.message);
      if (!eRes.data) throw new Error("Événement introuvable.");
      const ev = eRes.data as EventRow;
      setEvent(ev);

      setStartsAtLocal(isoToLocalInput(ev.starts_at));
      setEndsAtLocal(isoToLocalInput(ev.ends_at ?? new Date(new Date(ev.starts_at).getTime() + ev.duration_minutes * 60000).toISOString()));
      setEventType(ev.event_type ?? "training");
      setDurationMinutes(ev.duration_minutes);
      setLocationText(ev.location_text ?? "");
      setCoachNote(ev.coach_note ?? "");

      // group
      const gRes = await supabase.from("coach_groups").select("id,name,club_id").eq("id", groupId).maybeSingle();
      if (gRes.error) throw new Error(gRes.error.message);
      if (!gRes.data) throw new Error("Groupe introuvable.");
      setGroup(gRes.data as GroupRow);

      // club name
      const cRes = await supabase.from("clubs").select("id,name").eq("id", gRes.data.club_id).maybeSingle();
      if (!cRes.error && cRes.data) setClubName((cRes.data as ClubRow).name ?? "Club");
      else setClubName("Club");

      // all active club members (for guests)
      const cmRes = await supabase
        .from("club_members")
        .select("user_id, role")
        .eq("club_id", gRes.data.club_id)
        .eq("is_active", true);
      if (cmRes.error) throw new Error(cmRes.error.message);
      const cmRows = (cmRes.data ?? []) as Array<{ user_id: string; role: string | null }>;
      const memberIds = Array.from(new Set(cmRows.map((r) => r.user_id).filter(Boolean)));
      const profilesById = new Map<
        string,
        { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }
      >();
      if (memberIds.length > 0) {
        const profRes = await supabase.from("profiles").select("id, first_name, last_name, avatar_url").in("id", memberIds);
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

      // series
      if (ev.series_id) {
        const sRes = await supabase
          .from("club_event_series")
          .select(
            "id,group_id,club_id,event_type,title,location_text,coach_note,duration_minutes,weekday,time_of_day,interval_weeks,start_date,end_date,is_active,created_by"
          )
          .eq("id", ev.series_id)
          .maybeSingle();

        if (sRes.error) throw new Error(sRes.error.message);
        const s = (sRes.data ?? null) as SeriesRow | null;
        setSeries(s);

        if (s) {
          setEditScope("occurrence");
          setWeekday(s.weekday);
          setTimeOfDay((s.time_of_day ?? "18:00:00").slice(0, 5));
          setIntervalWeeks(s.interval_weeks ?? 1);
          setStartDate(s.start_date ?? ymdToday());
          setEndDate(s.end_date ?? toYMD(addDays(new Date(), 60)));
          setSeriesActive(!!s.is_active);
          setEventType(s.event_type ?? ev.event_type ?? "training");
          setCoachNote(s.coach_note ?? ev.coach_note ?? "");
        } else {
          setEditScope("occurrence");
        }
      } else {
        setSeries(null);
        setEditScope("occurrence");
      }

      // ✅ group coaches (BD: coach_group_coaches.coach_user_id)
      const coRes = await supabase
        .from("coach_group_coaches")
        .select("coach_user_id, profiles:coach_user_id ( id, first_name, last_name )")
        .eq("group_id", groupId);

      if (coRes.error) throw new Error(coRes.error.message);

      const coList: CoachLite[] = (coRes.data ?? []).map((r: any) => ({
        id: r.coach_user_id,
        first_name: r.profiles?.first_name ?? null,
        last_name: r.profiles?.last_name ?? null,
        avatar_url: r.profiles?.avatar_url ?? null,
      }));
      setCoaches(coList);

      // ✅ group players (BD: coach_group_players.player_user_id)
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

      // selected coaches on event (BD: club_event_coaches.coach_id)
      const ecRes = await supabase.from("club_event_coaches").select("coach_id").eq("event_id", eventId);
      if (!ecRes.error) setCoachIdsSelected((ecRes.data ?? []).map((r: any) => r.coach_id as string));
      else setCoachIdsSelected([]);

      // selected attendees -> selectedPlayers map
      const eaRes = await supabase.from("club_event_attendees").select("player_id").eq("event_id", eventId);
      const selectedIds = !eaRes.error ? (eaRes.data ?? []).map((r: any) => r.player_id as string) : [];
      setInitialSelectedAttendeeIds(selectedIds);

      const defaultSelected: Record<string, ProfileLite> = {};
      plList.forEach((p) => {
        if (selectedIds.includes(p.id)) defaultSelected[p.id] = p;
      });
      setSelectedPlayers(defaultSelected);

      const guestsSelected: Record<string, ClubMemberLite> = {};
      cmList.forEach((m) => {
        if (selectedIds.includes(m.id) && !plList.some((p) => p.id === m.id) && !coList.some((c) => c.id === m.id)) {
          guestsSelected[m.id] = m;
        }
      });
      setSelectedGuests(guestsSelected);

      const structRes = await supabase
        .from("club_event_structure_items")
        .select("category,minutes,note,position")
        .eq("event_id", eventId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (!structRes.error) {
        const rows = (structRes.data ?? []) as Array<{ category: string; minutes: number; note: string | null }>;
        setStructureItems(rows.map((r) => ({ category: r.category ?? "", minutes: String(r.minutes ?? ""), note: r.note ?? "" })));
      } else {
        setStructureItems([]);
      }

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
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
      setInitialSelectedAttendeeIds([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const attendeeIdsSelected = useMemo(
    () => Array.from(new Set([...Object.keys(selectedPlayers), ...Object.keys(selectedGuests)])),
    [selectedPlayers, selectedGuests]
  );

  const attendeesAddedOnSave = useMemo(() => {
    const initial = new Set(initialSelectedAttendeeIds);
    return attendeeIdsSelected.filter((id) => !initial.has(id));
  }, [initialSelectedAttendeeIds, attendeeIdsSelected]);

  const attendeesRemovedOnSave = useMemo(() => {
    const current = new Set(attendeeIdsSelected);
    return initialSelectedAttendeeIds.filter((id) => !current.has(id));
  }, [initialSelectedAttendeeIds, attendeeIdsSelected]);

  async function syncPlayerChangesOnFuturePlannedEvents() {
    if (!groupId) return;
    if (attendeesAddedOnSave.length === 0 && attendeesRemovedOnSave.length === 0) return;

    const nowIso = new Date().toISOString();
    const futureRes = await supabase
      .from("club_events")
      .select("id")
      .eq("group_id", groupId)
      .eq("status", "scheduled")
      .gte("starts_at", nowIso);

    if (futureRes.error) throw new Error(futureRes.error.message);

    const futureEventIds = ((futureRes.data ?? []) as Array<{ id: string }>)
      .map((r) => String(r.id ?? ""))
      .filter(Boolean);
    if (futureEventIds.length === 0) return;

    if (attendeesAddedOnSave.length > 0) {
      const addRows = futureEventIds.flatMap((eid) =>
        attendeesAddedOnSave.map((pid) => ({ event_id: eid, player_id: pid, status: "expected" }))
      );

      const addRes = await supabase
        .from("club_event_attendees")
        .upsert(addRows, { onConflict: "event_id,player_id", ignoreDuplicates: true });

      if (addRes.error) throw new Error(addRes.error.message);
    }

    if (attendeesRemovedOnSave.length > 0) {
      const delRes = await supabase
        .from("club_event_attendees")
        .delete()
        .in("event_id", futureEventIds)
        .in("player_id", attendeesRemovedOnSave);

      if (delRes.error) throw new Error(delRes.error.message);
    }
  }

  const canSaveOccurrence = useMemo(() => {
    if (busy || loading) return false;
    if (!event) return false;
    if (!startsAtLocal) return false;
    if (eventType !== "training" && !endsAtLocal) return false;
    return true;
  }, [busy, loading, event, startsAtLocal, endsAtLocal, eventType]);

  const canSaveSeries = useMemo(() => {
    if (busy || loading) return false;
    if (!event?.series_id) return false;
    if (!series) return false;
    if (!startDate || !endDate) return false;
    if (endDate < startDate) return false;
    if (!timeOfDay) return false;
    if (intervalWeeks < 1) return false;
    return true;
  }, [busy, loading, event?.series_id, series, startDate, endDate, timeOfDay, intervalWeeks]);

  async function saveOccurrenceOnly() {
    if (!event) return;
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
      const nextStartIso = startDt.toISOString();
      const nextEndIso = endDt.toISOString();
      const hadScheduleChange =
        event.starts_at !== nextStartIso ||
        (event.ends_at ?? null) !== (nextEndIso ?? null) ||
        (event.location_text ?? null) !== (locationText.trim() || null);

      const upd = await supabase
        .from("club_events")
        .update({
          event_type: eventType,
          starts_at: nextStartIso,
          ends_at: nextEndIso,
          duration_minutes: durationForDb,
          location_text: locationText.trim() || null,
          coach_note: coachNote.trim() || null,
        })
        .eq("id", eventId);

      if (upd.error) throw new Error(upd.error.message);

      // replace coaches
      const delC = await supabase.from("club_event_coaches").delete().eq("event_id", eventId);
      if (delC.error) throw new Error(delC.error.message);
      if (coachIdsSelected.length > 0) {
        const insC = await supabase
          .from("club_event_coaches")
          .insert(coachIdsSelected.map((cid) => ({ event_id: eventId, coach_id: cid })));
        if (insC.error) throw new Error(insC.error.message);
      }

      // replace attendees
      const delA = await supabase.from("club_event_attendees").delete().eq("event_id", eventId);
      if (delA.error) throw new Error(delA.error.message);
      if (attendeeIdsSelected.length > 0) {
        const insA = await supabase
          .from("club_event_attendees")
          .insert(attendeeIdsSelected.map((pid) => ({ event_id: eventId, player_id: pid, status: "expected" })));
        if (insA.error) throw new Error(insA.error.message);
      }

      await replaceStructureForEvent(eventId);

      await syncPlayerChangesOnFuturePlannedEvents();

      if (hadScheduleChange && attendeeIdsSelected.length > 0 && meId) {
        const oldStart = new Date(event.starts_at);
        const oldEnd = event.ends_at
          ? new Date(event.ends_at)
          : new Date(new Date(event.starts_at).getTime() + Math.max(0, event.duration_minutes || 0) * 60_000);
        const oldRange = fmtDateTimeRange(oldStart.toISOString(), oldEnd.toISOString(), locale);
        const newRange = fmtDateTimeRange(startDt.toISOString(), endDt.toISOString(), locale);
        const oldDuration = Math.max(0, Number(event.duration_minutes ?? 0));
        const newDuration = Math.max(0, Number(durationForDb ?? 0));
        const oldLoc = (event.location_text ?? "").trim() || "—";
        const newLoc = locationText.trim() || "—";
        const pieces =
          locale === "fr"
            ? [
                `Date/heure: ${oldRange} -> ${newRange}`,
                `Durée: ${oldDuration} min -> ${newDuration} min`,
                `Lieu: ${oldLoc} -> ${newLoc}`,
              ]
            : [
                `Date/time: ${oldRange} -> ${newRange}`,
                `Duration: ${oldDuration} min -> ${newDuration} min`,
                `Location: ${oldLoc} -> ${newLoc}`,
              ];
        const msg = await getNotificationMessage("notif.coachEventUpdated", locale, {
          changesSummary: pieces.join(" · "),
        });
        await createAppNotification({
          actorUserId: meId,
          kind: "coach_event_updated",
          title: msg.title,
          body: msg.body,
          data: {
            event_id: eventId,
            group_id: groupId,
            url: `/player/golf/trainings/new?club_event_id=${eventId}`,
          },
          recipientUserIds: attendeeIdsSelected,
        });
      }

      setBusy(false);
      router.push(`/coach/groups/${groupId}/planning/${eventId}`);
    } catch (e: any) {
      setError(e?.message ?? "Erreur sauvegarde.");
      setBusy(false);
    }
  }

  async function saveSeriesAndRegenerateFuture() {
    if (!event?.series_id || !series || !group) return;

    const ok = window.confirm(
      "Update recurrence?\n\n⚠️ This will delete all FUTURE occurrences of this recurrence (from today), then recreate them with the new settings."
    );
    if (!ok) return;

    setBusy(true);
    setError(null);

    try {
      if (!startDate || !endDate) throw new Error("Missing recurrence dates.");
      if (endDate < startDate) throw new Error("End date must be after start date.");

      // 1) update series template
      const updS = await supabase
        .from("club_event_series")
        .update({
          event_type: eventType,
          weekday,
          time_of_day: timeOfDay.length === 5 ? `${timeOfDay}:00` : timeOfDay,
          interval_weeks: intervalWeeks,
          start_date: startDate,
          end_date: endDate,
          duration_minutes: durationMinutes,
          location_text: locationText.trim() || null,
          coach_note: coachNote.trim() || null,
          is_active: seriesActive,
        })
        .eq("id", event.series_id);

      if (updS.error) throw new Error(updS.error.message);

      // 2) delete future occurrences for this series
      const nowIso = new Date().toISOString();
      const delFuture = await supabase
        .from("club_events")
        .delete()
        .eq("series_id", event.series_id)
        .gte("starts_at", nowIso);

      if (delFuture.error) throw new Error(delFuture.error.message);

      // 3) regenerate occurrences (cap 80)
      const startLocal = new Date(`${startDate}T00:00:00`);
      const endLocal = new Date(`${endDate}T23:59:59`);

      let cursor = nextWeekdayOnOrAfter(startLocal, weekday);
      let count = 0;

      const occurrences: any[] = [];
      while (cursor <= endLocal) {
        const dt = combineDateAndTime(toYMD(cursor), timeOfDay);
        const startsIso = dt.toISOString();

        if (startsIso >= nowIso) {
          const endDt = new Date(dt);
          endDt.setMinutes(endDt.getMinutes() + durationMinutes);
          occurrences.push({
            group_id: group.id,
            club_id: group.club_id,
            event_type: eventType,
            starts_at: startsIso,
            ends_at: endDt.toISOString(),
            duration_minutes: durationMinutes,
            location_text: locationText.trim() || null,
            coach_note: coachNote.trim() || null,
            series_id: event.series_id,
            created_by: meId || series.created_by,
          });

          count += 1;
          if (count >= 80) break;
        }

        cursor = addDays(cursor, intervalWeeks * 7);
      }

      if (seriesActive && occurrences.length === 0) {
        throw new Error("No future occurrence generated (check date/day/time).");
      }

      let createdEventIds: string[] = [];
      if (seriesActive && occurrences.length > 0) {
        const eIns = await supabase.from("club_events").insert(occurrences).select("id");
        if (eIns.error) throw new Error(eIns.error.message);
        createdEventIds = (eIns.data ?? []).map((r: any) => r.id as string);
      }

      // 4) apply coaches/attendees to regenerated events
      if (seriesActive && createdEventIds.length > 0) {
        if (coachIdsSelected.length > 0) {
          const coachRows = createdEventIds.flatMap((eid) =>
            coachIdsSelected.map((cid) => ({ event_id: eid, coach_id: cid }))
          );
          const cIns = await supabase.from("club_event_coaches").insert(coachRows);
          if (cIns.error) throw new Error(cIns.error.message);
        }

        if (attendeeIdsSelected.length > 0) {
          const attRows = createdEventIds.flatMap((eid) =>
            attendeeIdsSelected.map((pid) => ({ event_id: eid, player_id: pid, status: "expected" }))
          );
          const aIns = await supabase.from("club_event_attendees").insert(attRows);
          if (aIns.error) throw new Error(aIns.error.message);
        }

        await applyStructureForEvents(createdEventIds);
      }

      await syncPlayerChangesOnFuturePlannedEvents();

      if (attendeeIdsSelected.length > 0 && meId) {
        const seriesTime = timeOfDay.length >= 5 ? timeOfDay.slice(0, 5) : String(timeOfDay);
        const summary =
          locale === "fr"
            ? `Nouvelle récurrence: ${eventTypeLabelLocalized(eventType, locale)} · ${startDate} -> ${endDate} · ${seriesTime} · ${durationMinutes} min · ${locationText.trim() || "sans lieu"}`
            : `New recurrence: ${eventTypeLabelLocalized(eventType, locale)} · ${startDate} -> ${endDate} · ${seriesTime} · ${durationMinutes} min · ${locationText.trim() || "no location"}`;
        const msg = await getNotificationMessage("notif.coachSeriesUpdated", locale, {
          changesSummary: summary,
        });
        await createAppNotification({
          actorUserId: meId,
          kind: "coach_event_updated",
          title: msg.title,
          body: msg.body,
          data: { series_id: event.series_id, group_id: groupId, url: "/player/golf/trainings" },
          recipientUserIds: attendeeIdsSelected,
        });
      }

      setBusy(false);
      router.push(`/coach/groups/${groupId}/planning`);
    } catch (e: any) {
      setError(e?.message ?? "Recurrence update error.");
      setBusy(false);
    }
  }

  async function removeThisEvent() {
    const ok = window.confirm("Supprimer CET événement planifié ? (irréversible)");
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
      const eventStart = event?.starts_at ?? new Date().toISOString();
      const eventEnd =
        event?.ends_at ??
        new Date(new Date(eventStart).getTime() + Math.max(0, Number(event?.duration_minutes ?? 0)) * 60_000).toISOString();
      const msg = await getNotificationMessage("notif.coachEventDeleted", locale, {
        eventType: eventTypeLabelLocalized(event?.event_type ?? "training", locale),
        dateTime: fmtDateTimeRange(eventStart, eventEnd, locale),
        locationPart: event?.location_text ? ` · ${event.location_text}` : "",
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
    router.push(`/coach/groups/${groupId}/planning`);
  }

  async function removeWholeSeries() {
    if (!event?.series_id) return;

    const ok = window.confirm(
      "Delete full RECURRENCE?\n\n⚠️ This deletes the series and all its occurrences (past and future)."
    );
    if (!ok) return;

    setBusy(true);
    setError(null);

    try {
      const seriesEventsRes = await supabase.from("club_events").select("id").eq("series_id", event.series_id);
      if (seriesEventsRes.error) throw new Error(seriesEventsRes.error.message);
      const seriesEventIds = (seriesEventsRes.data ?? []).map((r: any) => String(r.id ?? "").trim()).filter(Boolean);

      let recipients: string[] = [];
      if (seriesEventIds.length > 0) {
        const attRes = await supabase.from("club_event_attendees").select("player_id,event_id").in("event_id", seriesEventIds);
        if (attRes.error) throw new Error(attRes.error.message);
        recipients = Array.from(new Set((attRes.data ?? []).map((r: any) => String(r.player_id ?? "").trim()).filter(Boolean)));
      }

      const delEvents = await supabase.from("club_events").delete().eq("series_id", event.series_id);
      if (delEvents.error) throw new Error(delEvents.error.message);

      const delSeries = await supabase.from("club_event_series").delete().eq("id", event.series_id);
      if (delSeries.error) throw new Error(delSeries.error.message);

      if (recipients.length > 0 && meId) {
        const summary =
          locale === "fr"
            ? `Récurrence supprimée: ${eventTypeLabelLocalized(eventType, locale)} · ${startDate} -> ${endDate} · ${timeOfDay.slice(0, 5)} · ${durationMinutes} min${locationText.trim() ? ` · ${locationText.trim()}` : ""}`
            : `Recurrence deleted: ${eventTypeLabelLocalized(eventType, locale)} · ${startDate} -> ${endDate} · ${timeOfDay.slice(0, 5)} · ${durationMinutes} min${locationText.trim() ? ` · ${locationText.trim()}` : ""}`;
        const msg = await getNotificationMessage("notif.coachSeriesDeleted", locale, {
          changesSummary: summary,
        });
        await createAppNotification({
          actorUserId: meId,
          kind: "coach_event_deleted",
          title: msg.title,
          body: msg.body,
          data: { series_id: event.series_id, group_id: groupId, url: "/player/golf/trainings" },
          recipientUserIds: recipients,
        });
      }

      setBusy(false);
      router.push(`/coach/groups/${groupId}/planning`);
    } catch (e: any) {
      setError(e?.message ?? "Recurrence deletion error.");
      setBusy(false);
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Modifier — {group?.name ?? "Groupe"}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>
                Club: {clubName || "Club"}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning/${eventId}`}>
                Retour
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
            ) : !event ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>No data.</div>
            ) : (
              <>
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
                  {/* Scope switch if recurring */}
                  {event.series_id ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => setEditScope("occurrence")}
                        style={
                          editScope === "occurrence"
                            ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" }
                            : {}
                        }
                      >
                        Cette occurrence
                      </button>

                      <button
                        type="button"
                        className="btn"
                        disabled={busy || !series}
                        onClick={() => setEditScope("series")}
                        style={
                          editScope === "series"
                            ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" }
                            : {}
                        }
                      >
                        <Repeat size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        Récurrence
                      </button>

                      <div style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                        ℹ️ Récurrence = supprime & recrée les occurrences futures
                      </div>
                    </div>
                  ) : null}

                  {event.series_id ? <div className="hr-soft" /> : null}

                  {/* OCCURRENCE */}
                  {editScope === "occurrence" ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>Type d’événement</span>
                        <select value={eventType} onChange={(e) => setEventType(e.target.value as any)} disabled={busy}>
                          {EVENT_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="grid-2">
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>Date de début</span>
                          <input type="date" value={occDate} onChange={(e) => updateOccDate(e.target.value)} disabled={busy} />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={fieldLabelStyle}>Heure de début</span>
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
                          <span style={fieldLabelStyle}>Durée</span>
                          <select value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} disabled={busy}>
                            {DURATION_OPTIONS.map((m) => (
                              <option key={m} value={m}>
                                {m} min
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <div className="grid-2">
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Date de fin</span>
                            <input type="date" value={occEndDate} onChange={(e) => updateOccEndDate(e.target.value)} disabled={busy} />
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Heure de fin</span>
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
                        <span style={fieldLabelStyle}>Lieu (optionnel)</span>
                        <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} />
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>Renseignements événement (optionnel)</span>
                        <textarea
                          value={coachNote}
                          onChange={(e) => setCoachNote(e.target.value)}
                          disabled={busy}
                          placeholder="Ex: matériel à prévoir, tenue, consignes logistiques…"
                          style={{ minHeight: 96 }}
                        />
                      </label>
                    </div>
                  ) : null}

                  {/* SERIES */}
                  {editScope === "series" ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      {!series ? (
                        <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                          Série introuvable. Tu peux modifier l’occurrence uniquement.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Type d’événement</span>
                            <select value={eventType} onChange={(e) => setEventType(e.target.value as any)} disabled={busy}>
                              {EVENT_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <div className="grid-2">
                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>Jour</span>
                              <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={busy}>
                                <option value={1}>Lundi</option>
                                <option value={2}>Mardi</option>
                                <option value={3}>Mercredi</option>
                                <option value={4}>Jeudi</option>
                                <option value={5}>Vendredi</option>
                                <option value={6}>Samedi</option>
                                <option value={0}>Dimanche</option>
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>Heure</span>
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
                              <span style={fieldLabelStyle}>Du</span>
                              <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                disabled={busy}
                              />
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>Au</span>
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
                              <span style={fieldLabelStyle}>Durée</span>
                              <select
                                value={durationMinutes}
                                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                                disabled={busy}
                              >
                                {[45, 60, 75, 90, 105, 120].map((m) => (
                                  <option key={m} value={m}>
                                    {m} min
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label style={{ display: "grid", gap: 6 }}>
                              <span style={fieldLabelStyle}>Rythme</span>
                              <select
                                value={intervalWeeks}
                                onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                                disabled={busy}
                              >
                                {[1, 2, 3, 4].map((w) => (
                                  <option key={w} value={w}>
                                    Toutes les {w} semaine{w > 1 ? "s" : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Lieu (optionnel)</span>
                            <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} />
                          </label>

                          <label style={{ display: "grid", gap: 6 }}>
                            <span style={fieldLabelStyle}>Renseignements événement (optionnel)</span>
                            <textarea
                              value={coachNote}
                              onChange={(e) => setCoachNote(e.target.value)}
                              disabled={busy}
                              placeholder="Ex: matériel à prévoir, tenue, consignes logistiques…"
                              style={{ minHeight: 96 }}
                            />
                          </label>

                          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900 }}>
                            <input
                              type="checkbox"
                              checked={seriesActive}
                              onChange={(e) => setSeriesActive(e.target.checked)}
                              disabled={busy}
                            />
                            Récurrence active
                          </label>

                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                            ⚠️ En enregistrant, on supprime toutes les occurrences futures de cette récurrence et on les recrée (max 80).
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                {eventType === "training" ? (
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    Structure de l’entraînement (postes)
                  </div>

                  {structureItems.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      Aucun poste configuré pour cet entraînement.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {structureItems.map((it, idx) => (
                        <div key={idx} style={lightRowCardStyle}>
                          <div style={{ display: "grid", gap: 10, width: "100%" }}>
                            <div className="grid-2">
                              <label style={{ display: "grid", gap: 6 }}>
                                <span style={fieldLabelStyle}>Poste</span>
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
                                <span style={fieldLabelStyle}>Durée</span>
                                <select value={it.minutes} onChange={(e) => updateStructureLine(idx, { minutes: e.target.value })} disabled={busy}>
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
                              <span style={fieldLabelStyle}>Note (optionnel)</span>
                              <input value={it.note} onChange={(e) => updateStructureLine(idx, { note: e.target.value })} disabled={busy} />
                            </label>

                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <button type="button" className="btn btn-danger soft" onClick={() => removeStructureLine(idx)} disabled={busy}>
                                Supprimer
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="btn" onClick={addStructureLine} disabled={busy}>
                      + Ajouter un poste
                    </button>
                  </div>
                </div>
                ) : null}

                {/* Coachs attendus */}
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} /> Coachs attendus
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || coaches.length === 0 || allCoachesSelected}
                      onClick={() => setCoachIdsSelected(coaches.map((c) => c.id))}
                    >
                      Tout sélectionner
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy || coaches.length === 0 || coachIdsSelected.length === 0}
                      onClick={() => setCoachIdsSelected([])}
                    >
                      Tout désélectionner
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="pill-soft">Sélection ({selectedCoachesList.length})</div>
                    {coaches.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun coach dans ce groupe.</div>
                    ) : selectedCoachesList.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun coach sélectionné.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {selectedCoachesList.map((c) => (
                          <div key={c.id} style={lightRowCardStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <div style={avatarBoxStyle} aria-hidden="true">
                                {avatarNode(c as any)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 950 }}>{nameOf(c.first_name, c.last_name)}</div>
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
                    <div className="pill-soft">Ajouter ({candidateCoaches.length})</div>
                    {coaches.length > 0 && candidateCoaches.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun résultat.</div>
                    ) : candidateCoaches.length > 0 ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        {candidateCoaches.map((c) => (
                          <div key={c.id} style={lightRowCardStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <div style={avatarBoxStyle} aria-hidden="true">
                                {avatarNode(c as any)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 950 }}>{nameOf(c.first_name, c.last_name)}</div>
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

                {/* Joueurs attendus */}
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} /> Joueurs attendus
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
                      Tout sélectionner
                    </button>

                    <button
                      type="button"
                      className="btn"
                      disabled={busy || players.length === 0 || Object.keys(selectedPlayers).length === 0}
                      onClick={() => setSelectedPlayers({})}
                    >
                      Tout désélectionner
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
                      placeholder="Rechercher un joueur (nom, handicap)…"
                      style={{ paddingLeft: 44 }}
                    />
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="pill-soft">Sélection ({selectedPlayersList.length})</div>

                    {players.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun joueur dans ce groupe.</div>
                    ) : selectedPlayersList.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun joueur sélectionné.</div>
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

                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="pill-soft">Ajouter ({candidatesPlayers.length})</div>

                    {players.length > 0 && candidatesPlayers.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun résultat.</div>
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

                {/* Invités */}
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <Users size={16} /> Invités
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
                      placeholder="Rechercher un invité (nom, rôle)…"
                      style={{ paddingLeft: 44 }}
                    />
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    <div className="pill-soft">Sélection ({selectedGuestsList.length})</div>
                    {selectedGuestsList.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun invité sélectionné.</div>
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
                      <div className="pill-soft">Ajouter ({candidateGuests.length})</div>
                      {candidateGuests.length === 0 ? (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun résultat.</div>
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
                      Saisis une recherche pour ajouter des invités.
                    </div>
                  )}
                </div>

                {/* Save */}
                {editScope === "occurrence" ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={!canSaveOccurrence}
                    onClick={saveOccurrenceOnly}
                    style={{ width: "100%", background: "var(--green-dark)", borderColor: "var(--green-dark)", color: "#fff" }}
                  >
                    {busy ? "Saving…" : "Enregistrer cette occurrence"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    disabled={!canSaveSeries}
                    onClick={saveSeriesAndRegenerateFuture}
                    style={{ width: "100%", background: "var(--green-dark)", borderColor: "var(--green-dark)", color: "#fff" }}
                  >
                    {busy ? "Saving…" : "Save recurrence (future)"}
                  </button>
                )}

                {/* Delete */}
                <button
                  type="button"
                  className="btn btn-danger soft"
                  disabled={busy}
                  onClick={removeThisEvent}
                  style={{ width: "100%" }}
                >
                  <Trash2 size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                  Supprimer cette occurrence
                </button>

                {event.series_id ? (
                  <button
                    type="button"
                    className="btn btn-danger soft"
                    disabled={busy}
                    onClick={removeWholeSeries}
                    style={{ width: "100%" }}
                  >
                    <Trash2 size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                    Supprimer la récurrence entière
                  </button>
                ) : null}
              </>
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
