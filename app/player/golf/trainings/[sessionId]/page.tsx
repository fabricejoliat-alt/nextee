"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Flame, Mountain, Smile, Award } from "lucide-react";
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
};

function fmtDateTime(iso: string, locale: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
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

  // ✅ coach feedback visible to player
  const [coachFeedback, setCoachFeedback] = useState<CoachFeedbackRow[]>([]);
  const [coachProfilesById, setCoachProfilesById] = useState<Record<string, CoachProfileLite>>({});

  const totalMinutes = useMemo(() => {
    if (session?.total_minutes != null) return session.total_minutes;
    return items.reduce((sum, it) => sum + (it.minutes || 0), 0);
  }, [session?.total_minutes, items]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        if (!sessionId) throw new Error(t("trainingDetail.error.missingId"));

        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr || !userRes.user) throw new Error(t("trainingDetail.error.invalidSession"));
        const uid = userRes.user.id;

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
            const pRes = await supabase.from("profiles").select("id,first_name,last_name").in("id", coachIds);
            if (!pRes.error) {
              const map: Record<string, CoachProfileLite> = {};
              (pRes.data ?? []).forEach((p: any) => {
                map[p.id] = { id: p.id, first_name: p.first_name ?? null, last_name: p.last_name ?? null };
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
      } catch (e: any) {
        setError(e?.message ?? t("common.errorLoading"));
        setSession(null);
        setItems([]);
        setClubName("");
        setCoachFeedback([]);
        setCoachProfilesById({});
        setLoading(false);
      }
    })();
  }, [sessionId]);

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
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : !session ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {/* Top line */}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <div className="marketplace-item-title" style={{ fontSize: 14, fontWeight: 950 }}>
                    {fmtDateTime(session.start_at, locale)}
                  </div>
                  <div className="marketplace-price-pill">{totalMinutes > 0 ? `${totalMinutes} min` : "—"}</div>
                </div>

                {/* Type + club + location */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {session.session_type === "club" ? (
                    <span className="pill-soft">{clubName || t("common.club")}</span>
                  ) : (
                    <span className="pill-soft">{typeLabel(session.session_type, t)}</span>
                  )}

                  {session.club_event_id ? <span className="pill-soft">{t("common.coach")}</span> : null}

                  {session.location_text && (
                    <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}>
                      📍 {session.location_text}
                    </span>
                  )}
                </div>

                {/* Coach (optional, your existing field) */}
                {session.coach_name && (
                  <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.62)" }}>
                    👤 {t("common.coach")} : <span style={{ fontWeight: 950, color: "rgba(0,0,0,0.78)" }}>{session.coach_name}</span>
                  </div>
                )}

                {/* ✅ Coach feedback section */}
                {session.club_event_id ? (
                  <>
                    <div className="hr-soft" style={{ margin: "2px 0" }} />
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950, color: "rgba(0,0,0,0.75)", fontSize: 12 }}>
                        <Award size={16} />
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

                            return (
                              <div
                                key={`${fb.coach_id}-${idx}`}
                                style={{
                                  border: "1px solid rgba(0,0,0,0.10)",
                                  borderRadius: 14,
                                  background: "rgba(255,255,255,0.65)",
                                  padding: 12,
                                  display: "grid",
                                  gap: 10,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                                  <div style={{ fontWeight: 950 }}>{coachName}</div>
                                  <span className="pill-soft">{t("trainingDetail.scoreOver6")}</span>
                                </div>

                                <div className="grid-2">
                                  <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.65)" }}>
                                    {t("trainingDetail.engagement")} : <span style={{ fontWeight: 950, color: "rgba(0,0,0,0.80)" }}>{fb.engagement ?? "—"}</span>
                                  </div>
                                  <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.65)" }}>
                                    {t("trainingDetail.attitude")} : <span style={{ fontWeight: 950, color: "rgba(0,0,0,0.80)" }}>{fb.attitude ?? "—"}</span>
                                  </div>
                                </div>

                                <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.65)" }}>
                                  {t("trainingDetail.performance")} : <span style={{ fontWeight: 950, color: "rgba(0,0,0,0.80)" }}>{fb.performance ?? "—"}</span>
                                </div>

                                {String(fb.player_note ?? "").trim() ? (
                                  <>
                                    <div className="hr-soft" style={{ margin: "2px 0" }} />
                                    <div style={{ display: "grid", gap: 8 }}>
                                      <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>{t("trainingDetail.coachNote")}</div>
                                      <div
                                        style={{
                                          border: "1px solid rgba(0,0,0,0.10)",
                                          borderRadius: 14,
                                          background: "rgba(255,255,255,0.70)",
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
                                  </>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                ) : null}

                {/* Postes */}
                {items.length > 0 && <div className="hr-soft" style={{ margin: "2px 0" }} />}

                {items.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>{t("trainingDetail.sections")}</div>

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
                  </div>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("trainingDetail.noSection")}</div>
                )}

                {items.length > 0 && <div className="hr-soft" style={{ margin: "2px 0" }} />}

                {/* Sensations */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>{t("trainingDetail.feelings")}</div>

                  <RatingBar icon={<Flame size={16} />} label={t("common.motivation")} value={session.motivation} />
                  <RatingBar icon={<Mountain size={16} />} label={t("common.difficulty")} value={session.difficulty} />
                  <RatingBar icon={<Smile size={16} />} label={t("common.satisfaction")} value={session.satisfaction} />
                </div>

                {/* Notes */}
                {session.notes && (
                  <>
                    <div className="hr-soft" style={{ margin: "2px 0" }} />
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.75)" }}>{t("trainingDetail.notes")}</div>
                      <div
                        style={{
                          border: "1px solid rgba(0,0,0,0.10)",
                          borderRadius: 14,
                          background: "rgba(255,255,255,0.65)",
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
                  </>
                )}

                {/* Actions bottom */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className="btn" onClick={() => router.push("/player/golf/trainings")}>
                    {t("trainingDetail.backToList")}
                  </button>

                  <Link className="btn" href={`/player/golf/trainings/${sessionId}/edit`}>
                    {t("common.edit")}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
