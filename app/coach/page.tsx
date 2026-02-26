"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { AlertTriangle, CalendarDays } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type GroupRow = { id: string; name: string | null; head_coach_user_id: string | null };
type GroupCoachRow = { group_id: string };
type EventLite = {
  id: string;
  group_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  ends_at: string | null;
  location_text: string | null;
  status: "scheduled" | "cancelled";
};
type EventAttendeeLite = {
  event_id: string;
  player_id: string;
  status: "expected" | "present" | "absent" | "excused" | null;
};
type EventFeedbackLite = {
  event_id: string;
  player_id: string;
};
type ProfileLite = {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

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

export default function CoachHomePage() {
  const { t, locale } = useI18n();
  const tr = (fr: string, en: string) => (locale === "en" ? en : fr);
  const dateLocale = locale === "fr" ? "fr-CH" : "en-US";
  const [loading, setLoading] = useState(true);
  const [groupNameById, setGroupNameById] = useState<Record<string, string>>({});
  const [pendingEvalEvents, setPendingEvalEvents] = useState<EventLite[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<EventLite[]>([]);
  const [me, setMe] = useState<ProfileLite | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: authRes, error: authErr } = await supabase.auth.getUser();
      const uid = authRes.user?.id;
      if (authErr || !uid) {
        setPendingEvalEvents([]);
        setUpcomingEvents([]);
        setGroupNameById({});
        setMe(null);
        setLoading(false);
        return;
      }

      const meRes = await supabase
        .from("profiles")
        .select("first_name,last_name,avatar_url")
        .eq("id", uid)
        .maybeSingle();
      if (!meRes.error && meRes.data) {
        setMe(meRes.data as ProfileLite);
      }

      const [headGroupsRes, extraGroupsRes] = await Promise.all([
        supabase.from("coach_groups").select("id,name,head_coach_user_id").eq("head_coach_user_id", uid),
        supabase.from("coach_group_coaches").select("group_id").eq("coach_user_id", uid),
      ]);

      if (headGroupsRes.error) {
        setLoading(false);
        return;
      }
      if (extraGroupsRes.error) {
        setLoading(false);
        return;
      }

      const headGroups = (headGroupsRes.data ?? []) as GroupRow[];
      const extraGroupIds = ((extraGroupsRes.data ?? []) as GroupCoachRow[]).map((r) => r.group_id);
      const groupIds = Array.from(new Set([...headGroups.map((g) => g.id), ...extraGroupIds]));

      if (groupIds.length === 0) {
        setPendingEvalEvents([]);
        setUpcomingEvents([]);
        setGroupNameById({});
        setLoading(false);
        return;
      }

      const groupsRes = await supabase.from("coach_groups").select("id,name").in("id", groupIds);
      if (groupsRes.error) {
        setLoading(false);
        return;
      }
      const groupMap: Record<string, string> = {};
      ((groupsRes.data ?? []) as Array<{ id: string; name: string | null }>).forEach((g) => {
        groupMap[g.id] = g.name ?? tr("Groupe", "Group");
      });
      setGroupNameById(groupMap);

      const nowIso = new Date().toISOString();
      const [upcomingRes, pastRes] = await Promise.all([
        supabase
          .from("club_events")
          .select("id,group_id,event_type,starts_at,ends_at,location_text,status")
          .in("group_id", groupIds)
          .gte("starts_at", nowIso)
          .order("starts_at", { ascending: true })
          .limit(5),
        supabase
          .from("club_events")
          .select("id,group_id,event_type,starts_at,ends_at,location_text,status")
          .in("group_id", groupIds)
          .in("event_type", ["training", "interclub", "camp"])
          .lt("starts_at", nowIso)
          .order("starts_at", { ascending: false })
          .limit(120),
      ]);

      if (upcomingRes.error || pastRes.error) {
        setLoading(false);
        return;
      }

      const upList = (upcomingRes.data ?? []) as EventLite[];
      setUpcomingEvents(upList);

      const pastList = (pastRes.data ?? []) as EventLite[];
      if (pastList.length === 0) {
        setPendingEvalEvents([]);
        setLoading(false);
        return;
      }

      const pastIds = pastList.map((e) => e.id);
      const [attendeesRes, feedbackRes] = await Promise.all([
        supabase.from("club_event_attendees").select("event_id,player_id,status").in("event_id", pastIds),
        supabase.from("club_event_coach_feedback").select("event_id,player_id").eq("coach_id", uid).in("event_id", pastIds),
      ]);

      if (attendeesRes.error || feedbackRes.error) {
        setLoading(false);
        return;
      }

      const presentByEvent: Record<string, Set<string>> = {};
      ((attendeesRes.data ?? []) as EventAttendeeLite[]).forEach((r) => {
        if (r.status !== "present") return;
        if (!presentByEvent[r.event_id]) presentByEvent[r.event_id] = new Set<string>();
        presentByEvent[r.event_id].add(r.player_id);
      });

      const evaluatedByEvent: Record<string, Set<string>> = {};
      ((feedbackRes.data ?? []) as EventFeedbackLite[]).forEach((r) => {
        if (!evaluatedByEvent[r.event_id]) evaluatedByEvent[r.event_id] = new Set<string>();
        evaluatedByEvent[r.event_id].add(r.player_id);
      });

      const pending = pastList.filter((e) => {
        const present = presentByEvent[e.id] ?? new Set<string>();
        if (present.size === 0) return false;
        const evaluated = evaluatedByEvent[e.id] ?? new Set<string>();
        for (const pid of present) {
          if (!evaluated.has(pid)) return true;
        }
        return false;
      });

      setPendingEvalEvents(pending);
      setLoading(false);
    })();
  }, [locale]);

  function eventTypeLabel(v: EventLite["event_type"]) {
    if (v === "training") return tr("Entraînement", "Training");
    if (v === "interclub") return "Interclub";
    if (v === "camp") return tr("Stage", "Camp");
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
    const names = Array.from(new Set(Object.values(groupNameById).filter(Boolean)));
    if (names.length === 0) return "—";
    return names.join(" • ");
  }, [groupNameById]);

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
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("common.loading")}</div>
            ) : pendingEvalEvents.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{tr("Aucune évaluation en attente.", "No pending evaluation.")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {pendingEvalEvents.slice(0, 12).map((e) => (
                  <Link key={e.id} href={`/coach/groups/${e.group_id}/planning/${e.id}`} className="marketplace-link">
                    <div className="marketplace-item">
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 900, fontSize: 14 }} className="truncate">
                          {eventTypeLabel(e.event_type)} — {groupNameById[e.group_id] ?? tr("Groupe", "Group")}
                        </div>
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
                      <div style={{ opacity: 0.8, fontWeight: 750, fontSize: 12, marginTop: 4 }}>{fmtDateTime(e.starts_at, dateLocale)}</div>
                      {e.location_text ? <div style={{ opacity: 0.72, fontWeight: 750, fontSize: 12, marginTop: 4 }}>📍 {e.location_text}</div> : null}
                    </div>
                  </Link>
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
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{t("common.loading")}</div>
            ) : upcomingEvents.length === 0 ? (
              <div style={{ opacity: 0.8, fontWeight: 800 }}>{tr("Aucun événement à venir.", "No upcoming event.")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {upcomingEvents.slice(0, 5).map((e) => (
                  <Link key={e.id} href={`/coach/groups/${e.group_id}/planning/${e.id}`} className="marketplace-link">
                    <div className="marketplace-item">
                      <div style={{ fontWeight: 900, fontSize: 14 }} className="truncate">
                        {eventTypeLabel(e.event_type)} — {groupNameById[e.group_id] ?? tr("Groupe", "Group")}
                      </div>
                      <div style={{ opacity: 0.8, fontWeight: 750, fontSize: 12, marginTop: 4 }}>
                        <CalendarDays size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
                        {fmtDateTime(e.starts_at, dateLocale)}
                      </div>
                      {e.location_text ? <div style={{ opacity: 0.72, fontWeight: 750, fontSize: 12, marginTop: 4 }}>📍 {e.location_text}</div> : null}
                    </div>
                  </Link>
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
