"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { createAppNotification, getEventCoachUserIds } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { Flame, Mountain, Smile, ListChecks, Pencil, ChevronDown, Filter } from "lucide-react";
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

type EventStructureItemRow = {
  event_id: string;
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
  created_at?: string;
};

type PlannedEventRow = {
  id: string; // club_events.id
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
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
type PlannedTypeFilter =
  | "all"
  | "training"
  | "interclub"
  | "camp"
  | "session"
  | "event"
  | "competition"
  | "club"
  | "private"
  | "individual";

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

function fmtDateAtLabel(iso: string, locale: "fr" | "en") {
  const d = new Date(iso);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(d);
  const dayMonth = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(d);
  const h = d.getHours();
  const m = d.getMinutes();
  const hh = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
  const weekCap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${weekCap} ${dayMonth} à ${hh}`;
}

function fmtDateLabelNoTime(iso: string, locale: "fr" | "en") {
  const d = new Date(iso);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(d);
  }
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "long" }).format(d);
  const dayMonth = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(d);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${dayMonth}`;
}

function fmtDateLabelNoTimeShort(iso: string, locale: "fr" | "en") {
  const d = new Date(iso);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      day: "numeric",
      month: "long",
    }).format(d);
  }
  const weekday = new Intl.DateTimeFormat("fr-CH", { weekday: "short" }).format(d);
  const dayMonth = new Intl.DateTimeFormat("fr-CH", { day: "numeric", month: "long" }).format(d);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${dayMonth}`;
}

function fmtHourLabel(iso: string, locale: "fr" | "en") {
  const d = new Date(iso);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
  }
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function sameDay(aIso: string, bIso: string) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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

function typeLabel(t: SessionRow["session_type"], locale: "fr" | "en") {
  if (t === "club") return locale === "fr" ? "Entraînement club" : "Club training";
  if (t === "private") return locale === "fr" ? "Cours privé" : "Private lesson";
  return locale === "fr" ? "Entraînement individuel" : "Individual training";
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
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [attendeeEvents, setAttendeeEvents] = useState<PlannedEventRow[]>([]);
  const [attendeeStatusByEventId, setAttendeeStatusByEventId] = useState<Record<string, "expected" | "present" | "absent" | "excused" | null>>({});
  const [competitionEvents, setCompetitionEvents] = useState<PlayerActivityEventRow[]>([]);

  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [itemsBySessionId, setItemsBySessionId] = useState<Record<string, SessionItemRow[]>>({});
  const [eventStructureByEventId, setEventStructureByEventId] = useState<Record<string, EventStructureItemRow[]>>({});

  const [filterMode, setFilterMode] = useState<FilterMode>("planned");
  const [plannedTypeFilter, setPlannedTypeFilter] = useState<PlannedTypeFilter>("all");
  const [showAddMenu, setShowAddMenu] = useState(false);

  const [page, setPage] = useState(1);
  const [attendanceBusyEventId, setAttendanceBusyEventId] = useState<string>("");
  const [viewerUserId, setViewerUserId] = useState<string>("");
  const [effectiveUserId, setEffectiveUserId] = useState<string>("");
  const [effectivePlayerName, setEffectivePlayerName] = useState<string>("");

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
    const sorted = sessions
      .filter((s) => new Date(s.start_at).getTime() < nowTs)
      .sort((a, b) => {
        const dt = new Date(b.start_at).getTime() - new Date(a.start_at).getTime();
        if (dt !== 0) return dt;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

    const byLinkedEvent = new Map<string, SessionRow>();
    const standalone: SessionRow[] = [];

    for (const s of sorted) {
      const linkedId = uuidOrNull(s.club_event_id);
      if (!linkedId) {
        standalone.push(s);
        continue;
      }
      if (!byLinkedEvent.has(linkedId)) byLinkedEvent.set(linkedId, s);
    }

    return [...standalone, ...Array.from(byLinkedEvent.values())].sort(
      (a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime()
    );
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

      const allPlannedItems = [...plannedEventItems, ...futureSessionItems, ...plannedCompetitionItems];
      const filteredPlannedItems =
        plannedTypeFilter === "all"
          ? allPlannedItems
          : allPlannedItems.filter((it) => {
              if (it.kind === "event") return it.event.event_type === plannedTypeFilter;
              if (it.kind === "competition") return plannedTypeFilter === "competition" || (plannedTypeFilter === "camp" && it.competition.event_type === "camp");
              if (it.kind === "session") return it.session.session_type === plannedTypeFilter;
              return true;
            });

      return filteredPlannedItems.sort(
        (a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime()
      );
    }

    const pastSessionItems: DisplayItem[] = pastSessions.map((session) => ({
      kind: "session",
      key: `session-${session.id}`,
      dateIso: session.start_at,
      session,
    }));

    const pastSessionLinkedEventIds = new Set(
      pastSessions.map((s) => uuidOrNull(s.club_event_id)).filter((x): x is string => typeof x === "string" && x.length > 0)
    );

    const pastEventItems: DisplayItem[] = pastAttendeeEvents
      .filter((event) => !pastSessionLinkedEventIds.has(event.id))
      .map((event) => ({
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
  }, [filterMode, plannedEvents, futureSessions, pastSessions, plannedCompetitions, pastCompetitions, pastAttendeeEvents, plannedTypeFilter]);

  const plannedCount = plannedEvents.length + futureSessions.length + plannedCompetitions.length;
  const pastVisibleEventCount = useMemo(() => {
    const pastSessionLinkedEventIds = new Set(
      pastSessions
        .map((s) => uuidOrNull(s.club_event_id))
        .filter((x): x is string => typeof x === "string" && x.length > 0)
    );
    return pastAttendeeEvents.filter((event) => !pastSessionLinkedEventIds.has(event.id)).length;
  }, [pastSessions, pastAttendeeEvents]);
  const pastCount = pastSessions.length + pastVisibleEventCount + pastCompetitions.length;
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
      const { effectiveUserId: uid, viewerUserId: actorId } = await resolveEffectivePlayerContext();
      setViewerUserId(actorId);
      setEffectiveUserId(uid);
      const profRes = await supabase.from("profiles").select("first_name,last_name").eq("id", uid).maybeSingle();
      if (!profRes.error && profRes.data) {
        const full = `${String(profRes.data.first_name ?? "").trim()} ${String(profRes.data.last_name ?? "").trim()}`.trim();
        setEffectivePlayerName(full || "Joueur");
      } else {
        setEffectivePlayerName("Joueur");
      }

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
      const statusMap: Record<string, "expected" | "present" | "absent" | "excused" | null> = {};
      (aRes.data ?? []).forEach((r: any) => {
        statusMap[String(r.event_id)] = (r.status ?? null) as "expected" | "present" | "absent" | "excused" | null;
      });
      setAttendeeStatusByEventId(statusMap);

      let events: PlannedEventRow[] = [];
      if (eventIds.length > 0) {
        const eRes = await supabase
          .from("club_events")
          .select("id,event_type,title,starts_at,ends_at,duration_minutes,location_text,club_id,group_id,series_id,status")
          .in("id", eventIds)
          .order("starts_at", { ascending: false });

        if (eRes.error) throw new Error(eRes.error.message);
        events = (eRes.data ?? []) as PlannedEventRow[];

        const esRes = await supabase
          .from("club_event_structure_items")
          .select("event_id,category,minutes,note,position,created_at")
          .in("event_id", eventIds)
          .order("position", { ascending: true })
          .order("created_at", { ascending: true });
        if (!esRes.error) {
          const map: Record<string, EventStructureItemRow[]> = {};
          (esRes.data ?? []).forEach((r: any) => {
            const eid = String(r.event_id ?? "");
            if (!eid) return;
            if (!map[eid]) map[eid] = [];
            map[eid].push(r as EventStructureItemRow);
          });
          setEventStructureByEventId(map);
        } else {
          setEventStructureByEventId({});
        }
      } else {
        setEventStructureByEventId({});
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

      // group names (via server endpoint to avoid coach_groups RLS blocking on client)
      const groupIds = Array.from(
        new Set(events.map((e) => uuidOrNull(e.group_id)).filter((x): x is string => typeof x === "string" && x.length > 0))
      );
      if (groupIds.length > 0) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) {
          setGroupNameById({});
        } else {
          const query = new URLSearchParams({
            ids: groupIds.join(","),
            child_id: uid,
          });
          const gRes = await fetch(`/api/player/group-names?${query.toString()}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          const gJson = await gRes.json().catch(() => ({}));
          if (!gRes.ok) {
            setGroupNameById({});
          } else {
            const map: Record<string, string> = {};
            ((gJson?.groups ?? []) as Array<{ id: string; name: string | null }>).forEach((g) => {
              map[g.id] = g.name ?? "Groupe";
            });
            setGroupNameById(map);
          }
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
      setAttendeeStatusByEventId({});
      setCompetitionEvents([]);
      setClubNameById({});
      setGroupNameById({});
      setItemsBySessionId({});
      setEventStructureByEventId({});
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
  }, [filterMode, plannedTypeFilter]);

  useEffect(() => {
    const type = String(searchParams.get("type") ?? "").trim().toLowerCase();
    if (!type) return;

    const allowed: PlannedTypeFilter[] = [
      "all",
      "training",
      "interclub",
      "camp",
      "session",
      "event",
      "competition",
      "club",
      "private",
      "individual",
    ];

    if (allowed.includes(type as PlannedTypeFilter)) {
      setPlannedTypeFilter(type as PlannedTypeFilter);
      setFilterMode("planned");
    }
  }, [searchParams]);

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

  async function updateTrainingAttendance(event: PlannedEventRow, nextStatus: "present" | "absent") {
    if (!effectiveUserId || attendanceBusyEventId) return;
    setAttendanceBusyEventId(event.id);
    setError(null);

    const upd = await supabase
      .from("club_event_attendees")
      .update({ status: nextStatus })
      .eq("event_id", event.id)
      .eq("player_id", effectiveUserId);

    if (upd.error) {
      setError(upd.error.message);
      setAttendanceBusyEventId("");
      return;
    }

    setAttendeeStatusByEventId((prev) => ({ ...prev, [event.id]: nextStatus }));

    try {
      const coachRecipientIds = await getEventCoachUserIds(event.id, event.group_id);
      if (coachRecipientIds.length > 0 && viewerUserId) {
        const localeKey = locale === "fr" ? "fr" : "en";
        const type = eventTypeLabel(event.event_type, localeKey);
        const eventEnd = event.ends_at ?? new Date(new Date(event.starts_at).getTime() + Math.max(1, event.duration_minutes) * 60_000).toISOString();
        if (nextStatus === "absent") {
          const msg = await getNotificationMessage("notif.playerMarkedAbsent", localeKey, {
            playerName: effectivePlayerName || "Joueur",
            eventType: type,
            dateTime: `${fmtDateTime(event.starts_at)} → ${fmtDateTime(eventEnd)}`,
          });
          await createAppNotification({
            actorUserId: viewerUserId,
            kind: "player_marked_absent",
            title: msg.title,
            body: msg.body,
            data: { event_id: event.id, group_id: event.group_id, url: `/coach/groups/${event.group_id ?? ""}/planning/${event.id}` },
            recipientUserIds: coachRecipientIds,
          });
        } else {
          await createAppNotification({
            actorUserId: viewerUserId,
            kind: "player_marked_present",
            title: locale === "fr" ? "Présence confirmée" : "Attendance confirmed",
            body:
              locale === "fr"
                ? `${effectivePlayerName || "Joueur"} présent · ${type} · ${fmtDateTime(event.starts_at)}`
                : `${effectivePlayerName || "Player"} present · ${type} · ${fmtDateTime(event.starts_at)}`,
            data: { event_id: event.id, group_id: event.group_id, url: `/coach/groups/${event.group_id ?? ""}/planning/${event.id}` },
            recipientUserIds: coachRecipientIds,
          });
        }
      }
    } catch {
      // ignore notification errors, attendance status was updated successfully.
    }

    setAttendanceBusyEventId("");
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
                    <input
                      type="date"
                      value={compStartDate}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCompStartDate(next);
                        setCompEndDate(next);
                      }}
                    />
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
                      : locale === "fr"
                      ? "Ajouter à l'agenda"
                      : "Add to calendar"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div
            style={{
              border: "1px solid rgba(0,0,0,0.10)",
              borderRadius: 12,
              background: "rgba(255,255,255,0.70)",
              padding: 12,
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>
              <Filter size={14} />
              {locale === "fr" ? "Filtrer mon activité" : "Filter my activity"}
            </div>

            <select
              value={plannedTypeFilter}
              onChange={(e) => setPlannedTypeFilter(e.target.value as PlannedTypeFilter)}
              disabled={loading}
            >
              <option value="all">{locale === "fr" ? "Tous" : "All"}</option>
              <option value="training">{locale === "fr" ? "Entraînement" : "Training"}</option>
              <option value="interclub">{locale === "fr" ? "Interclubs" : "Interclub"}</option>
              <option value="camp">{locale === "fr" ? "Stage" : "Camp"}</option>
              <option value="session">{locale === "fr" ? "Réunion" : "Session"}</option>
              <option value="event">{locale === "fr" ? "Événement" : "Event"}</option>
              <option value="competition">{locale === "fr" ? "Compétition" : "Competition"}</option>
              <option value="club">{locale === "fr" ? "Entraînement club" : "Club training"}</option>
              <option value="private">{locale === "fr" ? "Cours privé" : "Private lesson"}</option>
              <option value="individual">{locale === "fr" ? "Entraînement individuel" : "Individual training"}</option>
            </select>

            <div style={{ display: "inline-flex", width: "100%", border: "1px solid rgba(0,0,0,0.14)", borderRadius: 10, overflow: "hidden" }}>
              <button
                type="button"
                className={`btn ${filterMode === "past" ? "btn-active-dark" : ""}`}
                onClick={() => setFilterMode("past")}
                disabled={loading}
                style={{ borderRadius: 0, border: "none", fontWeight: 900, width: "50%" }}
              >
                {locale === "fr" ? "Passés" : "Past"} ({pastCount})
              </button>
              <button
                type="button"
                className={`btn ${filterMode === "planned" ? "btn-active-dark" : ""}`}
                onClick={() => setFilterMode("planned")}
                disabled={loading}
                style={{ borderRadius: 0, border: "none", fontWeight: 900, width: "50%" }}
              >
                {locale === "fr" ? "À venir" : "Upcoming"} ({plannedCount})
              </button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : totalCount === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("trainings.nonePlanned")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {pagedItems.map((item) => {
                  if (item.kind === "event") {
                    const e = item.event;
                    const clubName = clubNameById[e.club_id] ?? t("common.club");
                    const groupName = e.group_id ? groupNameById[e.group_id] : null;
                    const eventEnd =
                      e.ends_at ??
                      new Date(new Date(e.starts_at).getTime() + Math.max(1, Number(e.duration_minutes ?? 0)) * 60_000).toISOString();
                    const isMultiDay = !sameDay(e.starts_at, eventEnd);
                    const eventType = eventTypeLabel(e.event_type, locale === "fr" ? "fr" : "en");
                    const attendanceStatus = attendeeStatusByEventId[e.id] ?? null;
                    const isTraining = e.event_type === "training";
                    const isCollapsedTraining = isTraining && attendanceStatus === "absent";
                    const canShowStructureAction = isTraining && attendanceStatus !== "absent";
                    const eventStructure = eventStructureByEventId[e.id] ?? [];
                    const showEventStructure = isTraining && attendanceStatus === "present" && eventStructure.length > 0;
                    let eventTitle = eventType;
                    const customName = (e.title ?? "").trim();
                    if (e.event_type === "training") {
                      const trainingGroupLabel =
                        groupName ||
                        (locale === "fr" ? "Groupe" : "Group");
                      eventTitle = `${locale === "fr" ? "Entraînement" : "Training"} • ${trainingGroupLabel}`;
                    }
                    if (e.event_type !== "training") {
                      eventTitle = customName ? `${eventType} • ${customName}` : eventType;
                    }

                    return (
                      <div
                        key={item.key}
                        className="marketplace-item"
                        style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}
                      >
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div
                              style={{
                                display: "grid",
                                gap: 2,
                                fontSize: 12,
                                fontWeight: 950,
                                color: "rgba(0,0,0,0.82)",
                              }}
                            >
                              {isMultiDay ? (
                                <div>
                                  {fmtDateLabelNoTime(e.starts_at, locale === "fr" ? "fr" : "en")} {locale === "fr" ? "au" : "to"} {fmtDateLabelNoTime(eventEnd, locale === "fr" ? "fr" : "en")}
                                </div>
                              ) : (
                                <div>
                                  {fmtDateLabelNoTime(e.starts_at, locale === "fr" ? "fr" : "en")}{" "}
                                  <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                                    {locale === "fr"
                                      ? `• de ${fmtHourLabel(e.starts_at, "fr")} à ${fmtHourLabel(eventEnd, "fr")}`
                                      : `• from ${fmtHourLabel(e.starts_at, "en")} to ${fmtHourLabel(eventEnd, "en")}`}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="hr-soft" style={{ margin: "1px 0" }} />

                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                              <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                                {eventTitle}
                              </div>
                              {isTraining && !isCollapsedTraining ? (
                                <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.58)" }} className="truncate">
                                  {locale === "fr" ? "Organisé par" : "Organized by"} {clubName}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {!isCollapsedTraining ? (
                            <>
                              {e.location_text ? (
                                <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                                  📍 {e.location_text}
                                </div>
                              ) : null}

                              {showEventStructure ? <div className="hr-soft" style={{ margin: "2px 0" }} /> : null}

                              {showEventStructure ? (
                                <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                                  {eventStructure.map((p, i) => {
                                    const extra = (p.note ?? "").trim();
                                    return (
                                      <li key={`${p.event_id}-${i}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                                        {categoryLabel(p.category)} — {p.minutes} min
                                        {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : null}

                            </>
                          ) : null}

                          {isTraining ? (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 8,
                                flexWrap: "wrap",
                                alignItems: "center",
                              }}
                            >
                              {canShowStructureAction ? (
                                <Link className="btn" href={`/player/golf/trainings/new?club_event_id=${e.id}`}>
                                  <ListChecks size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                                  {locale === "fr" ? "Structurer" : "Structure"}
                                </Link>
                              ) : (
                                <span />
                              )}

                              <button
                                type="button"
                                aria-label={locale === "fr" ? "Basculer présence" : "Toggle attendance"}
                                role="switch"
                                aria-checked={attendanceStatus === "present"}
                                onClick={() => updateTrainingAttendance(e, attendanceStatus === "present" ? "absent" : "present")}
                                disabled={attendanceBusyEventId === e.id}
                                style={{
                                  width: 114,
                                  height: 24,
                                  borderRadius: 999,
                                  border: "1px solid rgba(0,0,0,0.14)",
                                  background: "rgba(0,0,0,0.16)",
                                  padding: 0,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  transition: "all 180ms ease",
                                  cursor: attendanceBusyEventId === e.id ? "wait" : "pointer",
                                  flex: "0 0 auto",
                                  position: "relative",
                                  overflow: "hidden",
                                }}
                              >
                                <span
                                  aria-hidden
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    bottom: 0,
                                    width: "50%",
                                    left: attendanceStatus === "present" ? "50%" : 0,
                                    background: attendanceStatus === "present" ? "#52b47f" : "#ea7f77",
                                    borderTopLeftRadius: attendanceStatus === "present" ? 0 : 999,
                                    borderBottomLeftRadius: attendanceStatus === "present" ? 0 : 999,
                                    borderTopRightRadius: attendanceStatus === "present" ? 999 : 0,
                                    borderBottomRightRadius: attendanceStatus === "present" ? 999 : 0,
                                  }}
                                />
                                <span
                                  style={{
                                    position: "absolute",
                                    left: 8,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    fontSize: 9,
                                    fontWeight: 900,
                                    color: attendanceStatus === "present" ? "rgba(255,255,255,0.72)" : "#fff",
                                    letterSpacing: 0.2,
                                    textTransform: "uppercase",
                                  }}
                                >
                                  {locale === "fr" ? "Absent" : "Absent"}
                                </span>
                                <span
                                  style={{
                                    position: "absolute",
                                    right: 6,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    fontSize: 9,
                                    fontWeight: 900,
                                    color: attendanceStatus === "present" ? "#fff" : "rgba(255,255,255,0.72)",
                                    letterSpacing: 0.2,
                                    textTransform: "uppercase",
                                    minWidth: 44,
                                    textAlign: "right",
                                  }}
                                >
                                  {locale === "fr" ? "Présent" : "Present"}
                                </span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }

                  if (item.kind === "competition") {
                    const c = item.competition;
                    const typeLabelComp =
                      c.event_type === "camp"
                        ? locale === "fr"
                          ? "Stage"
                          : "Camp"
                        : locale === "fr"
                        ? "Compétition"
                        : "Competition";
                    const competitionTitle = `${typeLabelComp}${(c.title ?? "").trim() ? ` • ${(c.title ?? "").trim()}` : ""}`;
                    return (
                      <div
                        key={item.key}
                        className="marketplace-item"
                        style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}
                      >
                        <div style={{ display: "grid", gap: 10 }}>
                          <div
                            style={{
                              display: "grid",
                              gap: 2,
                              fontSize: 12,
                              fontWeight: 950,
                              color: "rgba(0,0,0,0.82)",
                            }}
                          >
                            {sameDay(c.starts_at, c.ends_at) ? (
                              <div>{fmtDateLabelNoTime(c.starts_at, locale === "fr" ? "fr" : "en")}</div>
                            ) : (
                              <div>
                                {fmtDateLabelNoTime(c.starts_at, locale === "fr" ? "fr" : "en")} {locale === "fr" ? "au" : "to"} {fmtDateLabelNoTime(c.ends_at, locale === "fr" ? "fr" : "en")}
                              </div>
                            )}
                          </div>
                          <div className="hr-soft" style={{ margin: "1px 0" }} />
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                              {competitionTitle}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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
                  const postes = itemsBySessionId[s.id] ?? [];
                  const linkedEvent = s.club_event_id
                    ? attendeeEvents.find((ev) => ev.id === s.club_event_id) ?? null
                    : null;
                  const groupName = linkedEvent?.group_id ? groupNameById[linkedEvent.group_id] ?? null : null;
                  const trainingGroupLabel = groupName || clubName || (locale === "fr" ? "Groupe" : "Group");
                  const durationFromPostes = postes.reduce((acc, p) => acc + Math.max(0, Number(p.minutes ?? 0)), 0);
                  const sessionDuration = Math.max(1, Number(s.total_minutes ?? 0) || durationFromPostes || 0);
                  const sessionEnd = new Date(new Date(s.start_at).getTime() + sessionDuration * 60_000).toISOString();
                  const isMultiDaySession = !sameDay(s.start_at, sessionEnd);
                  const displayLocation = (s.location_text ?? linkedEvent?.location_text ?? "").trim();
                  const sessionTitle =
                    s.session_type === "club"
                      ? `${locale === "fr" ? "Entraînement" : "Training"} • ${trainingGroupLabel}`
                      : `${typeLabel(s.session_type, locale === "fr" ? "fr" : "en")}`;

                  return (
                    <Link key={item.key} href={`/player/golf/trainings/${s.id}`} className="marketplace-link">
                      <div className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}>
                        <div style={{ display: "grid", gap: 10 }}>
                          <div
                            style={{
                              display: "grid",
                              gap: 2,
                              fontSize: 12,
                              fontWeight: 950,
                              color: "rgba(0,0,0,0.82)",
                            }}
                          >
                            {isMultiDaySession ? (
                              <div>
                                {fmtDateLabelNoTime(s.start_at, locale === "fr" ? "fr" : "en")} {locale === "fr" ? "au" : "to"} {fmtDateLabelNoTime(sessionEnd, locale === "fr" ? "fr" : "en")}
                              </div>
                            ) : null}
                            {!isMultiDaySession ? (
                              <div>
                                {fmtDateLabelNoTime(s.start_at, locale === "fr" ? "fr" : "en")}{" "}
                                <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                                  {locale === "fr"
                                    ? `• de ${fmtHourLabel(s.start_at, "fr")} à ${fmtHourLabel(sessionEnd, "fr")}`
                                    : `• from ${fmtHourLabel(s.start_at, "en")} to ${fmtHourLabel(sessionEnd, "en")}`}
                                </span>
                              </div>
                            ) : null}
                          </div>

                          <div className="hr-soft" style={{ margin: "1px 0" }} />

                          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                            <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                              {sessionTitle}
                            </div>
                            {s.session_type === "club" && clubName ? (
                              <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.58)" }} className="truncate">
                                {locale === "fr" ? "Organisé par" : "Organized by"} {clubName}
                              </div>
                            ) : null}
                          </div>

                          {displayLocation ? (
                            <div className="truncate" style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }}>
                              📍 {displayLocation}
                            </div>
                          ) : null}

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
                              <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              {locale === "fr" ? "Éditer" : "Edit"}
                            </Link>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {totalCount > 0 && (
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
