"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { CalendarClock, Pencil } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type SessionRow = {
  id: string;
  start_at: string;
  club_event_id: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
};

type SessionItemRow = {
  session_id: string;
  minutes: number;
};

type PlannedEventRow = {
  id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};

type IncompleteEvent = {
  kind: "event";
  id: string;
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
};

type IncompleteSession = {
  kind: "session";
  id: string;
  starts_at: string;
};

type Row = IncompleteEvent | IncompleteSession;

function fmtDateTime(iso: string, locale: "fr" | "en") {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default function PlayerTrainingsToCompletePage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: auth, error: authErr } = await supabase.auth.getUser();
        if (authErr || !auth.user) throw new Error(t("trainings.error.invalidSession"));
        const uid = auth.user.id;

        const sRes = await supabase
          .from("training_sessions")
          .select("id,start_at,club_event_id,motivation,difficulty,satisfaction")
          .eq("user_id", uid)
          .order("start_at", { ascending: false });
        if (sRes.error) throw new Error(sRes.error.message);
        const sessions = (sRes.data ?? []) as SessionRow[];

        const sessionIds = sessions.map((s) => s.id);
        const itemMap: Record<string, SessionItemRow[]> = {};
        if (sessionIds.length > 0) {
          const itemsRes = await supabase
            .from("training_session_items")
            .select("session_id,minutes")
            .in("session_id", sessionIds);
          if (itemsRes.error) throw new Error(itemsRes.error.message);
          for (const row of (itemsRes.data ?? []) as SessionItemRow[]) {
            if (!itemMap[row.session_id]) itemMap[row.session_id] = [];
            itemMap[row.session_id].push(row);
          }
        }

        const completeSessionIds = new Set<string>();
        for (const s of sessions) {
          const items = itemMap[s.id] ?? [];
          const hasPoste = items.some((it) => (it.minutes ?? 0) > 0);
          const hasSensations =
            typeof s.motivation === "number" &&
            typeof s.difficulty === "number" &&
            typeof s.satisfaction === "number";
          if (hasPoste && hasSensations) completeSessionIds.add(s.id);
        }

        const nowTs = Date.now();
        const incompletePastSessions: IncompleteSession[] = sessions
          .filter((s) => new Date(s.start_at).getTime() < nowTs)
          .filter((s) => !completeSessionIds.has(s.id))
          .map((s) => ({ kind: "session", id: s.id, starts_at: s.start_at }));

        const completedEventIds = new Set(
          sessions
            .filter((s) => completeSessionIds.has(s.id))
            .map((s) => s.club_event_id)
            .filter((x): x is string => !!x)
        );
        const eventIdsWithAnySession = new Set(
          sessions.map((s) => s.club_event_id).filter((x): x is string => !!x)
        );

        const aRes = await supabase
          .from("club_event_attendees")
          .select("event_id")
          .eq("player_id", uid);
        if (aRes.error) throw new Error(aRes.error.message);
        const eventIds = Array.from(new Set((aRes.data ?? []).map((r: any) => r.event_id as string)));

        let events: PlannedEventRow[] = [];
        if (eventIds.length > 0) {
          const eRes = await supabase
            .from("club_events")
            .select("id,event_type,starts_at,duration_minutes,location_text,status")
            .in("id", eventIds);
          if (eRes.error) throw new Error(eRes.error.message);
          events = (eRes.data ?? []) as PlannedEventRow[];
        }

        const incompleteEvents: IncompleteEvent[] = events
          .filter((ev) => ev.status === "scheduled")
          .filter((ev) => ev.event_type === "training")
          .filter((ev) => new Date(ev.starts_at).getTime() < nowTs)
          .filter((ev) => !completedEventIds.has(ev.id))
          .filter((ev) => !eventIdsWithAnySession.has(ev.id))
          .map((ev) => ({
            kind: "event",
            id: ev.id,
            starts_at: ev.starts_at,
            duration_minutes: ev.duration_minutes,
            location_text: ev.location_text,
          }));

        const merged = [...incompleteEvents, ...incompletePastSessions].sort(
          (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
        );
        setRows(merged);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : t("common.errorLoading");
        setError(message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {locale === "fr" ? "Entraînements à évaluer" : "Trainings to complete"}
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : rows.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>
                {locale === "fr" ? "Aucun entraînement à évaluer." : "No training to complete."}
              </div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {rows.map((row) => {
                  if (row.kind === "event") {
                    return (
                      <div
                        key={`event-${row.id}`}
                        className="marketplace-item"
                        style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}
                      >
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                            <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                              {locale === "fr" ? "Entraînement club à évaluer" : "Club training to complete"}
                            </div>
                            <div className="marketplace-price-pill">{row.duration_minutes} min</div>
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)" }}>
                            {fmtDateTime(row.starts_at, locale === "fr" ? "fr" : "en")}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <CalendarClock size={14} />
                              {locale === "fr" ? "À compléter" : "To complete"}
                            </span>
                            {row.location_text ? (
                              <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }} className="truncate">
                                📍 {row.location_text}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <Link className="btn" href={`/player/golf/trainings/new?club_event_id=${row.id}`}>
                              <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              {t("trainings.enter")}
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <Link key={`session-${row.id}`} href={`/player/golf/trainings/${row.id}/edit`} className="marketplace-link">
                      <div className="marketplace-item">
                        <div style={{ display: "grid", gap: 8 }}>
                          <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                            {locale === "fr" ? "Séance à compléter" : "Session to complete"}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)" }}>
                            {fmtDateTime(row.starts_at, locale === "fr" ? "fr" : "en")}
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
