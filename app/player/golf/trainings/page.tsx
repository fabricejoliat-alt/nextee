"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { Flame, Mountain, Smile, CalendarClock, Pencil, CalendarDays, List, Grid3X3, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type SessionRow = {
  id: string;
  start_at: string;
  location_text: string | null;
  session_type: "club" | "private" | "individual";
  club_id: string | null;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  created_at: string;
  club_event_id: string | null; // ✅ important
};

type ClubRow = { id: string; name: string | null };

type SessionItemRow = {
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  other_detail: string | null;
  created_at?: string;
};

type PlannedEventRow = {
  id: string; // club_events.id
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null;
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  club_id: string;
  group_id: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type PlayerActivityEventRow = {
  id: string;
  user_id: string;
  event_type: "competition" | "camp";
  title: string;
  starts_at: string;
  ends_at: string;
  location_text: string | null;
  status: "scheduled" | "cancelled";
  created_at: string;
};

type FilterMode = "planned" | "past";
type ViewMode = "list" | "calendar";
type CalendarMode = "week" | "month";

type DisplayItem =
  | { kind: "session"; key: string; dateIso: string; session: SessionRow }
  | { kind: "event"; key: string; dateIso: string; event: PlannedEventRow }
  | { kind: "competition"; key: string; dateIso: string; competition: PlayerActivityEventRow };

const PAGE_SIZE = 10;

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

function eventTypeLabel(v: PlannedEventRow["event_type"], locale: "fr" | "en") {
  if (locale === "en") {
    if (v === "training") return "Training";
    if (v === "interclub") return "Interclub";
    if (v === "camp") return "Camp";
    if (v === "session") return "Session";
    return "Event";
  }
  if (v === "training") return "Entraînement";
  if (v === "interclub") return "Interclubs";
  if (v === "camp") return "Stage";
  if (v === "session") return "Réunion";
  return "Événement";
}

function eventTypeColor(v: PlannedEventRow["event_type"]) {
  if (v === "training") return { bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.48)", text: "rgba(20,83,45,1)" };
  if (v === "interclub") return { bg: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.46)", text: "rgba(30,64,175,1)" };
  if (v === "camp") return { bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.50)", text: "rgba(120,53,15,1)" };
  if (v === "session") return { bg: "rgba(168,85,247,0.16)", border: "rgba(168,85,247,0.46)", text: "rgba(88,28,135,1)" };
  return { bg: "rgba(15,23,42,0.10)", border: "rgba(15,23,42,0.24)", text: "rgba(15,23,42,1)" };
}

function typeLabel(t: SessionRow["session_type"]) {
  if (t === "club") return "Club";
  if (t === "private") return "Private";
  return "Individual";
}

function uuidOrNull(v: any) {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

const MAX_SCORE = 6;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  return addDays(x, -diff);
}
function endOfWeek(d: Date) {
  return endOfDay(addDays(startOfWeek(d), 6));
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}
function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function RatingBar({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
}) {
  const v = typeof value === "number" ? value : 0;
  const pct = clamp((v / MAX_SCORE) * 100, 0, 100);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ display: "inline-flex" }}>{icon}</span>
          <span style={{ fontWeight: 950, fontSize: 12, color: "rgba(0,0,0,0.65)" }}>{label}</span>
        </div>

        <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{value ?? "—"}</div>
      </div>

      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function TrainingsListPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [attendeeEvents, setAttendeeEvents] = useState<PlannedEventRow[]>([]);
  const [competitionEvents, setCompetitionEvents] = useState<PlayerActivityEventRow[]>([]);

  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [itemsBySessionId, setItemsBySessionId] = useState<Record<string, SessionItemRow[]>>({});

  const [filterMode, setFilterMode] = useState<FilterMode>("planned");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(new Date());
  const [showAddMenu, setShowAddMenu] = useState(false);

  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string>("");

  const [showCompetitionForm, setShowCompetitionForm] = useState(false);
  const [activityCreateType, setActivityCreateType] = useState<"competition" | "camp">("competition");
  const [compTitle, setCompTitle] = useState("");
  const [compPlace, setCompPlace] = useState("");
  const [compStartDate, setCompStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [compEndDate, setCompEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [creatingCompetition, setCreatingCompetition] = useState(false);

  const categoryLabel = (cat: string) => {
    const map: Record<string, string> = {
      warmup_mobility: t("cat.warmup_mobility"),
      long_game: t("cat.long_game"),
      putting: t("cat.putting"),
      wedging: t("cat.wedging"),
      pitching: t("cat.pitching"),
      chipping: t("cat.chipping"),
      bunker: t("cat.bunker"),
      course: t("cat.course"),
      mental: t("cat.mental"),
      fitness: t("cat.fitness"),
      other: t("cat.other"),
    };
    return map[cat] ?? cat;
  };

  const nowTs = Date.now();

  const pastSessions = useMemo(() => {
    return sessions
      .filter((s) => new Date(s.start_at).getTime() < nowTs)
      .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());
  }, [sessions, nowTs]);

  const completeSessionIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      const postes = itemsBySessionId[s.id] ?? [];
      const hasPoste = postes.some((p) => (p.minutes ?? 0) > 0);
      const hasSensations =
        typeof s.motivation === "number" &&
        typeof s.difficulty === "number" &&
        typeof s.satisfaction === "number";
      if (hasPoste && hasSensations) set.add(s.id);
    }
    return set;
  }, [sessions, itemsBySessionId]);

  const scheduledEvents = useMemo(() => {
    return attendeeEvents.filter((ev) => ev.status === "scheduled");
  }, [attendeeEvents]);

  const plannedEvents = useMemo(() => {
    return scheduledEvents
      .filter((ev) => new Date(ev.starts_at).getTime() >= nowTs)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [scheduledEvents, nowTs]);

  const pastAttendeeEvents = useMemo(() => {
    return scheduledEvents
      .filter((ev) => new Date(ev.starts_at).getTime() < nowTs)
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  }, [scheduledEvents, nowTs]);

  const plannedCompetitions = useMemo(() => {
    return competitionEvents
      .filter((ev) => ev.status === "scheduled")
      .filter((ev) => new Date(ev.starts_at).getTime() >= nowTs)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [competitionEvents, nowTs]);

  const pastCompetitions = useMemo(() => {
    return competitionEvents
      .filter((ev) => ev.status === "scheduled")
      .filter((ev) => new Date(ev.starts_at).getTime() < nowTs)
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  }, [competitionEvents, nowTs]);

  const futureSessions = useMemo(() => {
    return sessions
      .filter((s) => new Date(s.start_at).getTime() >= nowTs)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }, [sessions, nowTs]);

  const displayItems = useMemo<DisplayItem[]>(() => {
    if (filterMode === "planned") {
      const plannedEventItems: DisplayItem[] = plannedEvents.map((event) => ({
        kind: "event",
        key: `event-${event.id}`,
        dateIso: event.starts_at,
        event,
      }));

      const futureSessionItems: DisplayItem[] = futureSessions.map((session) => ({
        kind: "session",
        key: `session-${session.id}`,
        dateIso: session.start_at,
        session,
      }));

      const plannedCompetitionItems: DisplayItem[] = plannedCompetitions.map((competition) => ({
        kind: "competition",
        key: `competition-${competition.id}`,
        dateIso: competition.starts_at,
        competition,
      }));

      return [...plannedEventItems, ...futureSessionItems, ...plannedCompetitionItems].sort(
        (a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime()
      );
    }

    const pastSessionItems: DisplayItem[] = pastSessions.map((session) => ({
      kind: "session",
      key: `session-${session.id}`,
      dateIso: session.start_at,
      session,
    }));

    const pastEventItems: DisplayItem[] = pastAttendeeEvents.map((event) => ({
      kind: "event",
      key: `event-${event.id}`,
      dateIso: event.starts_at,
      event,
    }));

    const pastCompetitionItems: DisplayItem[] = pastCompetitions.map((competition) => ({
      kind: "competition",
      key: `competition-${competition.id}`,
      dateIso: competition.starts_at,
      competition,
    }));

    return [...pastSessionItems, ...pastEventItems, ...pastCompetitionItems].sort(
      (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime()
    );
  }, [filterMode, plannedEvents, futureSessions, pastSessions, plannedCompetitions, pastCompetitions, pastAttendeeEvents]);

  const plannedCount = plannedEvents.length + futureSessions.length + plannedCompetitions.length;
  const pastCount = pastSessions.length + pastAttendeeEvents.length + pastCompetitions.length;
  const totalCount = displayItems.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const pagedItems = useMemo(() => {
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE;
    return displayItems.slice(from, to);
  }, [displayItems, page]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const { effectiveUserId: uid } = await resolveEffectivePlayerContext();

      // all player-owned sessions (local filtering + pagination by mode)
      const sRes = await supabase
        .from("training_sessions")
        .select(
          "id,start_at,location_text,session_type,club_id,total_minutes,motivation,difficulty,satisfaction,created_at,club_event_id"
        )
        .eq("user_id", uid)
        .order("start_at", { ascending: false });

      if (sRes.error) throw new Error(sRes.error.message);

      const list = (sRes.data ?? []) as SessionRow[];
      setSessions(list);

      // attendee events for this player
      const aRes = await supabase
        .from("club_event_attendees")
        .select("event_id,player_id,status")
        .eq("player_id", uid);

      if (aRes.error) throw new Error(aRes.error.message);

      const eventIds = Array.from(new Set((aRes.data ?? []).map((r: any) => r.event_id as string)));

      let events: PlannedEventRow[] = [];
      if (eventIds.length > 0) {
        const eRes = await supabase
          .from("club_events")
          .select("id,event_type,title,starts_at,duration_minutes,location_text,club_id,group_id,series_id,status")
          .in("id", eventIds)
          .order("starts_at", { ascending: false });

        if (eRes.error) throw new Error(eRes.error.message);
        events = (eRes.data ?? []) as PlannedEventRow[];
      }
      setAttendeeEvents(events);

      const compRes = await supabase
        .from("player_activity_events")
        .select("id,user_id,event_type,title,starts_at,ends_at,location_text,status,created_at")
        .eq("user_id", uid)
        .order("starts_at", { ascending: false });
      if (compRes.error) throw new Error(compRes.error.message);
      setCompetitionEvents((compRes.data ?? []) as PlayerActivityEventRow[]);

      // clubs names (sessions + all attendee events)
      const clubIds = Array.from(
        new Set(
          [
            ...list.map((s) => uuidOrNull(s.club_id)),
            ...events.map((e) => uuidOrNull(e.club_id)),
          ].filter((x): x is string => typeof x === "string" && x.length > 0)
        )
      );

      if (clubIds.length > 0) {
        const cRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
        if (!cRes.error) {
          const map: Record<string, string> = {};
          (cRes.data ?? []).forEach((c: ClubRow) => {
            map[c.id] = (c.name ?? t("common.club")) as string;
          });
          setClubNameById(map);
        } else {
          setClubNameById({});
        }
      } else {
        setClubNameById({});
      }

      // group names
      const groupIds = Array.from(
        new Set(events.map((e) => uuidOrNull(e.group_id)).filter((x): x is string => typeof x === "string" && x.length > 0))
      );
      if (groupIds.length > 0) {
        const gRes = await supabase.from("coach_groups").select("id,name").in("id", groupIds);
        if (!gRes.error) {
          const map: Record<string, string> = {};
          (gRes.data ?? []).forEach((g: any) => {
            map[g.id] = (g.name ?? "Groupe") as string;
          });
          setGroupNameById(map);
        } else {
          setGroupNameById({});
        }
      } else {
        setGroupNameById({});
      }

      // items for all sessions (needed in past list)
      const sessionIds = list.map((s) => s.id);
      if (sessionIds.length > 0) {
        const itRes = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes,note,other_detail,created_at")
          .in("session_id", sessionIds)
          .order("created_at", { ascending: true });

        if (!itRes.error) {
          const map: Record<string, SessionItemRow[]> = {};
          (itRes.data ?? []).forEach((r: any) => {
            const sid = r.session_id as string;
            if (!map[sid]) map[sid] = [];
            map[sid].push(r as SessionItemRow);
          });
          setItemsBySessionId(map);
        } else {
          setItemsBySessionId({});
        }
      } else {
        setItemsBySessionId({});
      }

      setLoading(false);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t("common.errorLoading");
      setError(message);
      setSessions([]);
      setAttendeeEvents([]);
      setCompetitionEvents([]);
      setClubNameById({});
      setGroupNameById({});
      setItemsBySessionId({});
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [filterMode]);

  async function handleDelete(sessionId: string) {
    const ok = window.confirm(t("trainings.confirmDelete"));
    if (!ok) return;

    setDeletingId(sessionId);
    setError(null);

    const delItems = await supabase.from("training_session_items").delete().eq("session_id", sessionId);
    if (delItems.error) {
      setError(delItems.error.message);
      setDeletingId("");
      return;
    }

    const delSession = await supabase.from("training_sessions").delete().eq("id", sessionId);
    if (delSession.error) {
      setError(delSession.error.message);
      setDeletingId("");
      return;
    }

    setDeletingId("");
    await load();
  }

  async function createActivityEvent() {
    if (creatingCompetition) return;
    const title = compTitle.trim();
    if (!title) {
      setError(
        locale === "fr"
          ? activityCreateType === "camp"
            ? "Nom du stage requis."
            : "Nom de la compétition requis."
          : activityCreateType === "camp"
          ? "Camp title is required."
          : "Competition title is required."
      );
      return;
    }
    if (!compStartDate || !compEndDate) {
      setError(locale === "fr" ? "Dates de début et fin requises." : "Start and end dates are required.");
      return;
    }
    const startsAt = new Date(`${compStartDate}T08:00:00`);
    const endsAt = new Date(`${compEndDate}T18:00:00`);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setError(locale === "fr" ? "Dates invalides." : "Invalid dates.");
      return;
    }
    if (endsAt.getTime() < startsAt.getTime()) {
      setError(locale === "fr" ? "La date de fin doit être après la date de début." : "End date must be after start date.");
      return;
    }

    const { effectiveUserId: uid } = await resolveEffectivePlayerContext();

    setCreatingCompetition(true);
    setError(null);
    const ins = await supabase.from("player_activity_events").insert({
      user_id: uid,
      event_type: activityCreateType,
      title,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      location_text: compPlace.trim() || null,
      status: "scheduled",
    });
    if (ins.error) {
      setError(ins.error.message);
      setCreatingCompetition(false);
      return;
    }

    setCompTitle("");
    setCompPlace("");
    setCompStartDate(new Date().toISOString().slice(0, 10));
    setCompEndDate(new Date().toISOString().slice(0, 10));
    setShowCompetitionForm(false);
    setActivityCreateType("competition");
    setCreatingCompetition(false);
    await load();
  }

  const calendarDays = useMemo(() => {
    if (calendarMode === "week") {
      const from = startOfWeek(anchorDate);
      return Array.from({ length: 7 }, (_, i) => addDays(from, i));
    }
    const first = startOfMonth(anchorDate);
    const last = endOfMonth(anchorDate);
    const from = startOfWeek(first);
    const to = endOfWeek(last);
    const out: Date[] = [];
    for (let d = new Date(from); d.getTime() <= to.getTime(); d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }, [anchorDate, calendarMode]);

  const itemsByDay = useMemo(() => {
    const map: Record<string, DisplayItem[]> = {};
    for (const it of displayItems) {
      const dt = new Date(it.dateIso);
      if (Number.isNaN(dt.getTime())) continue;
      const key = ymd(dt);
      if (!map[key]) map[key] = [];
      map[key].push(it);
    }
    Object.values(map).forEach((arr) => arr.sort((a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime()));
    return map;
  }, [displayItems]);

  const nowDayKey = ymd(new Date());

  function goPrevRange() {
    if (calendarMode === "week") setAnchorDate((d) => addDays(d, -7));
    else setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function goNextRange() {
    if (calendarMode === "week") setAnchorDate((d) => addDays(d, 7));
    else setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {locale === "fr" ? "Mon activité" : "My activity"}
            </div>
          </div>

          <div style={{ marginTop: 10, position: "relative" }}>
            <button
              type="button"
              className="cta-green"
              onClick={() => setShowAddMenu((v) => !v)}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {locale === "fr" ? "Ajouter" : "Add"}
              <ChevronDown size={14} style={{ marginLeft: 8 }} />
            </button>

            {showAddMenu && (
              <div
                className="glass-card"
                style={{
                  marginTop: 8,
                  padding: 8,
                  display: "grid",
                  gap: 6,
                  border: "1px solid rgba(0,0,0,0.10)",
                  background: "rgba(255,255,255,0.92)",
                }}
              >
                <Link
                  className="btn"
                  href="/player/golf/trainings/new"
                  onClick={() => setShowAddMenu(false)}
                  style={{ justifyContent: "flex-start" }}
                >
                  {locale === "fr" ? "Entraînement" : "Training"}
                </Link>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setActivityCreateType("competition");
                    setShowCompetitionForm(true);
                    setShowAddMenu(false);
                  }}
                  style={{ justifyContent: "flex-start" }}
                >
                  {locale === "fr" ? "Compétition" : "Competition"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setActivityCreateType("camp");
                    setShowCompetitionForm(true);
                    setShowAddMenu(false);
                  }}
                  style={{ justifyContent: "flex-start" }}
                >
                  {locale === "fr" ? "Stage" : "Camp"}
                </button>
              </div>
            )}
          </div>

          {showCompetitionForm && (
            <div className="glass-card" style={{ marginTop: 12, padding: 14 }}>
              <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
                <div style={{ fontSize: 13, fontWeight: 950 }}>
                  {activityCreateType === "camp"
                    ? locale === "fr"
                      ? "Nouveau stage"
                      : "New camp"
                    : locale === "fr"
                    ? "Nouvelle compétition"
                    : "New competition"}
                </div>
                <input
                  placeholder={
                    activityCreateType === "camp"
                      ? locale === "fr"
                        ? "Nom du stage"
                        : "Camp title"
                      : locale === "fr"
                      ? "Nom de la compétition"
                      : "Competition title"
                  }
                  value={compTitle}
                  onChange={(e) => setCompTitle(e.target.value)}
                />
                <input
                  placeholder={
                    activityCreateType === "camp"
                      ? locale === "fr"
                        ? "Lieu du stage"
                        : "Camp place"
                      : locale === "fr"
                      ? "Lieu de la compétition"
                      : "Competition place"
                  }
                  value={compPlace}
                  onChange={(e) => setCompPlace(e.target.value)}
                />
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 850 }}>{locale === "fr" ? "Date début" : "Start date"}</span>
                    <input type="date" value={compStartDate} onChange={(e) => setCompStartDate(e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 850 }}>{locale === "fr" ? "Date fin" : "End date"}</span>
                    <input type="date" value={compEndDate} onChange={(e) => setCompEndDate(e.target.value)} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn" type="button" onClick={() => setShowCompetitionForm(false)} disabled={creatingCompetition}>
                    {t("common.cancel")}
                  </button>
                  <button className="btn" type="button" onClick={createActivityEvent} disabled={creatingCompetition}>
                    {creatingCompetition
                      ? locale === "fr"
                        ? "Création…"
                        : "Creating…"
                      : activityCreateType === "camp"
                      ? locale === "fr"
                        ? "Créer le stage"
                        : "Create camp"
                      : locale === "fr"
                      ? "Créer la compétition"
                      : "Create competition"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* List */}
        <div className="glass-section">
          <div className="glass-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
              <div style={{ display: "inline-flex", border: "1px solid rgba(0,0,0,0.14)", borderRadius: 10, overflow: "hidden" }}>
                <button
                  type="button"
                  className={`btn ${viewMode === "list" ? "btn-active-green" : ""}`}
                  onClick={() => setViewMode("list")}
                  style={{
                    borderRadius: 0,
                    border: "none",
                    fontWeight: 900,
                  }}
                >
                  <List size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {locale === "fr" ? "Liste" : "List"}
                </button>
                <button
                  type="button"
                  className={`btn ${viewMode === "calendar" ? "btn-active-green" : ""}`}
                  onClick={() => setViewMode("calendar")}
                  style={{
                    borderRadius: 0,
                    border: "none",
                    fontWeight: 900,
                  }}
                >
                  <Grid3X3 size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                  {locale === "fr" ? "Calendrier" : "Calendar"}
                </button>
              </div>

              <div style={{ display: "inline-flex", border: "1px solid rgba(0,0,0,0.14)", borderRadius: 10, overflow: "hidden" }}>
                {viewMode === "calendar" ? (
                  (["week", "month"] as CalendarMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`btn ${calendarMode === mode ? "btn-active-dark" : ""}`}
                      onClick={() => setCalendarMode(mode)}
                      style={{
                        borderRadius: 0,
                        border: "none",
                        fontWeight: 900,
                      }}
                    >
                      {mode === "week" ? (locale === "fr" ? "Semaine" : "Week") : (locale === "fr" ? "Mois" : "Month")}
                    </button>
                  ))
                ) : (
                  <>
                    <button
                      type="button"
                      className={`btn ${filterMode === "past" ? "btn-active-dark" : ""}`}
                      onClick={() => setFilterMode("past")}
                      disabled={loading}
                      style={{ borderRadius: 0, border: "none", fontWeight: 900 }}
                    >
                      {locale === "fr" ? "Passés" : "Past"} ({pastCount})
                    </button>
                    <button
                      type="button"
                      className={`btn ${filterMode === "planned" ? "btn-active-dark" : ""}`}
                      onClick={() => setFilterMode("planned")}
                      disabled={loading}
                      style={{ borderRadius: 0, border: "none", fontWeight: 900 }}
                    >
                      {locale === "fr" ? "À venir" : "Upcoming"} ({plannedCount})
                    </button>
                  </>
                )}
              </div>
            </div>

            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : totalCount === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("trainings.nonePlanned")}</div>
            ) : viewMode === "calendar" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <CalendarDays size={15} />
                    {new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", {
                      month: "long",
                      year: "numeric",
                    }).format(anchorDate)}
                  </div>
                  <div style={{ display: "inline-flex", gap: 6 }}>
                    <button className="btn" type="button" onClick={goPrevRange}>
                      <ChevronLeft size={14} />
                    </button>
                    <button className="btn" type="button" onClick={() => setAnchorDate(new Date())}>
                      {locale === "fr" ? "Aujourd’hui" : "Today"}
                    </button>
                    <button className="btn" type="button" onClick={goNextRange}>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 6,
                    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                  }}
                >
                    {calendarDays.map((day) => {
                      const dayKey = ymd(day);
                      const items = itemsByDay[dayKey] ?? [];
                      const isToday = dayKey === nowDayKey;
                      const outOfMonth = calendarMode === "month" && day.getMonth() !== anchorDate.getMonth();
                      return (
                        <div
                          key={dayKey}
                          style={{
                            border: isToday ? "2px solid rgba(17,24,39,0.55)" : "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 10,
                            padding: 8,
                            minHeight: 110,
                            background: outOfMonth ? "rgba(243,244,246,0.55)" : "rgba(255,255,255,0.78)",
                            opacity: outOfMonth ? 0.75 : 1,
                            display: "grid",
                            gap: 6,
                            alignContent: "start",
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 900 }}>{new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", { weekday: "short", day: "2-digit" }).format(day)}</div>
                          {items.slice(0, 3).map((it) => {
                            const title =
                              it.kind === "event"
                                ? eventTypeLabel(it.event.event_type, locale === "fr" ? "fr" : "en")
                                : it.kind === "competition"
                                ? it.competition.event_type === "camp"
                                  ? (locale === "fr" ? "Stage" : "Camp")
                                  : (locale === "fr" ? "Compétition" : "Competition")
                                : (it.session.session_type === "club" ? (locale === "fr" ? "Entraînement club" : "Club training") : typeLabel(it.session.session_type));
                            return (
                              <div key={it.key} style={{ fontSize: 10, fontWeight: 800, borderRadius: 8, padding: "3px 6px", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.24)" }} className="truncate">
                                {title}
                              </div>
                            );
                          })}
                          {items.length > 3 ? (
                            <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>+{items.length - 3}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
              </div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {pagedItems.map((item) => {
                  if (item.kind === "event") {
                    const e = item.event;
                    const clubName = clubNameById[e.club_id] ?? t("common.club");
                    const groupName = e.group_id ? groupNameById[e.group_id] : null;
                    const isPlanned = new Date(e.starts_at).getTime() >= nowTs;
                    const eventTone = eventTypeColor(e.event_type);
                    const eventType = eventTypeLabel(e.event_type, locale === "fr" ? "fr" : "en");
                    const eventTitle = eventType;

                    return (
                      <div
                        key={item.key}
                        className="marketplace-item"
                        style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}
                      >
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                              {eventTitle}
                            </div>
                            <div className="marketplace-price-pill">{e.duration_minutes} min</div>
                          </div>

                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)" }}>
                            {fmtDateTime(e.starts_at)}
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                borderRadius: 999,
                                padding: "4px 10px",
                                border: `1px solid ${eventTone.border}`,
                                background: eventTone.bg,
                                color: eventTone.text,
                                fontWeight: 900,
                                fontSize: 11,
                              }}
                            >
                              {eventType}
                            </span>
                            <span className="pill-soft">{clubName}</span>
                            {groupName ? <span className="pill-soft">{groupName}</span> : null}
                            <span className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <CalendarClock size={14} />
                              {isPlanned ? t("trainings.statusPlanned") : t("trainings.statusToComplete")}
                            </span>
                            {e.location_text ? (
                              <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }} className="truncate">
                                📍 {e.location_text}
                              </span>
                            ) : null}
                          </div>

                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                            <Link className="btn" href={`/player/golf/trainings/new?club_event_id=${e.id}`}>
                              <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              {t("trainings.enter")}
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === "competition") {
                    const c = item.competition;
                    const isPlanned = new Date(c.starts_at).getTime() >= nowTs;
                    const typeLabelComp =
                      c.event_type === "camp"
                        ? locale === "fr"
                          ? "Stage"
                          : "Camp"
                        : locale === "fr"
                        ? "Compétition"
                        : "Competition";
                    return (
                      <div
                        key={item.key}
                        className="marketplace-item"
                        style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}
                      >
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                              {c.title}
                            </div>
                            <span className="pill-soft">{typeLabelComp}</span>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)" }}>
                            {fmtDateTime(c.starts_at)} → {fmtDateTime(c.ends_at)}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <CalendarClock size={14} />
                              {isPlanned ? (locale === "fr" ? "À venir" : "Upcoming") : (locale === "fr" ? "Passé" : "Past")}
                            </span>
                            {c.location_text ? (
                              <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }} className="truncate">
                                📍 {c.location_text}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const s = item.session;
                  const clubName = s.session_type === "club" && s.club_id ? clubNameById[s.club_id] ?? t("common.club") : null;
                  const deleting = deletingId === s.id;
                  const postes = itemsBySessionId[s.id] ?? [];

                  return (
                    <Link key={item.key} href={`/player/golf/trainings/${s.id}`} className="marketplace-link">
                      <div className="marketplace-item">
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                            <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                              {new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", {
                                weekday: "short",
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(s.start_at))}
                            </div>
                            <div className="marketplace-price-pill">{(s.total_minutes ?? 0) > 0 ? `${s.total_minutes} ${t("common.min")}` : "—"}</div>
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            {s.session_type === "club" ? (
                              clubName && <span className="pill-soft">{clubName}</span>
                            ) : (
                              <span className="pill-soft">{typeLabel(s.session_type)}</span>
                            )}

                            {s.club_event_id ? <span className="pill-soft">{t("common.coach")}</span> : null}

                            {s.location_text && (
                              <span className="truncate" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}>
                                📍 {s.location_text}
                              </span>
                            )}
                          </div>

                          {postes.length > 0 && <div className="hr-soft" style={{ margin: "2px 0" }} />}

                          {postes.length > 0 && (
                            <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                              {postes.map((p, i) => {
                                const extra = (p.note ?? p.other_detail ?? "").trim();
                                return (
                                  <li key={`${p.session_id}-${i}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                                    {categoryLabel(p.category)} — {p.minutes} min
                                    {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          {postes.length > 0 && <div className="hr-soft" style={{ margin: "2px 0" }} />}

                          <div style={{ display: "grid", gap: 10 }}>
                            <RatingBar icon={<Flame size={16} />} label={t("common.motivation")} value={s.motivation} />
                            <RatingBar icon={<Mountain size={16} />} label={t("common.difficulty")} value={s.difficulty} />
                            <RatingBar icon={<Smile size={16} />} label={t("common.satisfaction")} value={s.satisfaction} />
                          </div>

                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                            <Link className="btn" href={`/player/golf/trainings/${s.id}`} onClick={(e) => e.stopPropagation()}>
                              {t("common.view")}
                            </Link>

                            <Link className="btn" href={`/player/golf/trainings/${s.id}/edit`} onClick={(e) => e.stopPropagation()}>
                              {t("common.edit")}
                            </Link>

                            <button
                              type="button"
                              className="btn btn-danger soft"
                              disabled={loading || deleting}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDelete(s.id);
                              }}
                              title={t("trainings.deleteThis")}
                            >
                              {deleting ? t("common.deleting") : t("common.delete")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {viewMode === "list" && totalCount > 0 && (
            <div className="glass-section">
              <div className="marketplace-pagination">
                <button className="btn" type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={loading || page <= 1}>
                  {t("common.prev")}
                </button>

                <div className="marketplace-page-indicator">
                  {t("common.page")} {page} / {totalPages}
                </div>

                <button className="btn" type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={loading || page >= totalPages}>
                  {t("common.next")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
