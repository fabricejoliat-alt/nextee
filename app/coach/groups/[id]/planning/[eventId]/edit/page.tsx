"use client";

import { organizationFetch as fetch } from "@/lib/organizationFetch";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCoachPlanningRoster } from "@/lib/coachPlanningRoster";
import { coachEventEditSnapshot, coachEventSaveErrorKey, type CoachEventEditSnapshot } from "@/lib/coachEventEditor";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { ArrowLeft, Trash2, PlusCircle, Search, Users } from "lucide-react";
import { createAppNotification } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale, coachText } from "@/lib/i18n/coachMessages";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import formStyles from "@/components/coach/CoachActivityForm.module.css";
import layoutStyles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

type GroupRow = { id: string; name: string | null; club_id: string };

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
};

type CampDayRow = {
  camp_id: string;
  day_index: number;
  starts_at: string | null;
  ends_at: string | null;
  location_text: string | null;
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
type EventAttendeeLite = {
  player_id: string;
  status: "expected" | "present" | "absent" | "excused" | null;
  profile: ProfileLite | null;
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
      // Profile avatars use arbitrary signed URLs; keep the existing native image rendering.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={p.avatar_url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return initials(p);
}



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

function fmtDateTime(iso: string, locale: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(coachDateLocale(locale), {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtDateTimeRange(startIso: string, endIso: string | null, locale: string) {
  if (!endIso) return fmtDateTime(startIso, locale);
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();
  const localeTag = coachDateLocale(locale);

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

export default function CoachEventEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string }>();
  const { locale, t } = useI18n();
  const memberRoleLabel = useCallback((role: string | null | undefined) => t(`coach.form.role.${["owner","admin","manager","coach","player","parent","captain","staff"].includes(role ?? "") ? role : "member"}`), [t]);
  const eventTypeLabelLocalized = (value: string | null | undefined) => t(`coach.activity.${["training","interclub","camp","session","event"].includes(value ?? "") ? value : "event"}`);
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setBusy] = useState(false);
  const [saveCommitted, setSaveCommitted] = useState(false);
  const [confirmation, setConfirmation] = useState<"series" | "deleteOccurrence" | "deleteSeries" | null>(null);
  const [mutationUncertain, setMutationUncertain] = useState(false);
  const busy = saving || saveCommitted || mutationUncertain;
  const mutationInFlight = useRef(false);
  const loadVersion = useRef(0);
  const currentRoute = useRef("");
  const routeKey = `${groupId}/${eventId}`;
  currentRoute.current = routeKey;
  const [editSnapshot, setEditSnapshot] = useState<CoachEventEditSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [clubName, setClubName] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [series, setSeries] = useState<SeriesRow | null>(null);
  const [campDay, setCampDay] = useState<CampDayRow | null>(null);

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
  const [readonlyParticipants, setReadonlyParticipants] = useState<EventAttendeeLite[]>([]);

  // players (same design as planning page)
  const [players, setPlayers] = useState<ProfileLite[]>([]);
  const [queryPlayers, setQueryPlayers] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<Record<string, ProfileLite>>({});
  const [queryGuests, setQueryGuests] = useState("");
  const [selectedGuests, setSelectedGuests] = useState<Record<string, ClubMemberLite>>({});
  const [structureItems, setStructureItems] = useState<TrainingItemDraft[]>([]);
  const isDurationOnlyOccurrenceType = (v: "training" | "interclub" | "camp" | "session" | "event") => v === "training";
  const showsStructureEditor = (v: "training" | "interclub" | "camp" | "session" | "event") => v === "training" || v === "camp";
  const participantsManagedElsewhere = (event?.event_type ?? eventType) === "camp";

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
        fullName(a).localeCompare(fullName(b), locale)
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
        .sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), locale)),
    [coaches, coachIdsSelected, locale]
  );

  const candidateCoaches = useMemo(
    () =>
      coaches
        .filter((c) => !coachIdsSelected.includes(c.id))
        .sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), locale)),
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
    coaches.forEach((c) => blocked.add(c.id));
    return blocked;
  }, [players, coaches]);

  const selectedGuestsList = useMemo(
    () => Object.values(selectedGuests).sort((a, b) => fullName(a).localeCompare(fullName(b), locale)),
    [selectedGuests, locale]
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
  }, [queryGuests, clubMembers, guestBlockedIds, selectedGuests, memberRoleLabel]);

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
      if (!groupId || !eventId) throw new Error("Missing parameters.");

      const { data: uRes, error: uErr } = await supabase.auth.getUser();
      if (version !== loadVersion.current) return;
      if (uErr || !uRes.user) throw new Error("Session invalide.");
      const sessionRes = await supabase.auth.getSession();
      if (version !== loadVersion.current) return;
      const accessToken = sessionRes.data.session?.access_token;
      if (!accessToken) throw new Error("Session invalide.");

      const detailRes = await fetch(`/api/coach/events/${eventId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const detailJson = await detailRes.json().catch(() => ({}));
      if (version !== loadVersion.current) return;
      if (!detailRes.ok) {
        throw new Error(
          typeof detailJson?.error === "string" && detailJson.error.trim()
            ? detailJson.error
            : "Événement introuvable."
        );
      }

      const ev = (detailJson?.event ?? null) as EventRow | null;
      if (!ev || ev.id !== eventId || ev.group_id !== groupId) throw new Error("event_not_found");
      if (String(ev.event_type) === "competition") throw new Error("forbidden");
      const roster = await loadCoachPlanningRoster(supabase, groupId, uRes.user.id);
      if (version !== loadVersion.current) return;
      if (roster.group.club_id !== ev.club_id) throw new Error("forbidden");

      setMeId(String(detailJson?.meId ?? uRes.user.id));
      setReadonlyParticipants(
        Array.isArray(detailJson?.attendees) ? (detailJson.attendees as EventAttendeeLite[]) : []
      );

      setEvent(ev);
      const day = ((detailJson?.campDay ?? null) as CampDayRow | null) ?? null;
      setCampDay(day);

      let effectiveStartIso = ev.starts_at;
      let effectiveEndIso = ev.ends_at ?? new Date(new Date(ev.starts_at).getTime() + ev.duration_minutes * 60000).toISOString();
      let effectiveLocationText = ev.location_text ?? "";

      if ((ev.event_type ?? "training") === "camp" && day) {
        effectiveStartIso = day.starts_at ?? effectiveStartIso;
        effectiveEndIso = day.ends_at ?? effectiveEndIso;
        effectiveLocationText = day.location_text ?? effectiveLocationText;
      }

      setStartsAtLocal(isoToLocalInput(effectiveStartIso));
      setEndsAtLocal(isoToLocalInput(effectiveEndIso));
      setEventType(ev.event_type ?? "training");
      setEventTitle(ev.title ?? "");
      setDurationMinutes(ev.duration_minutes);
      setLocationText(effectiveLocationText);
      setCoachNote(ev.coach_note ?? "");

      setGroup(roster.group);
      setClubName(roster.clubName);
      const cmList: ClubMemberLite[] = roster.members;
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

        if (version !== loadVersion.current) return;
        if (sRes.error) throw new Error(sRes.error.message);
        const s = (sRes.data ?? null) as SeriesRow | null;
        if (s && (s.group_id !== groupId || s.club_id !== ev.club_id)) throw new Error("forbidden");
        setSeries(s);

        if (s) {
          setEditScope("occurrence");
          setWeekday(s.weekday);
          setTimeOfDay((s.time_of_day ?? "18:00:00").slice(0, 5));
          setIntervalWeeks(s.interval_weeks ?? 1);
          setStartDate(s.start_date ?? ymdToday());
          setEndDate(s.end_date ?? toYMD(addDays(new Date(), 60)));
          setSeriesActive(!!s.is_active);
          // The default scope is one occurrence: keep its own title/type/note.
        } else {
          setEditScope("occurrence");
        }
      } else {
        setSeries(null);
        setEditScope("occurrence");
      }

      let coList: CoachLite[] = roster.coaches;
      const plList: ProfileLite[] = roster.players;
      setPlayers(plList);

      const selectedCoachIds = Array.isArray(detailJson?.selectedCoachIds)
        ? (detailJson.selectedCoachIds as string[])
        : [];
      const missingCoachIds = selectedCoachIds.filter((id) => !coList.some((c) => c.id === id));
      for (let offset = 0; offset < missingCoachIds.length; offset += 150) {
        const missingCoachProfiles = await supabase
          .from("profiles")
          .select("id,first_name,last_name,avatar_url")
          .in("id", missingCoachIds.slice(offset, offset + 150));
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
      coList.sort((a, b) => nameOf(a.first_name, a.last_name).localeCompare(nameOf(b.first_name, b.last_name), locale));
      setCoaches(coList);
      setCoachIdsSelected(selectedCoachIds);

      const selectedIds = Array.isArray(detailJson?.attendees)
        ? (detailJson.attendees as Array<{ player_id?: string | null }>)
            .map((row) => String(row.player_id ?? "").trim())
            .filter(Boolean)
        : [];

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
      // An attendee may since have left the group/club. Keep them visible and
      // selected instead of dropping their invitation on an unrelated edit.
      for (const row of (detailJson.attendees ?? []) as EventAttendeeLite[]) {
        if (!defaultSelected[row.player_id] && !guestsSelected[row.player_id] && !coList.some((c) => c.id === row.player_id)) {
          guestsSelected[row.player_id] = { id: row.player_id, first_name: row.profile?.first_name ?? null,
            last_name: row.profile?.last_name ?? null, avatar_url: row.profile?.avatar_url ?? null, role: null };
        }
      }
      setSelectedGuests(guestsSelected);

      const structureRows = Array.isArray(detailJson?.structureItems)
        ? (detailJson.structureItems as Array<{ category: string; minutes: number; note: string | null }>)
        : [];
      setStructureItems(
        structureRows.map((r) => ({
          category: r.category ?? "",
          minutes: String(r.minutes ?? ""),
          note: r.note ?? "",
        }))
      );

      setEditSnapshot(coachEventEditSnapshot(detailJson));
      setLoading(false);
    } catch (e: unknown) {
      if (version !== loadVersion.current) return;
      setEditSnapshot(null);
      setError(e instanceof Error && e.message === "forbidden" ? "coach.error.forbidden" : "coach.error.load");
      setGroup(null);
      setClubName("");
      setEvent(null);
      setSeries(null);
      setCoaches([]);
      setPlayers([]);
      setClubMembers([]);
      setReadonlyParticipants([]);
      setCoachIdsSelected([]);
      setSelectedPlayers({});
      setSelectedGuests({});
      setLoading(false);
    }
  }

  useEffect(() => {
    setEvent(null); setEditSnapshot(null); setSaveCommitted(false); setBusy(false); setConfirmation(null); setMutationUncertain(false);
    mutationInFlight.current = false;
    void load();
    return () => { loadVersion.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, groupId]);

  const attendeeIdsSelected = useMemo(
    () => Array.from(new Set([...Object.keys(selectedPlayers), ...Object.keys(selectedGuests),
      ...(editSnapshot?.player_ids.filter((id) => coaches.some((coach) => coach.id === id)) ?? [])])),
    [selectedPlayers, selectedGuests, editSnapshot, coaches]
  );


  const canSaveOccurrence = useMemo(() => {
    if (busy || loading) return false;
    if (!event || !editSnapshot) return false;
    if (!startsAtLocal) return false;
    if (eventType !== "training" && !endsAtLocal) return false;
    return true;
  }, [busy, loading, event, editSnapshot, startsAtLocal, endsAtLocal, eventType]);

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
    if (!event || !editSnapshot || busy || loading || mutationInFlight.current) return;
    mutationInFlight.current = true;
    const savedRoute = routeKey;
    let dataSaved = false;
    setBusy(true);
    setError(null);

    try {
      if ((eventType === "session" || eventType === "event" || eventType === "camp") && !eventTitle.trim()) {
        throw new Error("title_required");
      }
      const startDt = new Date(startsAtLocal);
      if (Number.isNaN(startDt.getTime())) throw new Error("invalid_event");
      let endDt = new Date(endsAtLocal);
      let computedDuration = Math.max(1, Math.round((endDt.getTime() - startDt.getTime()) / 60000));
      if (isDurationOnlyOccurrenceType(eventType)) {
        computedDuration = Math.max(30, Number(durationMinutes) || 60);
        endDt = new Date(startDt);
        endDt.setMinutes(endDt.getMinutes() + computedDuration);
      } else {
        if (Number.isNaN(endDt.getTime())) throw new Error("invalid_event");
        if (endDt <= startDt) throw new Error("invalid_event");
        computedDuration = Math.max(1, Math.round((endDt.getTime() - startDt.getTime()) / 60000));
      }
      const durationForDb = isDurationOnlyOccurrenceType(eventType)
        ? computedDuration
        : Math.min(computedDuration, MAX_DB_EVENT_DURATION_MINUTES);
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

      const saved = await supabase.rpc("update_coach_event_occurrence_v1", {
        p_event_id: eventId,
        p_expected: editSnapshot,
        p_changes: { event_type: eventType, title: eventTitle.trim() || null, starts_at: nextStartIso,
          ends_at: nextEndIso, duration_minutes: durationForDb, location_text: locationText.trim() || null,
          coach_note: coachNote.trim() || null },
        p_coach_ids: coachIdsSelected,
        p_player_ids: participantsManagedElsewhere ? null : attendeeIdsSelected,
        p_structure: structureItems.map((item) => ({
          category: item.category, minutes: Number(item.minutes), note: item.note.trim() || null,
        })),
      });
      if (saved.error) throw saved.error;
      if (saved.data?.ok !== true) throw new Error("unconfirmed_save");
      dataSaved = true;
      if (savedRoute !== currentRoute.current) return;
      setSaveCommitted(true);

      if (hasPlayerVisibleChange && meId) {
        const recipientIds: string[] = Array.isArray(saved.data.recipient_ids) ? saved.data.recipient_ids : [];
        if (recipientIds.length > 0) {
          const msg = await getNotificationMessage("notif.coachEventUpdated", locale, {
            changesSummary: coachText(t, "coach.form.updatedSummary", {
              type: eventTypeLabelLocalized(eventType), when: fmtDateTimeRange(nextStartIso, nextEndIso, locale),
              minutes: durationForDb, place: locationText.trim() || t("coach.activity.noPlace"),
            }),
          });
          await createAppNotification({ actorUserId: meId, kind: "coach_event_updated", title: msg.title, body: msg.body,
            data: { event_id: eventId, group_id: groupId, url: `/player/golf/trainings/new?club_event_id=${eventId}` },
            recipientUserIds: recipientIds });
        }
      }

      if (savedRoute === currentRoute.current) router.push(`/coach/groups/${groupId}/planning/${eventId}`);
    } catch (e: unknown) {
      if (savedRoute === currentRoute.current) {
        setError(dataSaved ? "coach.error.planningNotification" : coachEventSaveErrorKey(e));
      }
    } finally {
      if (savedRoute === currentRoute.current) {
        if (!dataSaved) mutationInFlight.current = false;
        setBusy(false);
      }
    }
  }

  async function saveSeriesAndRegenerateFuture() {
    let dataSaved = false;
    if (!event?.series_id || !series || !group || busy || mutationInFlight.current) return;

    mutationInFlight.current = true;
    const savedRoute = routeKey;
    setBusy(true);
    setError(null);

    try {
      if (["session","event","camp"].includes(eventType) && !eventTitle.trim()) throw new Error("title_required");
      if (!startDate || !endDate || endDate < startDate) throw new Error("invalid_recurrence");
      const saved = await supabase.rpc("update_coach_event_series_v1", {
        p_source_event_id: eventId,
        p_template: {
          event_type: eventType, title: eventTitle.trim() || null, weekday,
          time_of_day: timeOfDay, interval_weeks: intervalWeeks, start_date: startDate, end_date: endDate,
          duration_minutes: durationMinutes, location_text: locationText.trim() || null,
          coach_note: coachNote.trim() || null, is_active: seriesActive,
        },
        p_coach_ids: coachIdsSelected,
        p_player_ids: attendeeIdsSelected,
        p_structure: structureItems.map((item) => ({
          category: item.category, minutes: Number(item.minutes), note: item.note.trim() || null,
        })),
      });
      if (saved.error) throw saved.error;
      if (saved.data?.ok !== true) throw new Error("unconfirmed_save");
      dataSaved = true;
      if (savedRoute !== currentRoute.current) return;
      setSaveCommitted(true); setConfirmation(null);

      if (!participantsManagedElsewhere && attendeeIdsSelected.length > 0 && meId) {
        const seriesTime = timeOfDay.length >= 5 ? timeOfDay.slice(0, 5) : String(timeOfDay);
        const summary = coachText(t, "coach.form.updatedSummary", { type: eventTypeLabelLocalized(eventType),
          when: `${startDate} → ${endDate} · ${seriesTime}`, minutes: durationMinutes, place: locationText.trim() || t("coach.activity.noPlace") });
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

      if (savedRoute === currentRoute.current) router.push(`/coach/groups/${groupId}/planning`);
    } catch (cause) {
      if (savedRoute === currentRoute.current) setError(dataSaved ? "coach.error.planningNotification" : coachEventSaveErrorKey(cause));
    } finally {
      if (savedRoute === currentRoute.current) { mutationInFlight.current = false; setBusy(false); }
    }
  }

  async function removeActivity(scope: "occurrence" | "series") {
    if (!event || busy || mutationInFlight.current) return;
    mutationInFlight.current = true;
    const savedRoute = routeKey;
    setBusy(true); setError(null);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("forbidden");
      const path = scope === "series" && event.series_id
        ? `/api/coach/events/series/${encodeURIComponent(event.series_id)}`
        : `/api/coach/events/${encodeURIComponent(eventId)}?scope=occurrence`;
      const response = await fetch(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error("unconfirmed_delete");
      if (savedRoute !== currentRoute.current) return;
      if (result.notification_warning) {
        setError("coach.error.deletionNotification"); setMutationUncertain(true);
        return;
      }
      setConfirmation(null); setSaveCommitted(true);
      router.push(`/coach/groups/${groupId}/planning`);
    } catch {
      if (savedRoute === currentRoute.current) { setError("coach.error.planningDelete"); setMutationUncertain(true); }
    } finally {
      if (savedRoute === currentRoute.current) { mutationInFlight.current = false; setBusy(false); }
    }
  }

  return (
    <main className={`${layoutStyles.page} ${formStyles.page}`}>
      <>
        <>
          <nav data-ui="breadcrumb" className={actionStyles.breadcrumb} aria-label={t("common.breadcrumb")}>
            <Link href="/coach/groups">{t("coach.nav.groups")}</Link><span aria-hidden="true">/</span>
            <Link href={`/coach/groups/${groupId}`}>{group?.name ?? t("coach.groups.group")}</Link><span aria-hidden="true">/</span>
            <Link href={`/coach/groups/${groupId}/planning`}>{t("coach.group.planning")}</Link><span aria-hidden="true">/</span>
            <span aria-current="page">{t("common.edit")}</span>
          </nav>
          <header className={layoutStyles.topline}>
            <div><h1>{coachText(t, "coach.form.editTitle", { name: group?.name ?? t("coach.groups.group") })}</h1>
              <p className={layoutStyles.lead}>{group?.name ?? t("coach.groups.group")} · {clubName || t("common.club")}</p>
            </div>
            <Link className={actionStyles.backButton} href={`/coach/groups/${groupId}/planning`}>
              <ArrowLeft size={16} aria-hidden="true"/>{t("coach.form.backPlanning")}
            </Link>
          </header>

          {error && <div className={formStyles.alert} role="alert">{t(error)}</div>}
          {saveCommitted ? <div className={formStyles.notice} role="status">{t("coach.editor.saved")}{" "}
            <Link href={`/coach/groups/${groupId}/planning/${eventId}`}>{t("coach.editor.viewSaved")}</Link>
          </div> : null}
        </>

        <>
          <>
            {loading ? (
              <CoachListSkeleton label={t("coach.calendar.loading")}/>
            ) : !event ? (
              <div className={formStyles.alert}>{t("coach.error.notFound")}</div>
            ) : (
              <>
                <section className={layoutStyles.quickPanel}>
                  <div className={layoutStyles.sectionHeading}><div><h2>{t("coach.form.information")}</h2><p>{t("coach.form.informationHint")}</p></div></div>
                  {/* Scope switch if recurring */}
                  {event.series_id ? (
                    <label className={actionStyles.field}>
                      <span>{t("coach.form.scope")}</span>
                      <select value={editScope} disabled={busy} onChange={(event) => setEditScope(event.target.value as "occurrence" | "series")}>
                        <option value="occurrence">{t("coach.form.occurrence")}</option>
                        <option value="series" disabled={!series}>{t("coach.form.series")}</option>
                      </select>
                      <small>{t("coach.form.futureHint")}</small>
                    </label>
                  ) : null}

                  {event.series_id ? <div className="hr-soft" /> : null}

                  {/* OCCURRENCE */}
                  {editScope === "occurrence" ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      {eventType === "camp" && campDay ? (
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            width: "fit-content",
                            padding: "8px 12px",
                            borderRadius: 999,
                            background: "rgba(53,72,59,0.08)",
                            border: "1px solid rgba(53,72,59,0.14)",
                            color: "rgba(53,72,59,0.95)",
                            fontWeight: 900,
                            fontSize: 12,
                          }}
                        >
                          {coachText(t, "coach.form.dayNumber", { count: campDay.day_index + 1 })}
                        </div>
                      ) : null}

                      <label className={actionStyles.field}>
                        <span>{t("coach.form.eventType")}</span>
                        <select value={eventType} onChange={(e) => setEventType(e.target.value as EventRow["event_type"])} disabled={busy}>
                          {EVENT_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {eventTypeLabelLocalized(opt.value)}
                            </option>
                          ))}
                        </select>
                      </label>

                      {(eventType === "session" || eventType === "event" || eventType === "camp") ? (
                        <label className={actionStyles.field}>
                          <span>
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
                        <label className={actionStyles.field}>
                          <span>{t("coach.form.startDate")}</span>
                          <input type="date" value={occDate} onChange={(e) => updateOccDate(e.target.value)} disabled={busy} />
                        </label>

                        <label className={actionStyles.field}>
                          <span>{t("coach.form.startTime")}</span>
                          <select value={occTime} onChange={(e) => updateOccTime(e.target.value)} disabled={busy}>
                            {QUARTER_HOUR_OPTIONS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {isDurationOnlyOccurrenceType(eventType) ? (
                        <label className={actionStyles.field}>
                          <span>{t("coach.form.duration")}</span>
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
                          <label className={actionStyles.field}>
                            <span>{t("coach.form.endDate")}</span>
                            <input type="date" value={occEndDate} onChange={(e) => updateOccEndDate(e.target.value)} disabled={busy} />
                          </label>

                          <label className={actionStyles.field}>
                            <span>{t("coach.form.endTime")}</span>
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

                      <label className={actionStyles.field}>
                        <span>{t("coach.form.location")}</span>
                        <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} />
                      </label>

                      <label className={actionStyles.field}>
                        <span>{t("coach.form.notes")}</span>
                        <textarea
                          value={coachNote}
                          onChange={(e) => setCoachNote(e.target.value)}
                          disabled={busy}
                          placeholder={t("coach.form.notesExample")}
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
                          {t("coach.form.seriesMissing")}
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          <label className={actionStyles.field}>
                            <span>{t("coach.form.eventType")}</span>
                            <select value={eventType} onChange={(e) => setEventType(e.target.value as EventRow["event_type"])} disabled={busy}>
                              {EVENT_TYPE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {eventTypeLabelLocalized(opt.value)}
                                </option>
                              ))}
                            </select>
                          </label>

                          {(eventType === "session" || eventType === "event" || eventType === "camp") ? (
                            <label className={actionStyles.field}>
                              <span>
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
                            <label className={actionStyles.field}>
                              <span>{t("coach.form.day")}</span>
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

                            <label className={actionStyles.field}>
                              <span>{t("coach.form.startTime")}</span>
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
                            <label className={actionStyles.field}>
                              <span>{t("common.from")}</span>
                              <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                disabled={busy}
                              />
                            </label>

                            <label className={actionStyles.field}>
                              <span>{t("common.to")}</span>
                              <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                disabled={busy}
                              />
                            </label>
                          </div>

                          <div className="grid-2">
                            <label className={actionStyles.field}>
                              <span>{t("coach.form.duration")}</span>
                              <select
                                value={durationMinutes}
                                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                                disabled={busy}
                              >
                                {DURATION_OPTIONS.map((m) => (
                                  <option key={m} value={m}>
                                    {m} {t("common.min")}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className={actionStyles.field}>
                              <span>{t("coach.form.frequency")}</span>
                              <select
                                value={intervalWeeks}
                                onChange={(e) => setIntervalWeeks(Number(e.target.value))}
                                disabled={busy}
                              >
                                {[1, 2, 3, 4].map((w) => (
                                  <option key={w} value={w}>
                                    {w === 1 ? t("coach.form.everyWeek") : coachText(t, "coach.form.everyWeeks", { count: w })}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <label className={actionStyles.field}>
                            <span>{t("coach.form.location")}</span>
                            <input value={locationText} onChange={(e) => setLocationText(e.target.value)} disabled={busy} />
                          </label>

                          <label className={actionStyles.field}>
                            <span>{t("coach.form.notes")}</span>
                            <textarea
                              value={coachNote}
                              onChange={(e) => setCoachNote(e.target.value)}
                              disabled={busy}
                              placeholder={t("coach.form.notesExample")}
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
                            {t("coach.form.seriesActive")}
                          </label>

                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                            {t("coach.form.futureHint")}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>

                {showsStructureEditor(eventType) ? (
                <section className={layoutStyles.quickPanel}>
                  <div className={layoutStyles.sectionHeading}><h2 className={formStyles.sectionTitle}>
                    {t("coach.form.structure")}
                  </h2></div>

                  {structureItems.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {t("coach.form.emptyStructure")}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {structureItems.map((it, idx) => (
                        <div key={idx} className={formStyles.row}>
                          <div style={{ display: "grid", gap: 10, width: "100%" }}>
                            <div className="grid-2">
                              <label className={actionStyles.field}>
                                <span>{t("coach.form.station")}</span>
                                <select value={it.category} onChange={(e) => updateStructureLine(idx, { category: e.target.value })} disabled={busy}>
                                  <option value="">-</option>
                                  {TRAINING_CATEGORY_VALUES.map((cat) => (
                                    <option key={cat} value={cat}>
                                      {t(`coach.form.category.${cat}`)}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className={actionStyles.field}>
                                <span>{t("coach.form.duration")}</span>
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

                            <label className={actionStyles.field}>
                              <span>{t("coach.form.note")}</span>
                              <input value={it.note} onChange={(e) => updateStructureLine(idx, { note: e.target.value })} disabled={busy} />
                            </label>

                            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                              <button type="button" className={actionStyles.dangerButton} onClick={() => removeStructureLine(idx)} disabled={busy}>
                                {t("common.delete")}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className={actionStyles.secondaryButton} onClick={addStructureLine} disabled={busy}>
                      {t("coach.form.addStation")}
                    </button>
                  </div>
                </section>
                ) : null}

                {/* Coachs attendus */}
                <section className={layoutStyles.quickPanel}>
                  <div className={layoutStyles.sectionHeading}><h2 className={formStyles.sectionTitle}>
                    <Users size={16} /> {t("coach.form.coaches")}
                  </h2></div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={actionStyles.secondaryButton}
                      disabled={busy || coaches.length === 0 || allCoachesSelected}
                      onClick={() => setCoachIdsSelected(coaches.map((c) => c.id))}
                    >
                      {t("coach.form.selectAll")}
                    </button>
                    <button
                      type="button"
                      className={actionStyles.secondaryButton}
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
                      <div style={{ display: "grid", gap: 10 }}>
                        {selectedCoachesList.map((c) => (
                          <div key={c.id} className={formStyles.row}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <div className={formStyles.avatar} aria-hidden="true">
                                {avatarNode(c)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div className={formStyles.personName}>{nameOf(c.first_name, c.last_name)}</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className={actionStyles.dangerButton}
                              onClick={() => setCoachIdsSelected((prev) => prev.filter((id) => id !== c.id))}
                              disabled={busy}
                              style={{ padding: "10px 12px" }}
                              aria-label={coachText(t, "coach.form.removeNamed", { name: fullName(c) })}
                              title={t("common.delete")}
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
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noResults")}</div>
                    ) : candidateCoaches.length > 0 ? (
                      <div style={{ display: "grid", gap: 10 }}>
                        {candidateCoaches.map((c) => (
                          <div key={c.id} className={formStyles.row}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <div className={formStyles.avatar} aria-hidden="true">
                                {avatarNode(c)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div className={formStyles.personName}>{nameOf(c.first_name, c.last_name)}</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`${actionStyles.secondaryButton} ${formStyles.iconButton}`}
                              onClick={() => setCoachIdsSelected((prev) => [...prev, c.id])}
                              disabled={busy}

                              aria-label={coachText(t, "coach.form.addNamed", { name: fullName(c) })}
                              title={t("common.add")}
                            >
                              <PlusCircle size={18} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>

                {participantsManagedElsewhere ? (
                  <section className={layoutStyles.quickPanel}>
                    <div className={layoutStyles.sectionHeading}><h2 className={formStyles.sectionTitle}>
                      <Users size={16} /> {t("coach.form.participants")}
                    </h2></div>

                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {t("coach.form.managedParticipants")}
                    </div>

                    {readonlyParticipants.length === 0 ? (
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noParticipants")}</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {readonlyParticipants.map((participant) => {
                          const p = participant.profile ?? null;
                          return (
                            <div key={participant.player_id} className={formStyles.row}>
                              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                <div className={formStyles.avatar} aria-hidden="true">
                                  {avatarNode(p)}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div className={formStyles.personName}>{fullName(p)}</div>
                                  <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                                    {t("coach.directory.handicap")} {typeof p?.handicap === "number" ? new Intl.NumberFormat(coachDateLocale(locale), { minimumFractionDigits: 1 }).format(p.handicap) : "—"}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ) : (
                  <>
                    {/* Joueurs attendus */}
                    <section className={layoutStyles.quickPanel}>
                      <div className={layoutStyles.sectionHeading}><h2 className={formStyles.sectionTitle}>
                        <Users size={16} /> {t("coach.form.players")}
                      </h2></div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className={actionStyles.secondaryButton}
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
                          className={actionStyles.secondaryButton}
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
                          aria-label={t("coach.form.searchPlayers")}
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
                          <div style={{ display: "grid", gap: 10 }}>
                            {selectedPlayersList.map((p) => (
                              <div key={p.id} className={formStyles.row}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                  <div className={formStyles.avatar} aria-hidden="true">
                                    {avatarNode(p)}
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div className={formStyles.personName}>{fullName(p)}</div>
                                    <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                                      {t("coach.directory.handicap")} {typeof p.handicap === "number" ? new Intl.NumberFormat(coachDateLocale(locale), { minimumFractionDigits: 1 }).format(p.handicap) : "—"}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  className={actionStyles.dangerButton}
                                  onClick={() => toggleSelectedPlayer(p)}
                                  disabled={busy}
                                  style={{ padding: "10px 12px" }}
                                  aria-label={coachText(t, "coach.form.removeNamed", { name: fullName(p) })}
                                  title={t("common.delete")}
                                >
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "grid", gap: 10 }}>
                        <div className="pill-soft">{t("common.add")} ({candidatesPlayers.length})</div>

                        {players.length > 0 && candidatesPlayers.length === 0 ? (
                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("coach.form.noResults")}</div>
                        ) : candidatesPlayers.length > 0 ? (
                          <div style={{ display: "grid", gap: 10 }}>
                            {candidatesPlayers.map((p) => (
                              <div key={p.id} className={formStyles.row}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                  <div className={formStyles.avatar} aria-hidden="true">
                                    {avatarNode(p)}
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div className={formStyles.personName}>{fullName(p)}</div>
                                    <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                                      {t("coach.directory.handicap")} {typeof p.handicap === "number" ? new Intl.NumberFormat(coachDateLocale(locale), { minimumFractionDigits: 1 }).format(p.handicap) : "—"}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  className={`${actionStyles.secondaryButton} ${formStyles.iconButton}`}
                                  onClick={() => toggleSelectedPlayer(p)}
                                  disabled={busy}

                                  aria-label={coachText(t, "coach.form.addNamed", { name: fullName(p) })}
                                  title={t("common.add")}
                                >
                                  <PlusCircle size={18} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </section>

                    {/* Invités */}
                    <section className={layoutStyles.quickPanel}>
                      <div className={layoutStyles.sectionHeading}><h2 className={formStyles.sectionTitle}>
                        <Users size={16} /> {t("coach.form.guests")}
                      </h2></div>

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
                          aria-label={t("coach.form.searchGuests")}
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
                              <div key={m.id} className={formStyles.row}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                  <div className={formStyles.avatar} aria-hidden="true">
                                    {avatarNode(m)}
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div className={formStyles.personName}>{fullName(m)}</div>
                                    <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>{memberRoleLabel(m.role)}</div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  className={actionStyles.dangerButton}
                                  onClick={() => toggleSelectedGuest(m)}
                                  disabled={busy}
                                  style={{ padding: "10px 12px" }}
                                  aria-label={coachText(t, "coach.form.removeNamed", { name: fullName(m) })}
                                  title={t("common.delete")}
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
                                <div key={m.id} className={formStyles.row}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                    <div className={formStyles.avatar} aria-hidden="true">
                                      {avatarNode(m)}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                      <div className={formStyles.personName}>{fullName(m)}</div>
                                      <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>{memberRoleLabel(m.role)}</div>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    className={`${actionStyles.secondaryButton} ${formStyles.iconButton}`}
                                    onClick={() => toggleSelectedGuest(m)}
                                    disabled={busy}

                                    aria-label={coachText(t, "coach.form.addNamed", { name: fullName(m) })}
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
                  </>
                )}

                {/* Save */}
                <div className={formStyles.actions}>
                <Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning`}>{t("coach.directory.cancel")}</Link>
                {editScope === "occurrence" ? (
                  <button
                    type="button"
                    className={actionStyles.primaryButton}
                    disabled={!canSaveOccurrence}
                    onClick={saveOccurrenceOnly}
                  >
                    {saving ? t("coachDebrief.saving") : t("coach.editor.saveOccurrence")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={actionStyles.primaryButton}
                    disabled={!canSaveSeries}
                    onClick={() => { if (!busy && !mutationInFlight.current) { setError(null); setConfirmation("series"); } }}
                  >
                    {saving ? t("coachDebrief.saving") : t("coach.editor.saveSeries")}
                  </button>
                )}
                </div>

                {/* Delete */}
                <div className={formStyles.deleteActions}>
                <button
                  type="button"
                  className={actionStyles.dangerButton}
                  disabled={busy}
                  onClick={() => { if (!busy && !mutationInFlight.current) { setError(null); setConfirmation("deleteOccurrence"); } }}
                >
                  <Trash2 size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                  {t("coach.form.deleteOccurrence")}
                </button>

                {event.series_id ? (
                  <button
                    type="button"
                    className={actionStyles.dangerButton}
                    disabled={busy}
                    onClick={() => { if (!busy && !mutationInFlight.current) { setError(null); setConfirmation("deleteSeries"); } }}
                  >
                    <Trash2 size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
                    {t("coach.form.deleteSeries")}
                  </button>
                ) : null}
                </div>
              </>
            )}
          </>
        </>
      </>
      {confirmation ? <AccessibleDialog className={formStyles.dialog} labelledBy="coach-activity-confirm" onClose={() => { if (!saving && !mutationInFlight.current) setConfirmation(null); }}>
        <h2 id="coach-activity-confirm">{t(confirmation === "series" ? "coach.form.seriesConfirm" : "coach.planning.deleteTitle")}</h2>
        <p>{event?.title || eventTypeLabelLocalized(event?.event_type)}<br/>{event ? fmtDateTimeRange(event.starts_at, event.ends_at, locale) : ""}</p>
        <p>{t(confirmation === "series" ? "coach.form.seriesConfirmHint" : confirmation === "deleteSeries" ? "coach.planning.deleteSeriesHint" : "coach.planning.deleteOccurrenceHint")}</p>
        {error ? <p role="alert">{t(error)}</p> : null}
        {mutationUncertain ? <Link href={`/coach/groups/${groupId}/planning`}>{t("coach.planning.refresh")}</Link> : null}
        <footer>
          <button type="button" className={actionStyles.secondaryButton} disabled={saving} onClick={() => { if (!mutationInFlight.current) setConfirmation(null); }}>{t("coach.directory.cancel")}</button>
          <button type="button" className={confirmation === "series" ? actionStyles.primaryButton : actionStyles.dangerButton} disabled={busy} onClick={() => void (confirmation === "series" ? saveSeriesAndRegenerateFuture() : removeActivity(confirmation === "deleteSeries" ? "series" : "occurrence"))}>
            {saving ? t("coachDebrief.saving") : t(confirmation === "series" ? "coach.editor.saveSeries" : confirmation === "deleteSeries" ? "coach.planning.deleteConfirmSeries" : "coach.planning.deleteConfirmOccurrence")}
          </button>
        </footer>
      </AccessibleDialog> : null}
    </main>
  );
}
