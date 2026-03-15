"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { AlertTriangle, MessageCircle } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { readClientPageCache, writeClientPageCache } from "@/lib/clientPageCache";
import { fetchEventMessageBadges, type EventMessageBadge } from "@/lib/messages/eventBadgesClient";
import MessageCountBadge from "@/components/messages/MessageCountBadge";

type EventLite = {
  id: string;
  group_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};
type ProfileLite = {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};
type CoachHomeCache = {
  groupNameById: Record<string, string>;
  pendingEvalEvents: EventLite[];
  upcomingEvents: EventLite[];
  me: ProfileLite | null;
  organizationNames: string[];
};

const coachHomeCacheKey = (userId: string) => `page-cache:coach-home:${userId}`;
const COACH_HOME_CACHE_TTL_MS = 60_000;

function fmtDateTime(iso: string, locale: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function fmtTime(iso: string, locale: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function isSameDay(aIso: string, bIso: string | null) {
  if (!bIso) return true;
  const a = new Date(aIso);
  const b = new Date(bIso);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function CoachHomePage() {
  const { t, locale } = useI18n();
  const tr = (fr: string, en: string) => pickLocaleText(locale, fr, en);
  const dateLocale = locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-US";
  const [loading, setLoading] = useState(true);
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [pendingEvalEvents, setPendingEvalEvents] = useState<EventLite[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<EventLite[]>([]);
  const [me, setMe] = useState<ProfileLite | null>(null);
  const [organizationNames, setOrganizationNames] = useState<string[]>([]);
  const [messageBadgesByEventId, setMessageBadgesByEventId] = useState<Record<string, EventMessageBadge>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: authRes, error: authErr } = await supabase.auth.getUser();
        const uid = authRes.user?.id;
        if (authErr || !uid) {
          setPendingEvalEvents([]);
          setUpcomingEvents([]);
          setGroupNameById({});
          setMe(null);
          return;
        }

        const cache = readClientPageCache<CoachHomeCache>(coachHomeCacheKey(uid), COACH_HOME_CACHE_TTL_MS);
        if (cache) {
          setGroupNameById(cache.groupNameById);
          setPendingEvalEvents(cache.pendingEvalEvents);
          setUpcomingEvents(cache.upcomingEvents);
          setMe(cache.me);
          setOrganizationNames(cache.organizationNames);
          return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token ?? "";
        if (!token) return;

        const res = await fetch("/api/coach/home", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;

        const groupMap = (json?.groupNameById ?? {}) as Record<string, string>;
        const pending = (json?.pendingEvalEvents ?? []) as EventLite[];
        const upList = (json?.upcomingEvents ?? []) as EventLite[];
        const meData = (json?.me ?? null) as ProfileLite | null;
        const organizations = (json?.organizationNames ?? []) as string[];

        setGroupNameById(groupMap);
        setPendingEvalEvents(pending);
        setUpcomingEvents(upList);
        setMe(meData);
        setOrganizationNames(organizations);

        writeClientPageCache<CoachHomeCache>(coachHomeCacheKey(uid), {
          groupNameById: groupMap,
          pendingEvalEvents: pending,
          upcomingEvents: upList,
          me: meData,
          organizationNames: organizations,
        });
      } catch {
        setPendingEvalEvents([]);
        setUpcomingEvents([]);
        setGroupNameById({});
      } finally {
        setLoading(false);
      }
    })();
  }, [locale]);

  useEffect(() => {
    const ids = Array.from(new Set([...pendingEvalEvents, ...upcomingEvents].map((e) => String(e.id ?? "")).filter(Boolean)));
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
      .channel("coach-home-event-badges")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "thread_messages" },
        () => {
          void loadBadges();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "thread_participants" },
        () => {
          void loadBadges();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_threads" },
        () => {
          void loadBadges();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [pendingEvalEvents, upcomingEvents]);

  function eventTypeLabel(v: EventLite["event_type"]) {
    if (v === "training") return tr("Entraînement", "Training");
    if (v === "interclub") return "Interclub";
    if (v === "camp") return tr("Stage/Camp", "Camp");
    if (v === "session") return tr("Séance", "Session");
    return tr("Événement", "Event");
  }

  function displayHello() {
    const first = (me?.first_name ?? "").trim();
    if (!first) return `${tr("Salut", "Hello")} 👋`;
    return `${tr("Salut", "Hello")} ${first} 👋`;
  }

  function initials() {
    const f = (me?.first_name ?? "").trim();
    const l = (me?.last_name ?? "").trim();
    return `${f ? f[0].toUpperCase() : ""}${l ? l[0].toUpperCase() : ""}` || "👤";
  }

  const heroClubLine = useMemo(() => {
    const names = Array.from(new Set(organizationNames.filter(Boolean)));
    if (names.length === 0) return "—";
    return names.join(" • ");
  }, [organizationNames]);

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
        <MessageCountBadge
          messageCount={badge.message_count ?? 0}
          unreadCount={badge.unread_count ?? 0}
          style={{ marginLeft: 0 }}
        />
      </Link>
    );
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell">
        <div className="player-hero">
          <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
            <div className="avatar" aria-hidden="true" style={{ position: "relative", overflow: "hidden" }}>
              {me?.avatar_url ? (
                <img src={me.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                    fontSize: 28,
                    letterSpacing: 1,
                    color: "white",
                    background: "linear-gradient(135deg, #14532d 0%, #064e3b 100%)",
                  }}
                >
                  {initials()}
                </div>
              )}
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="hero-title">{loading ? `${tr("Salut", "Hello")}…` : displayHello()}</div>
            <div className="hero-sub">
              <div>HCP PRO</div>
            </div>
            <div className="hero-club truncate">{heroClubLine}</div>
          </div>
        </div>

        <div className="glass-section" style={{ display: "grid", gap: 14, marginTop: 14 }}>
          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="card-title" style={{ marginBottom: 0, fontSize: 16 }}>{tr("Évaluations en attente", "Pending evaluations")}</div>
              <span className="pill-soft">{pendingEvalEvents.length}</span>
            </div>

            {loading ? (
              <ListLoadingBlock label={t("common.loading")} />
            ) : pendingEvalEvents.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{tr("Aucune évaluation en attente.", "No pending evaluation.")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {pendingEvalEvents.slice(0, 12).map((e) => (
                  <div key={e.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}>
                    <Link href={`/coach/groups/${e.group_id}/planning/${e.id}`} className="marketplace-link" style={{ textDecoration: "none" }}>
                      <div style={{ display: "grid", gap: 10 }}>
                        <div style={{ display: "grid", gap: 2, fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
                          {isSameDay(e.starts_at, e.ends_at) ? (
                            <div>{fmtDateTime(e.starts_at, dateLocale)}</div>
                          ) : (
                            <div>
                              {fmtDateTime(e.starts_at, dateLocale)} {tr("au", "to")}{" "}
                              {e.ends_at ? fmtDateTime(e.ends_at, dateLocale) : ""}
                            </div>
                          )}
                        </div>
                        <div className="hr-soft" style={{ margin: "1px 0" }} />
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                          <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                            {eventTypeLabel(e.event_type)} • {groupNameById[e.group_id] ?? tr("Groupe", "Group")}
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
                          <div style={{ flexShrink: 0 }}>
                            {renderMessagePill(e.id, e.group_id)}
                          </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <span
                            className="pill-soft"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              color: "rgba(127,29,29,1)",
                              background: "rgba(239,68,68,0.16)",
                              borderColor: "rgba(239,68,68,0.35)",
                              fontWeight: 900,
                            }}
                          >
                            <AlertTriangle size={14} />
                            {tr("Évaluation", "Evaluation")}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="glass-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="card-title" style={{ marginBottom: 0, fontSize: 16 }}>{tr("Calendrier", "Calendar")}</div>
              <span className="pill-soft">{upcomingEvents.length}</span>
            </div>

            {loading ? (
              <ListLoadingBlock label={t("common.loading")} />
            ) : upcomingEvents.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{tr("Aucun événement à venir.", "No upcoming event.")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {upcomingEvents.slice(0, 5).map((e) => (
                  <div key={e.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}>
                    <Link href={`/coach/groups/${e.group_id}/planning/${e.id}`} className="marketplace-link" style={{ textDecoration: "none" }}>
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
                          {isSameDay(e.starts_at, e.ends_at) ? (
                            <div>
                              {fmtDateTime(e.starts_at, dateLocale)}{" "}
                              {e.ends_at ? (
                                <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                                  {locale === "fr"
                                    ? `• de ${fmtTime(e.starts_at, dateLocale)} à ${fmtTime(e.ends_at, dateLocale)}`
                                    : `• from ${fmtTime(e.starts_at, dateLocale)} to ${fmtTime(e.ends_at, dateLocale)}`}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <div>
                              {fmtDateTime(e.starts_at, dateLocale)} {tr("au", "to")}{" "}
                              {e.ends_at ? fmtDateTime(e.ends_at, dateLocale) : ""}
                            </div>
                          )}
                        </div>
                        <div className="hr-soft" style={{ margin: "1px 0" }} />
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                          <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                            {eventTypeLabel(e.event_type)} • {groupNameById[e.group_id] ?? tr("Groupe", "Group")}
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
                          <div style={{ flexShrink: 0 }}>
                            {renderMessagePill(e.id, e.group_id)}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            )}

            <Link className="cta-green cta-green-inline" href="/coach/calendar" style={{ width: "100%", justifyContent: "center", marginTop: 2 }}>
              {tr("Calendrier complet", "Full calendar")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
