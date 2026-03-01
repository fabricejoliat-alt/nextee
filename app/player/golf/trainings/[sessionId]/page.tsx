"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { Flame, Mountain, Smile } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type SessionType = "club" | "private" | "individual";

type SessionDbRow = {
  id: string;
  user_id: string;
  start_at: string;
  location_text: string | null;
  session_type: SessionType;
  club_id: string | null;
  coach_name: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
  total_minutes: number | null;
  created_at: string;
  club_event_id: string | null; // ✅ link to planned coaching event
};

type ItemDbRow = {
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  other_detail?: string | null;
  created_at?: string;
};

type ClubRow = { id: string; name: string | null };

type CoachFeedbackRow = {
  event_id: string;
  player_id: string;
  coach_id: string;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  visible_to_player: boolean;
  private_note: string | null;
  player_note: string | null;
};

type CoachProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
};

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
  return `${weekday} ${dayMonth}`;
}

function fmtHourLabel(iso: string, locale: "fr" | "en") {
  const d = new Date(iso);
  if (locale === "en") return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
  const h = d.getHours();
  const m = d.getMinutes();
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function sameDay(aIso: string, bIso: string) {
  const a = new Date(aIso);
  const b = new Date(bIso);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function typeLabel(t: SessionType, tr: (key: string) => string) {
  if (t === "club") return tr("trainingDetail.typeClub");
  if (t === "private") return tr("trainingDetail.typePrivate");
  return tr("trainingDetail.typeIndividual");
}

function categoryLabel(cat: string, tr: (key: string) => string) {
  const map: Record<string, string> = {
    warmup_mobility: tr("cat.warmup_mobility"),
    long_game: tr("cat.long_game"),
    putting: tr("cat.putting"),
    wedging: tr("cat.wedging"),
    pitching: tr("cat.pitching"),
    chipping: tr("cat.chipping"),
    bunker: tr("cat.bunker"),
    course: tr("cat.course"),
    mental: tr("cat.mental"),
    fitness: tr("cat.fitness"),
    other: tr("cat.other"),
  };
  return map[cat] ?? cat;
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

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

export default function PlayerTrainingDetailPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = String(params?.sessionId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [session, setSession] = useState<SessionDbRow | null>(null);
  const [items, setItems] = useState<ItemDbRow[]>([]);
  const [clubName, setClubName] = useState<string>("");
  const [groupName, setGroupName] = useState<string>("");

  // ✅ coach feedback visible to player
  const [coachFeedback, setCoachFeedback] = useState<CoachFeedbackRow[]>([]);
  const [coachProfilesById, setCoachProfilesById] = useState<Record<string, CoachProfileLite>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        if (!sessionId) throw new Error(t("trainingDetail.error.missingId"));

        const { effectiveUserId: uid } = await resolveEffectivePlayerContext();

        const sRes = await supabase
          .from("training_sessions")
          .select(
            "id,user_id,start_at,location_text,session_type,club_id,coach_name,motivation,difficulty,satisfaction,notes,total_minutes,created_at,club_event_id"
          )
          .eq("id", sessionId)
          .maybeSingle();

        if (sRes.error) throw new Error(sRes.error.message);

        const s = (sRes.data ?? null) as SessionDbRow | null;
        if (!s) throw new Error(t("trainingDetail.error.notFound"));
        if (s.user_id !== uid) throw new Error(t("trainingDetail.error.forbidden"));

        setSession(s);

        const itRes = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes,note,other_detail,created_at")
          .eq("session_id", sessionId)
          .order("created_at", { ascending: true });

        if (itRes.error) throw new Error(itRes.error.message);
        setItems((itRes.data ?? []) as ItemDbRow[]);

        // club name
        if (s.session_type === "club" && s.club_id) {
          const cRes = await supabase.from("clubs").select("id,name").eq("id", s.club_id).maybeSingle();
          if (!cRes.error && cRes.data) setClubName((cRes.data as ClubRow).name ?? t("common.club"));
          else setClubName(t("common.club"));
        } else {
          setClubName("");
        }

        if (s.club_event_id) {
          const evRes = await supabase
            .from("club_events")
            .select("group_id")
            .eq("id", s.club_event_id)
            .maybeSingle();
          const eventGroupId = String((evRes.data as { group_id?: string | null } | null)?.group_id ?? "").trim();
          if (!evRes.error && eventGroupId) {
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData.session?.access_token ?? "";
            if (token) {
              const q = new URLSearchParams({ ids: eventGroupId, child_id: uid });
              const gRes = await fetch(`/api/player/group-names?${q.toString()}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
                cache: "no-store",
              });
              const gJson = await gRes.json().catch(() => ({}));
              if (gRes.ok) {
                const arr = (gJson?.groups ?? []) as Array<{ id: string; name: string | null }>;
                const found = arr.find((g) => g.id === eventGroupId);
                setGroupName(found?.name ?? "");
              } else {
                setGroupName("");
              }
            } else {
              setGroupName("");
            }
          } else {
            setGroupName("");
          }
        } else {
          setGroupName("");
        }

        // ✅ coach feedback (only visible_to_player)
        if (s.club_event_id) {
          const cfRes = await supabase
            .from("club_event_coach_feedback")
            .select("event_id,player_id,coach_id,engagement,attitude,performance,visible_to_player,private_note,player_note")
            .eq("event_id", s.club_event_id)
            .eq("player_id", uid)
            .eq("visible_to_player", true);

          if (cfRes.error) throw new Error(cfRes.error.message);

          const fb = (cfRes.data ?? []) as CoachFeedbackRow[];
          setCoachFeedback(fb);

          // profiles (no join assumption -> 2nd query)
          const coachIds = Array.from(new Set(fb.map((r) => r.coach_id)));
          if (coachIds.length > 0) {
            const pRes = await supabase.from("profiles").select("id,first_name,last_name,avatar_url").in("id", coachIds);
            if (!pRes.error) {
              const map: Record<string, CoachProfileLite> = {};
              (pRes.data ?? []).forEach((p: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null }) => {
                map[p.id] = {
                  id: p.id,
                  first_name: p.first_name ?? null,
                  last_name: p.last_name ?? null,
                  avatar_url: p.avatar_url ?? null,
                };
              });
              setCoachProfilesById(map);
            } else {
              setCoachProfilesById({});
            }
          } else {
            setCoachProfilesById({});
          }
        } else {
          setCoachFeedback([]);
          setCoachProfilesById({});
        }

        setLoading(false);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : t("common.errorLoading");
        setError(message);
        setSession(null);
        setItems([]);
        setClubName("");
        setGroupName("");
        setCoachFeedback([]);
        setCoachProfilesById({});
        setLoading(false);
      }
    })();
  }, [sessionId, t]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {t("trainingDetail.title")}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings">
                {t("common.back")}
              </Link>

              <Link
                className="cta-green cta-green-inline"
                href={sessionId ? `/player/golf/trainings/${sessionId}/edit` : "/player/golf/trainings"}
              >
                {t("common.edit")}
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Content */}
        <div className="glass-section">
          {loading ? (
            <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
          ) : !session ? (
            <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {(() => {
                const durationFromItems = items.reduce((sum, it) => sum + Math.max(0, Number(it.minutes ?? 0)), 0);
                const sessionDuration = Math.max(1, Number(session.total_minutes ?? 0) || durationFromItems || 0);
                const sessionEnd = new Date(new Date(session.start_at).getTime() + sessionDuration * 60_000).toISOString();
                const isMultiDaySession = !sameDay(session.start_at, sessionEnd);
                const displayLocation = (session.location_text ?? "").trim();
                const trainingGroupLabel = groupName || clubName || (locale === "fr" ? "Groupe" : "Group");
                const sessionTitle =
                  session.session_type === "club"
                    ? `${locale === "fr" ? "Entraînement" : "Training"} • ${trainingGroupLabel}`
                    : `${typeLabel(session.session_type, t)}`;
                return (
                  <div className="glass-card" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
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
                          {fmtDateLabelNoTime(session.start_at, locale === "fr" ? "fr" : "en")} {locale === "fr" ? "au" : "to"}{" "}
                          {fmtDateLabelNoTime(sessionEnd, locale === "fr" ? "fr" : "en")}
                        </div>
                      ) : (
                        <div>
                          {fmtDateLabelNoTime(session.start_at, locale === "fr" ? "fr" : "en")}{" "}
                          <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.62)" }}>
                            {locale === "fr"
                              ? `• de ${fmtHourLabel(session.start_at, "fr")} à ${fmtHourLabel(sessionEnd, "fr")}`
                              : `• from ${fmtHourLabel(session.start_at, "en")} to ${fmtHourLabel(sessionEnd, "en")}`}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="hr-soft" style={{ margin: "1px 0" }} />

                    <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                      <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                        {sessionTitle}
                      </div>
                      {session.session_type === "club" && clubName ? (
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

                  </div>
                );
              })()}

              {session.club_event_id ? (
                <div className="glass-card" style={{ borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("trainingDetail.coachEvaluation")}
                  </div>

                  {coachFeedback.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {t("trainingDetail.noCoachEvaluation")}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {coachFeedback.map((fb, idx) => {
                        const cp = coachProfilesById[fb.coach_id];
                        const coachName = cp ? nameOf(cp.first_name, cp.last_name) : t("common.coach");
                        const initials = (cp ? `${cp.first_name?.[0] ?? ""}${cp.last_name?.[0] ?? ""}` : "C").toUpperCase();

                        return (
                          <div
                            key={`${fb.coach_id}-${idx}`}
                            style={{
                              display: "grid",
                              gap: 10,
                            }}
                          >
                            <div
                              style={{
                                border: "1px solid rgba(0,0,0,0.10)",
                                borderRadius: 12,
                                background: "#fff",
                                padding: "8px 10px",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <div
                                aria-hidden
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: "50%",
                                  overflow: "hidden",
                                  border: "1px solid rgba(32,99,62,0.28)",
                                  background: "rgba(53,72,59,0.14)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flex: "0 0 auto",
                                  color: "rgba(16,56,34,0.95)",
                                  fontWeight: 950,
                                  fontSize: 11,
                                }}
                              >
                                {cp?.avatar_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={cp.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                  initials
                                )}
                              </div>
                              <div style={{ fontWeight: 950, color: "rgba(0,0,0,0.84)" }}>{coachName}</div>
                            </div>

                            <RatingBar icon={<Flame size={16} />} label={t("trainingDetail.engagement")} value={fb.engagement} />
                            <RatingBar icon={<Mountain size={16} />} label={t("trainingDetail.attitude")} value={fb.attitude} />
                            <RatingBar icon={<Smile size={16} />} label={t("trainingDetail.performance")} value={fb.performance} />

                            {String(fb.player_note ?? "").trim() ? (
                              <div style={{ display: "grid", gap: 8 }}>
                                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>{t("trainingDetail.coachNote")}</div>
                                <div
                                  style={{
                                    border: "1px solid rgba(0,0,0,0.10)",
                                    borderRadius: 14,
                                    background: "#fff",
                                    padding: 12,
                                    fontSize: 13,
                                    fontWeight: 800,
                                    color: "rgba(0,0,0,0.72)",
                                    lineHeight: 1.4,
                                    whiteSpace: "pre-wrap",
                                  }}
                                >
                                  {fb.player_note}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="glass-card" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, padding: 12, display: "grid", gap: 8 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>{t("trainingDetail.sections")}</div>
                {items.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                    {items.map((it, i) => {
                      const extra = String(it.note ?? it.other_detail ?? "").trim();
                      return (
                        <li key={`${it.session_id}-${i}`} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                          {categoryLabel(it.category, t)} — {it.minutes} {t("common.min")}
                          {extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("trainingDetail.noSection")}</div>
                )}
              </div>

              <div className="glass-card" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, padding: 12, display: "grid", gap: 10 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {locale === "fr" ? "Mes sensations et remarques" : "My feelings and notes"}
                </div>

                <RatingBar icon={<Flame size={16} />} label={t("common.motivation")} value={session.motivation} />
                <RatingBar icon={<Mountain size={16} />} label={t("common.difficulty")} value={session.difficulty} />
                <RatingBar icon={<Smile size={16} />} label={t("common.satisfaction")} value={session.satisfaction} />

                {session.notes ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>{t("trainingDetail.notes")}</div>
                    <div
                      style={{
                        border: "1px solid rgba(0,0,0,0.10)",
                        borderRadius: 14,
                        background: "#fff",
                        padding: 12,
                        fontSize: 13,
                        fontWeight: 800,
                        color: "rgba(0,0,0,0.72)",
                        lineHeight: 1.4,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {session.notes}
                    </div>
                  </div>
                ) : null}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => router.push("/player/golf/trainings")}>
                    {t("trainingDetail.backToList")}
                  </button>

                  <Link className="btn" href={`/player/golf/trainings/${sessionId}/edit`}>
                    {t("common.edit")}
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
