"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { AlertTriangle, CalendarDays, Filter } from "lucide-react";

type FilterMode = "upcoming" | "past";

type EventRow = {
  id: string;
  group_id: string;
  camp_id: string | null;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  title: string | null;
  camp_day_index: number | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  location_text: string | null;
  coach_note: string | null;
  series_id: string | null;
  status: string;
};

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

function eventTypeLabel(v: EventRow["event_type"], locale: string) {
  const l = locale as "fr" | "en" | "de" | "it";
  if (v === "training") return pickLocaleText(l, "Entraînement", "Training");
  if (v === "interclub") return pickLocaleText(l, "Interclub", "Interclub");
  if (v === "camp") return pickLocaleText(l, "Stage", "Camp");
  if (v === "session") return pickLocaleText(l, "Séance", "Session");
  return pickLocaleText(l, "Événement", "Event");
}

function eventCardTitle(event: EventRow, groupNames: Record<string, string>, locale: string) {
  const groupLabel = groupNames[event.group_id] ?? pickLocaleText(locale as "fr" | "en" | "de" | "it", "Groupe", "Group");
  if (event.event_type === "camp") {
    const baseTitle = String(event.title ?? "").trim() || eventTypeLabel(event.event_type, locale);
    if (typeof event.camp_day_index === "number" && Number.isFinite(event.camp_day_index)) {
      return `${baseTitle} • ${pickLocaleText(
        locale as "fr" | "en" | "de" | "it",
        `Jour ${event.camp_day_index + 1}`,
        `Day ${event.camp_day_index + 1}`
      )}`;
    }
    return baseTitle;
  }
  return `${eventTypeLabel(event.event_type, locale)} • ${groupLabel}`;
}

function isArchiveGroupLabel(label: string) {
  const l = label.toLowerCase();
  return l.includes("archive") || l.includes("historique");
}

export default function CoachCalendarPage() {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [campNamesById, setCampNamesById] = useState<Record<string, string>>({});
  const [pendingEvalEventIds, setPendingEvalEventIds] = useState<Set<string>>(new Set());

  const [filterMode, setFilterMode] = useState<FilterMode>("upcoming");
  const [groupFilter, setGroupFilter] = useState<string>("all");
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

        const [calendarRes, homeRes] = await Promise.all([
          fetch("/api/coach/events/calendar", {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
          fetch("/api/coach/home", {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }),
        ]);
        const calendarJson = await calendarRes.json().catch(() => ({}));
        const homeJson = await homeRes.json().catch(() => ({}));
        if (!calendarRes.ok) throw new Error(String(calendarJson?.error ?? "Erreur chargement"));
        if (!homeRes.ok) throw new Error(String(homeJson?.error ?? "Erreur chargement"));

        setEvents((calendarJson?.events ?? []) as EventRow[]);
        setGroupNames((calendarJson?.groupNameById ?? {}) as Record<string, string>);
        setCampNamesById((calendarJson?.campNameById ?? {}) as Record<string, string>);
        setPendingEvalEventIds(
          new Set<string>(((homeJson?.pendingEvalEvents ?? []) as Array<{ id?: string | null }>).map((event) => String(event?.id ?? "").trim()).filter(Boolean))
        );
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : tr("Erreur chargement", "Loading error"));
        setEvents([]);
        setPendingEvalEventIds(new Set());
      } finally {
        setLoading(false);
      }
    })();
  }, [locale]);

  const nowTs = Date.now();

  const baseFilteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.status !== "scheduled") return false;
      const groupLabel = groupNames[e.group_id] ?? tr("Groupe", "Group");
      if (isArchiveGroupLabel(groupLabel)) return false;
      if (groupFilter === "all") return true;
      if (groupFilter.startsWith("group:")) {
        const groupId = groupFilter.slice("group:".length);
        return e.group_id === groupId && e.event_type !== "camp";
      }
      if (groupFilter.startsWith("camp:")) return e.camp_id === groupFilter.slice("camp:".length);
      return true;
    });
  }, [events, groupNames, groupFilter, locale]);

  const upcomingCount = useMemo(
    () => baseFilteredEvents.filter((e) => new Date(e.ends_at ?? e.starts_at).getTime() >= nowTs).length,
    [baseFilteredEvents, nowTs]
  );
  const pastCount = useMemo(
    () => baseFilteredEvents.filter((e) => new Date(e.ends_at ?? e.starts_at).getTime() < nowTs).length,
    [baseFilteredEvents, nowTs]
  );

  const listEvents = useMemo(() => {
    const list = baseFilteredEvents.filter((e) => {
      const endTs = new Date(e.ends_at ?? e.starts_at).getTime();
      const isPast = endTs < nowTs;
      return filterMode === "past" ? isPast : !isPast;
    });
    list.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    if (filterMode === "past") list.reverse();
    return list;
  }, [baseFilteredEvents, filterMode, nowTs]);

  const groupEventStats = useMemo(() => {
    const stats: Record<string, { hasCamp: boolean; hasNonCamp: boolean }> = {};
    events.forEach((event) => {
      const groupId = String(event.group_id ?? "").trim();
      if (!groupId) return;
      if (!stats[groupId]) stats[groupId] = { hasCamp: false, hasNonCamp: false };
      if (event.event_type === "camp") stats[groupId].hasCamp = true;
      else stats[groupId].hasNonCamp = true;
    });
    return stats;
  }, [events]);

  const groupOptions = useMemo(() => {
    const groupOptionsList = Object.entries(groupNames)
      .filter(([id]) => !groupEventStats[id]?.hasCamp || groupEventStats[id]?.hasNonCamp)
      .map(([id, label]) => ({ id: `group:${id}`, label }));
    const campOptionsList = Object.entries(campNamesById).map(([id, label]) => ({ id: `camp:${id}`, label: `${tr("Stage", "Camp")} - ${label}` }));
    return [...groupOptionsList, ...campOptionsList]
      .filter((g) => !isArchiveGroupLabel(g.label))
      .sort((a, b) => a.label.localeCompare(b.label, dateLocale));
  }, [groupNames, campNamesById, groupEventStats, locale]);

  const listTotalPages = Math.max(1, Math.ceil(listEvents.length / PAGE_SIZE));
  const pagedListEvents = useMemo(() => {
    const from = (listPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE;
    return listEvents.slice(from, to);
  }, [listEvents, listPage]);

  useEffect(() => {
    if (listPage > listTotalPages) setListPage(listTotalPages);
  }, [listPage, listTotalPages]);

  useEffect(() => {
    setListPage(1);
  }, [filterMode, groupFilter]);

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
              {tr("Filtrer mon activité", "Filter my activity")}
            </div>

            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} disabled={loading}>
              <option value="all">{tr("Tous les groupes", "All groups")}</option>
              {groupOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>

            <div style={{ display: "inline-flex", width: "100%", border: "1px solid rgba(0,0,0,0.14)", borderRadius: 10, overflow: "hidden" }}>
              <button
                type="button"
                className={`btn trainings-filter-btn ${filterMode === "past" ? "trainings-filter-btn-active" : ""}`}
                onClick={() => setFilterMode("past")}
                disabled={loading}
                style={{ borderRadius: 0, border: "none", fontWeight: 900, width: "50%" }}
              >
                {tr("Passés", "Past")} ({pastCount})
              </button>
              <button
                type="button"
                className={`btn trainings-filter-btn ${filterMode === "upcoming" ? "trainings-filter-btn-active" : ""}`}
                onClick={() => setFilterMode("upcoming")}
                disabled={loading}
                style={{ borderRadius: 0, border: "none", fontWeight: 900, width: "50%" }}
              >
                {tr("À venir", "Upcoming")} ({upcomingCount})
              </button>
            </div>
          </div>

          {listEvents.length > 0 ? (
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

          <div className="glass-card" style={{ padding: 10 }}>
            {loading ? (
              <ListLoadingBlock label={tr("Chargement...", "Loading...")} />
            ) : pagedListEvents.length === 0 ? (
              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                {tr("Aucun événement pour cette période.", "No event for this period.")}
              </div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {pagedListEvents.map((e) => {
                  const titleLabel = eventCardTitle(e, groupNames, locale);
                  const endIso = e.ends_at ?? e.starts_at;
                  const oneDay = sameDay(e.starts_at, endIso);
                  const needsEvaluation = pendingEvalEventIds.has(String(e.id ?? ""));
                  return (
                    <div key={e.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 8,
                            fontSize: 12,
                            fontWeight: 950,
                            color: "rgba(0,0,0,0.82)",
                          }}
                        >
                          <CalendarDays size={15} style={{ flex: "0 0 auto", marginTop: 1, color: "rgba(0,0,0,0.62)" }} />
                          <div style={{ display: "grid", gap: 2 }}>
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
                                {dateTimeLabel(e.starts_at, dateLocale)} {tr("au", "to")} {dateTimeLabel(endIso, dateLocale)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="hr-soft" style={{ margin: "1px 0" }} />
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                          <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                            {titleLabel}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                          {e.location_text ? (
                            <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12, minWidth: 0 }} className="truncate">
                              📍 {e.location_text}
                            </div>
                          ) : (
                            <div style={{ color: "rgba(0,0,0,0.45)", fontWeight: 700, fontSize: 12, minWidth: 0 }} className="truncate">
                              —
                            </div>
                          )}
                          <Link
                            href={`/coach/groups/${e.group_id}/planning/${e.id}`}
                            className={needsEvaluation ? undefined : "btn"}
                            style={
                              needsEvaluation
                                ? {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 6,
                                    padding: "8px 12px",
                                    minHeight: 36,
                                    borderRadius: 12,
                                    color: "rgba(127,29,29,1)",
                                    border: "1px solid rgba(239,68,68,0.35)",
                                    backgroundColor: "rgba(254,242,242,0.96)",
                                    backgroundImage: "none",
                                    fontWeight: 900,
                                    fontSize: 13,
                                    lineHeight: 1.1,
                                    flexShrink: 0,
                                    boxShadow: "none",
                                    textShadow: "none",
                                    textDecoration: "none",
                                    WebkitTextFillColor: "rgba(127,29,29,1)",
                                  }
                                : { flexShrink: 0 }
                            }
                          >
                            {needsEvaluation ? <AlertTriangle size={14} color="rgba(127,29,29,1)" /> : null}
                            {needsEvaluation ? tr("Évaluer", "Evaluate") : tr("Détail", "Details")}
                          </Link>
                        </div>
                        {e.coach_note?.trim() ? (
                          <div style={{ color: "rgba(0,0,0,0.72)", fontWeight: 700, fontSize: 12, whiteSpace: "pre-wrap" }}>
                            {e.coach_note}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {listEvents.length > 0 ? (
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
        </div>
      </div>
    </div>
  );
}
