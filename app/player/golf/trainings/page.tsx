"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { Flame, Mountain, Smile, SlidersHorizontal, CalendarClock, Pencil } from "lucide-react";
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
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  club_id: string;
  group_id: string;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type FilterMode = "to_complete" | "planned" | "past";

type DisplayItem =
  | { kind: "session"; key: string; dateIso: string; session: SessionRow }
  | { kind: "event"; key: string; dateIso: string; event: PlannedEventRow };

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

  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});
  const [itemsBySessionId, setItemsBySessionId] = useState<Record<string, SessionItemRow[]>>({});

  const [filterMode, setFilterMode] = useState<FilterMode>("planned");

  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string>("");

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

  const completedEventIds = useMemo(() => {
    return new Set(
      sessions
        .filter((s) => completeSessionIds.has(s.id))
        .map((s) => s.club_event_id)
        .filter((x): x is string => !!x)
    );
  }, [sessions, completeSessionIds]);

  const eventIdsWithAnySession = useMemo(() => {
    return new Set(sessions.map((s) => s.club_event_id).filter((x): x is string => !!x));
  }, [sessions]);

  const scheduledEvents = useMemo(() => {
    return attendeeEvents.filter((ev) => ev.status === "scheduled");
  }, [attendeeEvents]);

  const eventsToComplete = useMemo(() => {
    return scheduledEvents
      .filter((ev) => new Date(ev.starts_at).getTime() < nowTs)
      .filter((ev) => !completedEventIds.has(ev.id))
      .filter((ev) => !eventIdsWithAnySession.has(ev.id))
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  }, [scheduledEvents, nowTs, completedEventIds, eventIdsWithAnySession]);

  const plannedEvents = useMemo(() => {
    return scheduledEvents
      .filter((ev) => new Date(ev.starts_at).getTime() >= nowTs)
      .filter((ev) => !completedEventIds.has(ev.id))
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [scheduledEvents, nowTs, completedEventIds]);

  const futureSessions = useMemo(() => {
    return sessions
      .filter((s) => new Date(s.start_at).getTime() >= nowTs)
      .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  }, [sessions, nowTs]);

  const incompletePastSessions = useMemo(() => {
    return pastSessions.filter((s) => !completeSessionIds.has(s.id));
  }, [pastSessions, completeSessionIds]);

  const displayItems = useMemo<DisplayItem[]>(() => {
    if (filterMode === "to_complete") {
      const incompleteSessionItems: DisplayItem[] = incompletePastSessions.map((session) => ({
        kind: "session",
        key: `session-${session.id}`,
        dateIso: session.start_at,
        session,
      }));

      const incompleteEventItems: DisplayItem[] = eventsToComplete.map((event) => ({
        kind: "event",
        key: `event-${event.id}`,
        dateIso: event.starts_at,
        event,
      }));

      return [...incompleteSessionItems, ...incompleteEventItems].sort(
        (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime()
      );
    }

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

      return [...plannedEventItems, ...futureSessionItems].sort(
        (a, b) => new Date(a.dateIso).getTime() - new Date(b.dateIso).getTime()
      );
    }

    const pastSessionItems: DisplayItem[] = pastSessions.map((session) => ({
      kind: "session",
      key: `session-${session.id}`,
      dateIso: session.start_at,
      session,
    }));

    const pastEventItems: DisplayItem[] = eventsToComplete.map((event) => ({
      kind: "event",
      key: `event-${event.id}`,
      dateIso: event.starts_at,
      event,
    }));

    return [...pastSessionItems, ...pastEventItems].sort(
      (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime()
    );
  }, [filterMode, incompletePastSessions, eventsToComplete, plannedEvents, futureSessions, pastSessions]);

  const toCompleteCount = incompletePastSessions.length + eventsToComplete.length;
  const plannedCount = plannedEvents.length + futureSessions.length;
  const pastCount = pastSessions.length + eventsToComplete.length;
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
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error(t("trainings.error.invalidSession"));
      const uid = userRes.user.id;

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
          .select("id,starts_at,duration_minutes,location_text,club_id,group_id,series_id,status")
          .in("id", eventIds)
          .order("starts_at", { ascending: false });

        if (eRes.error) throw new Error(eRes.error.message);
        events = (eRes.data ?? []) as PlannedEventRow[];
      }
      setAttendeeEvents(events);

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
      setClubNameById({});
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

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {t("trainings.title")}
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings/new">
                {t("common.add")}
              </Link>
              <Link className="cta-green cta-green-inline" href="/player">
                {t("common.dashboard")}
              </Link>
            </div>
          </div>

          {/* Filters */}
          <div className="glass-card" style={{ marginTop: 12, padding: 14, overflow: "hidden" }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <SlidersHorizontal size={16} />
                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>{t("trainings.display")}</div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setFilterMode("past")}
                  disabled={loading}
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    background: filterMode === "past" ? "var(--green-dark)" : undefined,
                    borderColor: filterMode === "past" ? "var(--green-dark)" : undefined,
                    color: filterMode === "past" ? "#fff" : undefined,
                    boxShadow: filterMode === "past" ? "0 0 0 2px rgba(25,112,61,0.22)" : undefined,
                  }}
                >
                  {t("trainings.done")} ({pastCount})
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => setFilterMode("to_complete")}
                  disabled={loading}
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    background: filterMode === "to_complete" ? "var(--green-dark)" : undefined,
                    borderColor: filterMode === "to_complete" ? "var(--green-dark)" : undefined,
                    color: filterMode === "to_complete" ? "#fff" : undefined,
                    boxShadow: filterMode === "to_complete" ? "0 0 0 2px rgba(25,112,61,0.22)" : undefined,
                  }}
                >
                  {t("trainings.toComplete")}{" "}
                  <span
                    style={{
                      color:
                        toCompleteCount > 0 && filterMode !== "to_complete"
                          ? "#c62828"
                          : undefined,
                      fontWeight: 950,
                    }}
                  >
                    ({toCompleteCount})
                  </span>
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() => setFilterMode("planned")}
                  disabled={loading}
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    background: filterMode === "planned" ? "var(--green-dark)" : undefined,
                    borderColor: filterMode === "planned" ? "var(--green-dark)" : undefined,
                    color: filterMode === "planned" ? "#fff" : undefined,
                    boxShadow: filterMode === "planned" ? "0 0 0 2px rgba(25,112,61,0.22)" : undefined,
                  }}
                >
                  {t("trainings.planned")} ({plannedCount})
                </button>
              </div>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
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
                    const isPlanned = new Date(e.starts_at).getTime() >= nowTs;

                    return (
                      <div
                        key={item.key}
                        className="marketplace-item"
                        style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.65)" }}
                      >
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
                              }).format(new Date(e.starts_at))}
                            </div>
                            <div className="marketplace-price-pill">{e.duration_minutes} min</div>
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span className="pill-soft">{clubName}</span>
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
