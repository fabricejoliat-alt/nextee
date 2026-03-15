"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import MessageCountBadge from "@/components/messages/MessageCountBadge";
import { CalendarDays, Filter, MessageCircle } from "lucide-react";

type FilterMode = "upcoming" | "past";

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
  status: string;
};

type EventMessageBadge = {
  thread_id: string | null;
  message_count: number;
  unread_count: number;
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

function isArchiveGroupLabel(label: string) {
  const l = label.toLowerCase();
  return l.includes("archive") || l.includes("historique");
}

async function fetchEventMessageBadges(eventIds: string[]) {
  if (eventIds.length === 0) return {} as Record<string, EventMessageBadge>;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  if (!token) return {} as Record<string, EventMessageBadge>;

  const res = await fetch(`/api/messages/event-badges?event_ids=${encodeURIComponent(eventIds.join(","))}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return {} as Record<string, EventMessageBadge>;
  return (json?.badges ?? {}) as Record<string, EventMessageBadge>;
}

export default function CoachCalendarPage() {
  const { locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [messageBadgesByEventId, setMessageBadgesByEventId] = useState<Record<string, EventMessageBadge>>({});

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

        const res = await fetch("/api/coach/events/calendar", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(json?.error ?? "Erreur chargement"));

        setEvents((json?.events ?? []) as EventRow[]);
        setGroupNames((json?.groupNameById ?? {}) as Record<string, string>);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : tr("Erreur chargement", "Loading error"));
        setEvents([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [locale]);

  useEffect(() => {
    const ids = Array.from(new Set(events.map((e) => String(e.id ?? "")).filter(Boolean)));
    if (ids.length === 0) {
      setMessageBadgesByEventId({});
      return;
    }
    let cancelled = false;
    const loadBadges = async () => {
      const badges = await fetchEventMessageBadges(ids);
      if (!cancelled) setMessageBadgesByEventId(badges);
    };
    void loadBadges();

    const onFocus = () => void loadBadges();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadBadges();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    channel = supabase
      .channel("coach-calendar-event-badges")
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_messages" }, () => void loadBadges())
      .on("postgres_changes", { event: "*", schema: "public", table: "thread_participants" }, () => void loadBadges())
      .on("postgres_changes", { event: "*", schema: "public", table: "message_threads" }, () => void loadBadges())
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [events]);

  const nowTs = Date.now();

  const baseFilteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.status !== "scheduled") return false;
      const groupLabel = groupNames[e.group_id] ?? tr("Groupe", "Group");
      if (isArchiveGroupLabel(groupLabel)) return false;
      if (groupFilter !== "all" && e.group_id !== groupFilter) return false;
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

  const groupOptions = useMemo(() => {
    const uniq = Array.from(new Set(events.map((e) => e.group_id).filter(Boolean)));
    return uniq
      .map((id) => ({ id, label: groupNames[id] ?? tr("Groupe", "Group") }))
      .filter((g) => !isArchiveGroupLabel(g.label))
      .sort((a, b) => a.label.localeCompare(b.label, dateLocale));
  }, [events, groupNames, locale]);

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

  function renderMessagePill(eventId: string, groupId: string) {
    const badge = messageBadgesByEventId[String(eventId)] ?? { thread_id: null, message_count: 0, unread_count: 0 };
    return (
      <Link
        href={`/coach/groups/${encodeURIComponent(groupId)}/planning/${encodeURIComponent(eventId)}`}
        className="pill-soft"
        title={tr("Messagerie", "Messages")}
        aria-label={tr("Ouvrir la page de l'événement", "Open event page")}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", flexShrink: 0 }}
      >
        <MessageCircle size={14} />
        {tr("Messagerie", "Messages")}
        <MessageCountBadge messageCount={badge.message_count ?? 0} unreadCount={badge.unread_count ?? 0} />
      </Link>
    );
  }

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
                                {dateTimeLabel(e.starts_at, dateLocale)} {tr("au", "to")} {dateTimeLabel(endIso, dateLocale)}
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
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <span onClick={(ev) => ev.stopPropagation()}>{renderMessagePill(e.id, e.group_id)}</span>
                          </div>
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
