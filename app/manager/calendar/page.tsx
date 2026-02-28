"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

type CalendarView = "month" | "week" | "day";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  location_text: string | null;
  coach_note: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type ManagedClub = { id: string; name: string | null };
type CalendarGroupRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
  is_archived: boolean;
  head_coach_user_id: string | null;
  head_coach_name: string | null;
};
type MemberLite = {
  user_id: string;
  role: "manager" | "coach" | "player" | "parent";
  is_active: boolean | null;
  profiles?: { first_name: string | null; last_name: string | null } | null;
};

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
  const diff = (day + 6) % 7; // Monday start
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

function timeLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function dateTimeLabel(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function monthLabel(d: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);
}

function dayHeaderLabel(d: Date, locale: string) {
  const raw = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(d);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function eventTypeLabel(v: EventRow["event_type"], locale: "fr" | "en") {
  if (locale === "en") {
    if (v === "training") return "Training";
    if (v === "interclub") return "Interclub";
    if (v === "camp") return "Camp";
    if (v === "session") return "Session";
    return "Event";
  }
  if (v === "training") return "Entraînement";
  if (v === "interclub") return "Interclub";
  if (v === "camp") return "Stage";
  if (v === "session") return "Séance";
  return "Événement";
}

function eventTypeColor(v: EventRow["event_type"]) {
  if (v === "training") return { bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.48)", text: "rgba(20,83,45,1)" };
  if (v === "interclub") return { bg: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.46)", text: "rgba(30,64,175,1)" };
  if (v === "camp") return { bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.50)", text: "rgba(120,53,15,1)" };
  if (v === "session") return { bg: "rgba(168,85,247,0.16)", border: "rgba(168,85,247,0.46)", text: "rgba(88,28,135,1)" };
  return { bg: "rgba(15,23,42,0.10)", border: "rgba(15,23,42,0.24)", text: "rgba(15,23,42,1)" };
}

function overlapsDay(e: EventRow, d: Date) {
  const s = new Date(e.starts_at).getTime();
  const eTime = new Date(e.ends_at ?? e.starts_at).getTime();
  const ds = startOfDay(d).getTime();
  const de = endOfDay(d).getTime();
  return s <= de && eTime >= ds;
}

export default function CoachCalendarPage() {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);
  const dateLocale = locale === "fr" ? "fr-CH" : "en-US";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [groupHeadCoachNames, setGroupHeadCoachNames] = useState<Record<string, string>>({});
  const [groupFilterOptions, setGroupFilterOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [clubNames, setClubNames] = useState<Record<string, string>>({});
  const [attendeeByEvent, setAttendeeByEvent] = useState<Record<string, string[]>>({});
  const [playerNameById, setPlayerNameById] = useState<Record<string, string>>({});
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [playerFilter, setPlayerFilter] = useState<string>("all");

  const [view, setView] = useState<CalendarView>("month");
  const [anchorDate, setAnchorDate] = useState<Date>(new Date());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const filteredEvents = useMemo(() => {
    let list = events;
    if (groupFilter !== "all") {
      list = list.filter((e) => e.group_id === groupFilter);
    }
    if (playerFilter !== "all") {
      list = list.filter((e) => (attendeeByEvent[e.id] ?? []).includes(playerFilter));
    }
    return list;
  }, [events, groupFilter, playerFilter, attendeeByEvent]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr || !auth.user) throw new Error("Session invalide.");
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) throw new Error(locale === "en" ? "Invalid session" : "Session invalide.");

        const clubsRes = await fetch("/api/manager/my-clubs", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const clubsJson = await clubsRes.json().catch(() => ({}));
        if (!clubsRes.ok) throw new Error(String(clubsJson?.error ?? "Could not load clubs."));

        const managedClubs = (Array.isArray(clubsJson?.clubs) ? clubsJson.clubs : []) as ManagedClub[];
        const clubIds = Array.from(new Set(managedClubs.map((c) => String(c?.id ?? "").trim()).filter(Boolean)));

        if (clubIds.length === 0) {
          setEvents([]);
          setGroupNames({});
          setGroupHeadCoachNames({});
          setClubNames({});
          setAttendeeByEvent({});
          setPlayerNameById({});
          setLoading(false);
          return;
        }

        const calendarRes = await fetch("/api/manager/events/calendar", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const calendarJson = await calendarRes.json().catch(() => ({}));
        if (!calendarRes.ok) throw new Error(String(calendarJson?.error ?? "Could not load calendar events."));
        const merged = ((Array.isArray(calendarJson?.events) ? calendarJson.events : []) as EventRow[]).sort(
          (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
        );
        setEvents(merged);

        const groupMap: Record<string, string> = {};
        const groupHeadCoachMap: Record<string, string> = {};
        const groups = (Array.isArray(calendarJson?.groups) ? calendarJson.groups : []) as CalendarGroupRow[];
        groups.forEach((g) => {
          groupMap[g.id] = String(g?.name ?? (locale === "en" ? "Group" : "Groupe"));
          const head = String(g.head_coach_name ?? "").trim();
          if (head) groupHeadCoachMap[g.id] = head;
        });
        setGroupNames(groupMap);
        setGroupHeadCoachNames(groupHeadCoachMap);
        setGroupFilterOptions(
          groups
            .filter((g) => !g.is_archived)
            .map((g) => {
              const base = String(g.name ?? (locale === "en" ? "Group" : "Groupe"));
              const head = String(g.head_coach_name ?? "").trim();
              return {
                id: g.id,
                label: head ? `${base} (${head})` : base,
              };
            })
            .sort((a, b) => a.label.localeCompare(b.label, dateLocale))
        );

        const clubMap: Record<string, string> = {};
        (Array.isArray(calendarJson?.clubs) ? calendarJson.clubs : []).forEach((c: any) => {
          clubMap[c.id] = String(c?.name ?? "Club");
        });
        setClubNames(clubMap);

        const map: Record<string, string[]> = {};
        (Array.isArray(calendarJson?.attendees) ? calendarJson.attendees : []).forEach((r: any) => {
          const eventId = String(r.event_id ?? "").trim();
          const playerId = String(r.player_id ?? "").trim();
          if (!eventId || !playerId) return;
          if (!map[eventId]) map[eventId] = [];
          if (!map[eventId].includes(playerId)) map[eventId].push(playerId);
        });
        setAttendeeByEvent(map);

        const membersByClubRes = await Promise.all(
          clubIds.map(async (clubId) => {
            const res = await fetch(`/api/manager/clubs/${clubId}/members`, {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            const json = await res.json().catch(() => ({}));
            return { ok: res.ok, members: (json?.members ?? []) as MemberLite[] };
          })
        );
        const playerNames: Record<string, string> = {};
        membersByClubRes.forEach((row) => {
          if (!row.ok) return;
          row.members
            .filter((m) => m.role === "player" && m.is_active)
            .forEach((m) => {
              const id = String(m.user_id ?? "").trim();
              if (!id || playerNames[id]) return;
              const first = m.profiles?.first_name ?? null;
              const last = m.profiles?.last_name ?? null;
              playerNames[id] = `${first ?? ""} ${last ?? ""}`.trim() || id;
            });
        });
        setPlayerNameById(playerNames);
        setLoading(false);
      } catch (e: any) {
        setError(e?.message ?? (locale === "en" ? "Loading error" : "Erreur chargement"));
        setEvents([]);
        setGroupNames({});
        setGroupHeadCoachNames({});
        setGroupFilterOptions([]);
        setClubNames({});
        setAttendeeByEvent({});
        setPlayerNameById({});
        setLoading(false);
      }
    })();
  }, [locale]);

  function eventMetaLabel(e: EventRow) {
    const eventTitle = String(e.title ?? "").trim();
    const groupName = groupNames[e.group_id] ?? tr("Groupe", "Group");
    const base = eventTitle || groupName;
    const head = String(groupHeadCoachNames[e.group_id] ?? "").trim();
    return head ? `${base} (${head})` : base;
  }

  useEffect(() => {
    if (groupFilter === "all") return;
    if (!groupFilterOptions.some((g) => g.id === groupFilter)) {
      setGroupFilter("all");
    }
  }, [groupFilter, groupFilterOptions]);

  const daysInMonthGrid = useMemo(() => {
    const first = startOfMonth(anchorDate);
    const last = endOfMonth(anchorDate);
    const from = startOfWeek(first);
    const to = endOfWeek(last);
    const out: Date[] = [];
    for (let d = new Date(from); d.getTime() <= to.getTime(); d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }, [anchorDate]);

  const weekDays = useMemo(() => {
    const from = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, i) => addDays(from, i));
  }, [anchorDate]);

  const dayEvents = useMemo(
    () =>
      filteredEvents
        .filter((e) => overlapsDay(e, anchorDate))
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [anchorDate, filteredEvents]
  );

  const eventsByYmd = useMemo(() => {
    const map: Record<string, EventRow[]> = {};
    for (const e of filteredEvents) {
      const start = startOfDay(new Date(e.starts_at));
      const end = startOfDay(new Date(e.ends_at ?? e.starts_at));
      for (let d = new Date(start); d.getTime() <= end.getTime(); d = addDays(d, 1)) {
        const k = ymd(d);
        if (!map[k]) map[k] = [];
        map[k].push(e);
      }
    }
    Object.values(map).forEach((list) => list.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()));
    return map;
  }, [filteredEvents]);

  function goPrev() {
    if (view === "month") setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    else if (view === "week") setAnchorDate((d) => addDays(d, -7));
    else setAnchorDate((d) => addDays(d, -1));
  }

  function goNext() {
    if (view === "month") setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    else if (view === "week") setAnchorDate((d) => addDays(d, 7));
    else setAnchorDate((d) => addDays(d, 1));
  }

  function goToday() {
    setAnchorDate(new Date());
  }

  const weekRangeLabel = useMemo(() => {
    const from = startOfWeek(anchorDate);
    const to = addDays(from, 6);
    return `${dayHeaderLabel(from, dateLocale)} - ${dayHeaderLabel(to, dateLocale)}`;
  }, [anchorDate, dateLocale]);

  const headerLabel =
    view === "month" ? monthLabel(anchorDate, dateLocale) : view === "week" ? weekRangeLabel : dayHeaderLabel(anchorDate, dateLocale);
  const todayKey = ymd(new Date());
  const segmentWrapStyle: React.CSSProperties = {
    display: "inline-flex",
    border: "1px solid rgba(0,0,0,0.14)",
    borderRadius: 10,
    overflow: "hidden",
    background: "rgba(255,255,255,0.78)",
  };
  const segmentBtnStyle = (active: boolean, rightBorder = false): React.CSSProperties => ({
    border: "none",
    borderRight: rightBorder ? "1px solid rgba(0,0,0,0.12)" : "none",
    borderRadius: 0,
    background: active ? "rgba(55,65,81,1)" : "rgba(229,231,235,1)",
    color: active ? "#fff" : "rgba(17,24,39,1)",
    fontWeight: 900,
    fontSize: 12,
    lineHeight: 1.1,
    padding: "7px 10px",
    cursor: "pointer",
  });
  const detailCardStyle: React.CSSProperties = {
    border: "1px solid rgba(0,0,0,0.10)",
    borderRadius: 10,
    background: "rgba(255,255,255,0.78)",
    padding: 10,
    display: "grid",
    gap: 8,
  };

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              <CalendarDays size={18} style={{ verticalAlign: "middle", marginRight: 8 }} />
              {tr("Gestion des événements", "Event management")}
            </div>
            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/manager/events/new">
                {tr("Ajouter un événement", "Add event")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section" style={{ display: "grid", gap: 14 }}>
          <div className="glass-card" style={{ padding: 12, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={segmentWrapStyle}>
                <button onClick={() => setView("month")} style={segmentBtnStyle(view === "month", true)}>{tr("Mois", "Month")}</button>
                <button onClick={() => setView("week")} style={segmentBtnStyle(view === "week", true)}>{tr("Semaine", "Week")}</button>
                <button onClick={() => setView("day")} style={segmentBtnStyle(view === "day")}>{tr("Jour", "Day")}</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.75 }}>{tr("Groupe", "Group")}</span>
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  className="input"
                >
                  <option value="all">{tr("Tous les groupes", "All groups")}</option>
                  {groupFilterOptions.map((g) => (
                      <option key={g.id} value={g.id}>{g.label}</option>
                    ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 900, opacity: 0.75 }}>{tr("Joueur", "Player")}</span>
                <select
                  value={playerFilter}
                  onChange={(e) => setPlayerFilter(e.target.value)}
                  className="input"
                >
                  <option value="all">{tr("Tous les joueurs", "All players")}</option>
                  {Object.entries(playerNameById)
                    .sort((a, b) => a[1].localeCompare(b[1], dateLocale))
                    .map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                </select>
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <button className="btn" onClick={goPrev} aria-label={tr("Précédent", "Previous")}>
                  <ChevronLeft size={16} />
                </button>
                <button className="btn" onClick={goToday}>{tr("Aujourd’hui", "Today")}</button>
                <button className="btn" onClick={goNext} aria-label={tr("Suivant", "Next")}>
                  <ChevronRight size={16} />
                </button>
              </div>
              <div style={{ fontSize: 16, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>{headerLabel}</div>
            </div>
          </div>

          {loading ? (
            <div className="glass-card" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{tr("Chargement...", "Loading...")}</div>
          ) : (
            <>
              {view === "month" ? (
                <div className="glass-card" style={{ padding: 10 }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    {daysInMonthGrid
                      .filter((d) => d.getMonth() === anchorDate.getMonth())
                      .map((d) => {
                        const k = ymd(d);
                        const isToday = k === todayKey;
                        const list = eventsByYmd[k] ?? [];
                        return (
                          <div
                            key={k}
                            style={{
                              border: isToday ? "2px solid rgba(34,197,94,0.75)" : "1px solid rgba(0,0,0,0.10)",
                              borderRadius: 12,
                              background: "rgba(255,255,255,0.76)",
                              padding: 10,
                              display: "grid",
                              gap: 6,
                              boxShadow: isToday ? "0 0 0 2px rgba(34,197,94,0.16) inset" : undefined,
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.78)" }}>{dayHeaderLabel(d, dateLocale)}</div>
                            {list.length > 0
                              ? list.map((e) => {
                                  const tone = eventTypeColor(e.event_type);
                                  const isSelected = selectedEventId === e.id;
                                  return (
                                    <div key={e.id} style={{ display: "grid", gap: 6 }}>
                                      <button
                                        type="button"
                                        onClick={() => setSelectedEventId((prev) => (prev === e.id ? null : e.id))}
                                        style={{
                                          textAlign: "left",
                                          border: `1px solid ${tone.border}`,
                                          borderRadius: 8,
                                          background: tone.bg,
                                          color: tone.text,
                                          fontSize: 11,
                                          fontWeight: 900,
                                          padding: "5px 7px",
                                          cursor: "pointer",
                                        }}
                                      >
                                        {timeLabel(e.starts_at, dateLocale)} · {eventTypeLabel(e.event_type, locale)} · {eventMetaLabel(e)}
                                      </button>
                                      {isSelected ? (
                                        <div style={detailCardStyle}>
                                          {e.title?.trim() ? (
                                            <div style={{ fontSize: 14, fontWeight: 980, color: "rgba(0,0,0,0.88)" }}>{e.title}</div>
                                          ) : null}
                                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                            <span className="pill-soft">{eventTypeLabel(e.event_type, locale)}</span>
                                            <span className="pill-soft">{eventMetaLabel(e)}</span>
                                            <span className="pill-soft">{clubNames[e.club_id] ?? tr("Club", "Club")}</span>
                                          </div>
                                          <div style={{ fontSize: 13, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>{dateTimeLabel(e.starts_at, dateLocale)}</div>
                                          {e.ends_at ? (
                                            <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>
                                              {tr("Fin", "End")}: {dateTimeLabel(e.ends_at, dateLocale)}
                                            </div>
                                          ) : null}
                                          {e.location_text ? <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>📍 {e.location_text}</div> : null}
                                          {e.coach_note ? (
                                            <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 10, background: "rgba(255,255,255,0.72)", padding: 8, fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)", whiteSpace: "pre-wrap" }}>
                                              {e.coach_note}
                                            </div>
                                          ) : null}
                                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                            <Link className="cta-green cta-green-inline" href={`/manager/groups/${e.group_id}/planning/${e.id}`}>
                                              {tr("Accéder à l’événement", "Open event")}
                                            </Link>
                                          </div>
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })
                              : null}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ) : null}

              {view === "week" ? (
                <div className="glass-card" style={{ padding: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                    {weekDays.map((d) => {
                      const k = ymd(d);
                      const isToday = k === todayKey;
                      const list = eventsByYmd[k] ?? [];
                      return (
                        <div
                          key={k}
                          style={{
                            border: isToday ? "2px solid rgba(34,197,94,0.75)" : "1px solid rgba(0,0,0,0.10)",
                            borderRadius: 12,
                            background: "rgba(255,255,255,0.76)",
                            padding: 8,
                            minHeight: 170,
                            display: "grid",
                            gap: 6,
                            boxShadow: isToday ? "0 0 0 2px rgba(34,197,94,0.16) inset" : undefined,
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>{dayHeaderLabel(d, dateLocale)}</div>
                          {list.map((e) => {
                            const tone = eventTypeColor(e.event_type);
                            const isSelected = selectedEventId === e.id;
                            return (
                              <div key={e.id} style={{ display: "grid", gap: 6 }}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedEventId((prev) => (prev === e.id ? null : e.id))}
                                  style={{
                                    textAlign: "left",
                                    border: `1px solid ${tone.border}`,
                                    borderRadius: 8,
                                    background: tone.bg,
                                    color: tone.text,
                                    fontSize: 11,
                                    fontWeight: 900,
                                    padding: "4px 6px",
                                    cursor: "pointer",
                                  }}
                                >
                                  {timeLabel(e.starts_at, dateLocale)} · {eventTypeLabel(e.event_type, locale)} · {eventMetaLabel(e)}
                                </button>
                                {isSelected ? (
                                  <div style={detailCardStyle}>
                                    {e.title?.trim() ? (
                                      <div style={{ fontSize: 14, fontWeight: 980, color: "rgba(0,0,0,0.88)" }}>{e.title}</div>
                                    ) : null}
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                      <span className="pill-soft">{eventTypeLabel(e.event_type, locale)}</span>
                                      <span className="pill-soft">{eventMetaLabel(e)}</span>
                                      <span className="pill-soft">{clubNames[e.club_id] ?? tr("Club", "Club")}</span>
                                    </div>
                                    <div style={{ fontSize: 13, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>{dateTimeLabel(e.starts_at, dateLocale)}</div>
                                    {e.ends_at ? (
                                      <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>
                                        {tr("Fin", "End")}: {dateTimeLabel(e.ends_at, dateLocale)}
                                      </div>
                                    ) : null}
                                    {e.location_text ? <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>📍 {e.location_text}</div> : null}
                                    {e.coach_note ? (
                                      <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 10, background: "rgba(255,255,255,0.72)", padding: 8, fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)", whiteSpace: "pre-wrap" }}>
                                        {e.coach_note}
                                      </div>
                                    ) : null}
                                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                      <Link className="cta-green cta-green-inline" href={`/manager/groups/${e.group_id}/planning/${e.id}`}>
                                        {tr("Accéder à l’événement", "Open event")}
                                      </Link>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {view === "day" ? (
                <div className="glass-card" style={{ padding: 12, display: "grid", gap: 10 }}>
                  {dayEvents.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{tr("Aucun événement ce jour.", "No event this day.")}</div>
                  ) : (
                    dayEvents.map((e) => {
                      const tone = eventTypeColor(e.event_type);
                      const isSelected = selectedEventId === e.id;
                      return (
                        <div key={e.id} style={{ display: "grid", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => setSelectedEventId((prev) => (prev === e.id ? null : e.id))}
                            style={{
                              textAlign: "left",
                              border: `1px solid ${tone.border}`,
                              borderRadius: 12,
                              background: tone.bg,
                              color: tone.text,
                              padding: 10,
                              display: "grid",
                              gap: 4,
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 950 }}>{timeLabel(e.starts_at, dateLocale)} · {eventTypeLabel(e.event_type, locale)}</div>
                            <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.85 }}>{eventMetaLabel(e)}</div>
                          </button>
                          {isSelected ? (
                            <div style={detailCardStyle}>
                              {e.title?.trim() ? (
                                <div style={{ fontSize: 14, fontWeight: 980, color: "rgba(0,0,0,0.88)" }}>{e.title}</div>
                              ) : null}
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                <span className="pill-soft">{eventTypeLabel(e.event_type, locale)}</span>
                                <span className="pill-soft">{eventMetaLabel(e)}</span>
                                <span className="pill-soft">{clubNames[e.club_id] ?? tr("Club", "Club")}</span>
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>{dateTimeLabel(e.starts_at, dateLocale)}</div>
                              {e.ends_at ? (
                                <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>
                                  {tr("Fin", "End")}: {dateTimeLabel(e.ends_at, dateLocale)}
                                </div>
                              ) : null}
                              {e.location_text ? <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>📍 {e.location_text}</div> : null}
                              {e.coach_note ? (
                                <div style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 10, background: "rgba(255,255,255,0.72)", padding: 8, fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)", whiteSpace: "pre-wrap" }}>
                                  {e.coach_note}
                                </div>
                              ) : null}
                              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                <Link className="cta-green cta-green-inline" href={`/manager/groups/${e.group_id}/planning/${e.id}`}>
                                  {tr("Accéder à l’événement", "Open event")}
                                </Link>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
