"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { loadManagerParticipant, participantDate, participantError } from "@/lib/managerParticipant";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerFormat, managerLocaleTag } from "@/lib/managerLocale";
import groupStyles from "@/components/manager/GroupsManagement.module.css";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { ArrowLeft, Mountain, Smile, Target } from "lucide-react";
import { DifficultyIcon, EvaluationIconBadge, MotivationIcon, SatisfactionIcon } from "@/components/evaluations/StandardEvaluationIcons";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type ClubRow = { id: string; name: string | null };
type GroupRow = { id: string; name: string | null };

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type AttendeeRow = {
  player_id: string;
  status: "expected" | "present" | "absent" | "excused";
};

type PlayerFeedbackRow = {
  event_id: string;
  player_id: string;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  player_note: string | null;
  submitted_at: string | null;
};

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

type SessionType = "club" | "private" | "individual";

type TrainingSessionRow = {
  id: string;
  user_id: string;
  start_at: string;
  location_text: string | null;
  session_type: SessionType;
  club_id: string | null;
  coach_user_id: string | null;
  coach_name: string | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  notes: string | null;
  total_minutes: number;
  club_event_id: string | null;
  created_at: string;
};

type TrainingItemRow = {
  id: string;
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  other_detail: string | null;
  created_at: string;
};

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function initials(p?: { first_name: string | null; last_name: string | null } | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return (fi + li) || "👤";
}

function PlayerAvatar({ player }: { player: ProfileRow | null }) {
  if (player?.avatar_url) {
    return (
      <img
        src={player.avatar_url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return initials(player);
}

function StatBar({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  const v = typeof value === "number" ? value : 0;
  const pct = Math.max(0, Math.min(100, (v / 6) * 100));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ display: "inline-flex" }}>{icon}</span>
          <span style={{ fontWeight: 950, fontSize: 12, color: "rgba(0,0,0,0.72)" }}>{label}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)", width: 34, textAlign: "right" }}>
          {value ?? "—"}
        </div>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function ManagerEventPlayerDetailPage() {
  const { locale, t } = useI18n();
  const version = useRef(0);
  const season = useSearchParams().get("season");
  const params = useParams<{ id: string; eventId: string; playerId: string }>();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const seasonQuery = season ? `?season=${encodeURIComponent(season)}` : "";
  const activityHref = `/manager/groups/${groupId}/planning/${eventId}${seasonQuery}`;

  const [event, setEvent] = useState<EventRow | null>(null);
  const [clubName, setClubName] = useState("");
  const [groupName, setGroupName] = useState("");

  const [player, setPlayer] = useState<ProfileRow | null>(null);
  const [attendance, setAttendance] = useState<AttendeeRow | null>(null);

  const [playerFb, setPlayerFb] = useState<PlayerFeedbackRow | null>(null);
  const [coachFb, setCoachFb] = useState<CoachFeedbackRow | null>(null);

  const [session, setSession] = useState<TrainingSessionRow | null>(null);
  const [items, setItems] = useState<TrainingItemRow[]>([]);

  useEffect(() => {
    const current = ++version.current;
    setLoading(true); setError(null); setEvent(null); setPlayer(null);
    async function load() {
      try {
        const info = await loadManagerParticipant<{ event: EventRow; player: ProfileRow; attendanceStatus: AttendeeRow["status"]; playerFeedback: PlayerFeedbackRow | null; feedback: CoachFeedbackRow | null; session: TrainingSessionRow | null; sessionItems: TrainingItemRow[] }>(eventId, playerId, groupId);
        if (current !== version.current) return;
        const [club, group] = await Promise.all([
          supabase.from("organizations").select("id,name").eq("id", info.event.club_id).maybeSingle(),
          supabase.from("coach_groups").select("id,name").eq("id", groupId).maybeSingle(),
        ]);
        if (current !== version.current) return;
        if (club.error || group.error) throw new Error("coach.error.load");
        setEvent(info.event); setPlayer(info.player); setAttendance({player_id:playerId,status:info.attendanceStatus ?? "expected"});
        setClubName((club.data as ClubRow | null)?.name ?? ""); setGroupName((group.data as GroupRow | null)?.name ?? "");
        setPlayerFb(info.playerFeedback); setCoachFb(info.feedback); setSession(info.session); setItems(info.sessionItems ?? []);
      } catch (cause) { if (current === version.current) setError(participantError(cause, "coach.error.load")); }
      finally { if (current === version.current) setLoading(false); }
    }
    void load();
    return () => { version.current += 1; };
  }, [groupId, eventId, playerId]);

  const title = useMemo(() => {
    if (!player) return t("manager.participant.title");
    return managerFormat(t, "manager.participant.detail", { name: nameOf(player.first_name, player.last_name) });
  }, [player, t]);

  const attendanceLabel = useMemo(() => {
    if (!attendance) return t("manager.content.undefined");
    if (attendance.status === "present") return t("manager.content.present");
    if (attendance.status === "absent") return t("coach.camps.absent");
    if (attendance.status === "excused") return t("manager.planning.excused");
    return t("manager.planning.expected");
  }, [attendance, t]);

  const attendanceStyle = useMemo((): React.CSSProperties => {
    if (!attendance) return { background: "rgba(0,0,0,0.08)", color: "rgba(0,0,0,0.72)" };
    if (attendance.status === "present") return { background: "rgba(34,197,94,0.16)", color: "rgba(20,83,45,1)" };
    if (attendance.status === "absent") return { background: "rgba(239,68,68,0.16)", color: "rgba(127,29,29,1)" };
    if (attendance.status === "excused") return { background: "rgba(245,158,11,0.16)", color: "rgba(120,53,15,1)" };
    return { background: "rgba(59,130,246,0.12)", color: "rgba(30,64,175,1)" };
  }, [attendance]);

  return (
    <main className={`player-dashboard-bg ${groupStyles.page}`}>
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <h1 className="section-title" style={{ marginBottom: 0 }}>{title}</h1>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={activityHref}>
                <ArrowLeft size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                {t("common.back")}</Link>
            </div>
          </div>

          {error && <div className="marketplace-error" role="alert">{t(error)}</div>}
        </div>

        {/* Content */}
        <div className="glass-section">
          {loading ? (
            <div className="glass-card"><CompactLoadingBlock label={t("manager.content.loading")} /></div>
          ) : !event || !player ? (
            <div className="glass-card" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="glass-card" style={{ padding: 16, display: "grid", gap: 14 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                    <div
                      style={{
                        width: 68,
                        height: 68,
                        borderRadius: 18,
                        overflow: "hidden",
                        border: "1px solid rgba(0,0,0,0.10)",
                        background: "rgba(255,255,255,0.80)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 950,
                        color: "var(--green-dark)",
                        flexShrink: 0,
                      }}
                    >
                      <PlayerAvatar player={player} />
                    </div>
                    <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 11, letterSpacing: 0.8, fontWeight: 900, color: "rgba(0,0,0,0.58)" }}>{t("manager.participant.title")}</div>
                      <div style={{ fontWeight: 980, fontSize: 20 }} className="truncate">{nameOf(player.first_name, player.last_name)}</div>
                      <div style={{ fontSize: 12, fontWeight: 850, color: "rgba(0,0,0,0.65)" }}>
                        {t("manager.settings.volume.handicap")} {typeof player.handicap === "number" ? Number(player.handicap).toLocaleString(managerLocaleTag(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"}
                      </div>
                    </div>
                  </div>

                  <span className="pill-soft" style={{ ...attendanceStyle, fontWeight: 950 }}>{attendanceLabel}</span>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="pill-soft">{participantDate(event.starts_at, locale)}</span>
                  <span className="pill-soft">{event.duration_minutes} {t("common.min")}</span>
                  <span className="pill-soft">{clubName || t("manager.groups.club")}</span>
                  <span className="pill-soft">{groupName || t("manager.content.group")}</span>
                  {event.series_id ? <span className="pill-soft">{t("coach.form.recurring")}</span> : <span className="pill-soft">{t("coach.form.single")}</span>}
                  {event.location_text ? <span className="pill-soft">📍 {event.location_text}</span> : null}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
                  alignItems: "start",
                }}
              >
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{t("manager.editor.structure")}</div>
                  {!session ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                      {t("manager.participant.noSession")}</div>
                  ) : items.length === 0 ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("manager.participant.noItems")}</div>
                  ) : (
                    <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                      {items.map((it) => {
                        const extra = String(it.note ?? it.other_detail ?? "").trim();
                        return (
                          <li key={it.id} style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                            {t(`coach.form.category.${it.category}`)} — {it.minutes} {t("common.min")}{extra ? <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{t("manager.participant.playerFeedback")}</div>
                  {!playerFb ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("manager.participant.notSubmitted")}</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      <StatBar icon={<EvaluationIconBadge><MotivationIcon size={17} /></EvaluationIconBadge>} label={t("manager.settings.volume.motivation")} value={playerFb.motivation} />
                      <StatBar icon={<EvaluationIconBadge><DifficultyIcon size={17} /></EvaluationIconBadge>} label={t("common.difficulty")} value={playerFb.difficulty} />
                      <StatBar icon={<EvaluationIconBadge><SatisfactionIcon size={17} /></EvaluationIconBadge>} label={t("common.satisfaction")} value={playerFb.satisfaction} />
                      {playerFb.player_note ? (
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
                          {playerFb.player_note}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("manager.participant.noPlayerNote")}</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{t("manager.participant.evaluation")}</div>
                  {!coachFb ? (
                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>{t("manager.participant.notEvaluated")}</div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      <StatBar icon={<Target size={16} />} label={t("trainingDetail.engagement")} value={coachFb.engagement} />
                      <StatBar icon={<Smile size={16} />} label={t("trainingDetail.attitude")} value={coachFb.attitude} />
                      <StatBar icon={<Mountain size={16} />} label={t("trainingDetail.performance")} value={coachFb.performance} />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span className="pill-soft">{coachFb.visible_to_player ? t("manager.participant.visible") : t("manager.participant.hidden")}</span>
                      </div>
                      {coachFb.player_note ? (
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
                          <b>{t("manager.participant.playerNote")}</b>
                          <div style={{ height: 8 }} />
                          {coachFb.player_note}
                        </div>
                      ) : null}
                      {coachFb.private_note ? (
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
                          <b>{t("manager.participant.privateNote")}</b>
                          <div style={{ height: 8 }} />
                          {coachFb.private_note}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <Link className="btn" href={activityHref}>
                    {t("manager.participant.backParticipants")}</Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
