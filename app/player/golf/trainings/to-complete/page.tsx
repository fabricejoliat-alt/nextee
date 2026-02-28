"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { Pencil } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type SessionRow = {
  id: string;
  start_at: string;
  club_event_id: string | null;
  location_text: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
};

type SessionItemRow = {
  session_id: string;
  minutes: number;
};

type EventAttendeeRow = {
  event_id: string | null;
};

type ClubNameRow = {
  id: string;
  name: string | null;
};

type PlannedEventRow = {
  id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event" | null;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  club_id: string | null;
  group_id: string | null;
  status: "scheduled" | "cancelled";
};

type IncompleteEvent = {
  kind: "event";
  id: string;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number;
  location_text: string | null;
  club_id: string | null;
  group_id: string | null;
};

type IncompleteSession = {
  kind: "session";
  id: string;
  starts_at: string;
  club_event_id: string | null;
  location_text: string | null;
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

export default function PlayerTrainingsToCompletePage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [eventById, setEventById] = useState<Record<string, PlannedEventRow>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { effectiveUserId: uid } = await resolveEffectivePlayerContext();

        const sRes = await supabase
          .from("training_sessions")
          .select("id,start_at,club_event_id,location_text,motivation,difficulty,satisfaction")
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
          .map((s) => ({
            kind: "session",
            id: s.id,
            starts_at: s.start_at,
            club_event_id: s.club_event_id,
            location_text: s.location_text ?? null,
          }));

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
        const eventIds = Array.from(
          new Set(
            ((aRes.data ?? []) as EventAttendeeRow[])
              .map((r) => String(r.event_id ?? "").trim())
              .filter((v) => v.length > 0)
          )
        );

        let events: PlannedEventRow[] = [];
        if (eventIds.length > 0) {
          const eRes = await supabase
            .from("club_events")
            .select("id,event_type,starts_at,ends_at,duration_minutes,location_text,status,club_id,group_id")
            .in("id", eventIds);
          if (eRes.error) throw new Error(eRes.error.message);
          events = (eRes.data ?? []) as PlannedEventRow[];
        }
        const byEventId: Record<string, PlannedEventRow> = {};
        events.forEach((ev) => {
          byEventId[ev.id] = ev;
        });
        setEventById(byEventId);

        const clubIds = Array.from(
          new Set(events.map((ev) => String(ev.club_id ?? "").trim()).filter((v) => v.length > 0))
        );
        if (clubIds.length > 0) {
          const cRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
          if (!cRes.error) {
            const map: Record<string, string> = {};
            (cRes.data ?? []).forEach((c: ClubNameRow) => {
              map[String(c.id)] = String(c.name ?? "").trim() || t("common.club");
            });
            setClubNameById(map);
          } else {
            setClubNameById({});
          }
        } else {
          setClubNameById({});
        }

        const groupIds = Array.from(
          new Set(events.map((ev) => String(ev.group_id ?? "").trim()).filter((v) => v.length > 0))
        );
        if (groupIds.length > 0) {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token ?? "";
          if (token) {
            const query = new URLSearchParams({ ids: groupIds.join(","), child_id: uid });
            const gRes = await fetch(`/api/player/group-names?${query.toString()}`, {
              method: "GET",
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            });
            const gJson = await gRes.json().catch(() => ({}));
            if (gRes.ok) {
              const map: Record<string, string> = {};
              ((gJson?.groups ?? []) as Array<{ id: string; name: string | null }>).forEach((g) => {
                map[g.id] = g.name ?? "Groupe";
              });
              setGroupNameById(map);
            } else {
              setGroupNameById({});
            }
          } else {
            setGroupNameById({});
          }
        } else {
          setGroupNameById({});
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
            ends_at: ev.ends_at,
            duration_minutes: ev.duration_minutes,
            location_text: ev.location_text,
            club_id: ev.club_id,
            group_id: ev.group_id,
          }));

        const merged = [...incompleteEvents, ...incompletePastSessions].sort(
          (a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime()
        );
        setRows(merged);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : t("common.errorLoading");
        setError(message);
        setRows([]);
        setClubNameById({});
        setGroupNameById({});
        setEventById({});
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
                    const clubName = row.club_id ? (clubNameById[row.club_id] ?? t("common.club")) : t("common.club");
                    const groupName = row.group_id ? (groupNameById[row.group_id] ?? (locale === "fr" ? "Groupe" : "Group")) : (locale === "fr" ? "Groupe" : "Group");
                    const eventEnd =
                      row.ends_at ??
                      new Date(new Date(row.starts_at).getTime() + Math.max(1, Number(row.duration_minutes ?? 0)) * 60_000).toISOString();
                    const isMultiDay = !sameDay(row.starts_at, eventEnd);
                    const eventTitle = `${locale === "fr" ? "Entraînement" : "Training"} • ${groupName}`;
                    return (
                      <div
                        key={`event-${row.id}`}
                        className="marketplace-item"
                        style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}
                      >
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
                            {isMultiDay ? (
                              <div>
                                {fmtDateLabelNoTime(row.starts_at, locale === "fr" ? "fr" : "en")} {locale === "fr" ? "au" : "to"} {fmtDateLabelNoTime(eventEnd, locale === "fr" ? "fr" : "en")}
                              </div>
                            ) : (
                              <div>
                                {fmtDateLabelNoTime(row.starts_at, locale === "fr" ? "fr" : "en")}{" "}
                                <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                                  {locale === "fr"
                                    ? `• de ${fmtHourLabel(row.starts_at, "fr")} à ${fmtHourLabel(eventEnd, "fr")}`
                                    : `• from ${fmtHourLabel(row.starts_at, "en")} to ${fmtHourLabel(eventEnd, "en")}`}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="hr-soft" style={{ margin: "1px 0" }} />

                          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                            <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                              {eventTitle}
                            </div>
                            <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.58)" }} className="truncate">
                              {locale === "fr" ? "Organisé par" : "Organized by"} {clubName}
                            </div>
                          </div>

                          {row.location_text ? (
                            <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                              📍 {row.location_text}
                            </div>
                          ) : null}

                          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                            <Link className="btn" href={`/player/golf/trainings/new?club_event_id=${row.id}`}>
                              <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              {locale === "fr" ? "Évaluer" : "Evaluate"}
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <Link key={`session-${row.id}`} href={`/player/golf/trainings/${row.id}/edit`} className="marketplace-link">
                      <div className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}>
                        <div style={{ display: "grid", gap: 10 }}>
                          {(() => {
                            const linkedEvent = row.club_event_id ? eventById[row.club_event_id] : null;
                            if (linkedEvent && linkedEvent.event_type === "training") {
                              const clubName = linkedEvent.club_id ? (clubNameById[linkedEvent.club_id] ?? t("common.club")) : t("common.club");
                              const groupName = linkedEvent.group_id
                                ? (groupNameById[linkedEvent.group_id] ?? (locale === "fr" ? "Groupe" : "Group"))
                                : (locale === "fr" ? "Groupe" : "Group");
                              const eventEnd =
                                linkedEvent.ends_at ??
                                new Date(new Date(linkedEvent.starts_at).getTime() + Math.max(1, Number(linkedEvent.duration_minutes ?? 0)) * 60_000).toISOString();
                              const isMultiDay = !sameDay(linkedEvent.starts_at, eventEnd);
                              const title = `${locale === "fr" ? "Entraînement" : "Training"} • ${groupName}`;
                              const place = (row.location_text ?? linkedEvent.location_text ?? "").trim();
                              return (
                                <>
                                  <div style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
                                    {isMultiDay ? (
                                      <div>
                                        {fmtDateLabelNoTime(linkedEvent.starts_at, locale === "fr" ? "fr" : "en")} {locale === "fr" ? "au" : "to"} {fmtDateLabelNoTime(eventEnd, locale === "fr" ? "fr" : "en")}
                                      </div>
                                    ) : (
                                      <div>
                                        {fmtDateLabelNoTime(linkedEvent.starts_at, locale === "fr" ? "fr" : "en")}{" "}
                                        <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                                          {locale === "fr"
                                            ? `• de ${fmtHourLabel(linkedEvent.starts_at, "fr")} à ${fmtHourLabel(eventEnd, "fr")}`
                                            : `• from ${fmtHourLabel(linkedEvent.starts_at, "en")} to ${fmtHourLabel(eventEnd, "en")}`}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="hr-soft" style={{ margin: "1px 0" }} />
                                  <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                                    <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                                      {title}
                                    </div>
                                    <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.58)" }} className="truncate">
                                      {locale === "fr" ? "Organisé par" : "Organized by"} {clubName}
                                    </div>
                                  </div>
                                  {place ? (
                                    <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                                      📍 {place}
                                    </div>
                                  ) : null}
                                </>
                              );
                            }
                            return (
                              <>
                                <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                                  {locale === "fr" ? "Séance à compléter" : "Session to complete"}
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.70)" }}>
                                  {fmtDateTime(row.starts_at, locale === "fr" ? "fr" : "en")}
                                </div>
                                {row.location_text ? (
                                  <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                                    📍 {row.location_text}
                                  </div>
                                ) : null}
                              </>
                            );
                          })()}
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
