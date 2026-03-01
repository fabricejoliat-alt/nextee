"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

type DisplayMode = "list" | "calendar";
type CalendarView = "week" | "day";

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

function dateLabelNoTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function sameDay(aIso: string, bIso: string | null) {
  if (!bIso) return true;
  const a = new Date(aIso);
  const b = new Date(bIso);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
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
  const [clubNames, setClubNames] = useState<Record<string, string>>({});

  const [mode, setMode] = useState<DisplayMode>("list");
  const [view, setView] = useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = useState<Date>(new Date());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [listPage, setListPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) throw new Error("Session invalide.");

        const res = await fetch("/api/coach/events/calendar", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Erreur chargement"));

        setEvents((json?.events ?? []) as EventRow[]);
        setGroupNames((json?.groupNameById ?? {}) as Record<string, string>);
        setClubNames((json?.clubNameById ?? {}) as Record<string, string>);

        setLoading(false);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : locale === "en" ? "Loading error" : "Erreur chargement");
        setEvents([]);
        setLoading(false);
      }
    })();
  }, [locale]);

  const weekDays = useMemo(() => {
    const from = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, i) => addDays(from, i));
  }, [anchorDate]);

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => overlapsDay(e, anchorDate))
        .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()),
    [anchorDate, events]
  );

  const eventsByYmd = useMemo(() => {
    const map: Record<string, EventRow[]> = {};
    for (const e of events) {
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
  }, [events]);

  const listEvents = useMemo(() => {
    return [...events].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [events]);

  const listTotalPages = Math.max(1, Math.ceil(listEvents.length / PAGE_SIZE));
  const pagedListEvents = useMemo(() => {
    const from = (listPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE;
    return listEvents.slice(from, to);
  }, [listEvents, listPage]);

  useEffect(() => {
    if (listPage > listTotalPages) setListPage(listTotalPages);
  }, [listPage, listTotalPages]);

  function goPrev() {
    if (view === "week") setAnchorDate((d) => addDays(d, -7));
    else setAnchorDate((d) => addDays(d, -1));
  }

  function goNext() {
    if (view === "week") setAnchorDate((d) => addDays(d, 7));
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

  const headerLabel = view === "week" ? weekRangeLabel : dayHeaderLabel(anchorDate, dateLocale);
  const todayKey = ymd(new Date());
  const segmentWrapStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    width: "100%",
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
    width: "100%",
  });
  const subSegmentWrapStyle: React.CSSProperties = {
    display: "inline-flex",
    border: "1px solid rgba(0,0,0,0.14)",
    borderRadius: 10,
    overflow: "hidden",
    background: "rgba(255,255,255,0.78)",
  };
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
              {tr("Calendrier coach", "Coach calendar")}
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section" style={{ display: "grid", gap: 14 }}>
          <div className="glass-card" style={{ padding: 12, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={segmentWrapStyle}>
                <button
                  onClick={() => {
                    setMode("list");
                    setSelectedEventId(null);
                  }}
                  style={segmentBtnStyle(mode === "list", true)}
                >
                  {tr("Vue liste", "List view")}
                </button>
                <button
                  onClick={() => {
                    setMode("calendar");
                    setSelectedEventId(null);
                  }}
                  style={segmentBtnStyle(mode === "calendar")}
                >
                  {tr("Vue calendrier", "Calendar view")}
                </button>
              </div>
            </div>
            {mode === "calendar" ? (
              <>
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
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div style={subSegmentWrapStyle}>
                    <button onClick={() => setView("day")} style={segmentBtnStyle(view === "day", true)}>
                      {tr("Jour", "Day")}
                    </button>
                    <button onClick={() => setView("week")} style={segmentBtnStyle(view === "week")}>
                      {tr("Semaine", "Week")}
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          {loading ? (
            <div className="glass-card" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{tr("Chargement...", "Loading...")}</div>
          ) : (
            <>
              {mode === "list" ? (
                <div className="glass-card" style={{ padding: 10 }}>
                  {pagedListEvents.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {tr("Aucun événement pour cette période.", "No event for this period.")}
                    </div>
                  ) : (
                    <div className="marketplace-list marketplace-list-top">
                      {pagedListEvents.map((e) => {
                        const groupLabel = groupNames[e.group_id] ?? tr("Groupe", "Group");
                        const titleLabel = `${eventTypeLabel(e.event_type, locale)} • ${groupLabel}`;
                        const endIso = e.ends_at ?? e.starts_at;
                        const oneDay = sameDay(e.starts_at, endIso);
                        return (
                          <Link key={e.id} href={`/coach/groups/${e.group_id}/planning/${e.id}`} className="marketplace-link">
                            <div className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}>
                              <div style={{ display: "grid", gap: 10 }}>
                                <div style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
                                  {oneDay ? (
                                    <div>
                                      {dateLabelNoTime(e.starts_at, dateLocale)}{" "}
                                      <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                                        {locale === "fr"
                                          ? `• de ${timeLabel(e.starts_at, dateLocale)} à ${timeLabel(endIso, dateLocale)}`
                                          : `• from ${timeLabel(e.starts_at, dateLocale)} to ${timeLabel(endIso, dateLocale)}`}
                                      </span>
                                    </div>
                                  ) : (
                                    <div>
                                      {dateTimeLabel(e.starts_at, dateLocale)} {locale === "fr" ? "au" : "to"} {dateTimeLabel(endIso, dateLocale)}
                                    </div>
                                  )}
                                </div>
                                <div className="hr-soft" style={{ margin: "1px 0" }} />
                                <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                                  {titleLabel}
                                </div>
                                {e.location_text ? (
                                  <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                                    📍 {e.location_text}
                                  </div>
                                ) : null}
                                {e.coach_note?.trim() ? (
                                  <div style={{ color: "rgba(0,0,0,0.72)", fontWeight: 700, fontSize: 12, whiteSpace: "pre-wrap" }}>
                                    {e.coach_note}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
              {mode === "calendar" && view === "week" ? (
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
                                  {timeLabel(e.starts_at, dateLocale)} · {eventTypeLabel(e.event_type, locale)} • {groupNames[e.group_id] ?? tr("Groupe", "Group")}
                                </button>
                                {isSelected ? (
                                  <div style={detailCardStyle}>
                                    {e.title?.trim() ? (
                                      <div style={{ fontSize: 14, fontWeight: 980, color: "rgba(0,0,0,0.88)" }}>{e.title}</div>
                                    ) : null}
                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                      <span className="pill-soft">{eventTypeLabel(e.event_type, locale)}</span>
                                      <span className="pill-soft">{groupNames[e.group_id] ?? tr("Groupe", "Group")}</span>
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
                                      <Link className="cta-green cta-green-inline" href={`/coach/groups/${e.group_id}/planning/${e.id}`}>
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

              {mode === "calendar" && view === "day" ? (
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
                            <div style={{ fontSize: 12, fontWeight: 950 }}>
                              {timeLabel(e.starts_at, dateLocale)} · {eventTypeLabel(e.event_type, locale)} • {groupNames[e.group_id] ?? tr("Groupe", "Group")}
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 800, opacity: 0.85 }}>{groupNames[e.group_id] ?? tr("Groupe", "Group")}</div>
                          </button>
                          {isSelected ? (
                            <div style={detailCardStyle}>
                              {e.title?.trim() ? (
                                <div style={{ fontSize: 14, fontWeight: 980, color: "rgba(0,0,0,0.88)" }}>{e.title}</div>
                              ) : null}
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                                <span className="pill-soft">{eventTypeLabel(e.event_type, locale)}</span>
                                <span className="pill-soft">{groupNames[e.group_id] ?? tr("Groupe", "Group")}</span>
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
                                <Link className="cta-green cta-green-inline" href={`/coach/groups/${e.group_id}/planning/${e.id}`}>
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

              {mode === "list" && listEvents.length > 0 ? (
                <div className="glass-section">
                  <div className="marketplace-pagination">
                    <button
                      className="btn"
                      type="button"
                      onClick={() => setListPage((p) => Math.max(1, p - 1))}
                      disabled={loading || listPage <= 1}
                    >
                      {tr("Précédent", "Previous")}
                    </button>
                    <div className="marketplace-page-indicator">
                      {tr("Page", "Page")} {listPage} / {listTotalPages}
                    </div>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
                      disabled={loading || listPage >= listTotalPages}
                    >
                      {tr("Suivant", "Next")}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
