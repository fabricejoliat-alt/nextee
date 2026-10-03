"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { loadManagerParticipant, participantDate, participantError, type ManagerEvaluationSnapshot } from "@/lib/managerParticipant";
import { managerActivityLabel, managerFormat } from "@/lib/managerLocale";
import groupStyles from "@/components/manager/GroupsManagement.module.css";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { createAppNotification } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import EvaluationResponseField from "@/components/evaluations/EvaluationResponseField";
import { validateResponseValue, type EventEvaluationCriterion } from "@/lib/evaluationCriteria";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
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

const MAX_SCORE = 6;

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 900,
  color: "rgba(0,0,0,0.70)",
};

export default function ManagerEventPlayerFeedbackEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string; playerId: string }>();
  const { locale, t } = useI18n();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [player, setPlayer] = useState<ProfileRow | null>(null);
  const [orderedPlayerIds, setOrderedPlayerIds] = useState<string[]>([]);
  const [attendanceStatus, setAttendanceStatus] = useState<"present" | "absent" | null>(null);
  const [snapshot, setSnapshot] = useState<ManagerEvaluationSnapshot | null>(null);
  const [committed, setCommitted] = useState(false);
  const mutation = useRef(false);
  const version = useRef(0);
  const season = useSearchParams().get("season");
  const seasonQuery = season ? `?season=${encodeURIComponent(season)}` : "";
  const activityHref = `/manager/groups/${groupId}/planning/${eventId}${seasonQuery}`;
  const playerHref = `/manager/groups/${groupId}/planning/${eventId}/players/${playerId}${seasonQuery}`;
  const [customCriteria, setCustomCriteria] = useState<EventEvaluationCriterion[]>([]);
  const [customResponses, setCustomResponses] = useState<Record<string, string | number | boolean | null>>({});

  const [draft, setDraft] = useState<CoachFeedbackRow>({
    event_id: eventId,
    player_id: playerId,
    coach_id: "",
    engagement: null,
    attitude: null,
    performance: null,
    visible_to_player: false,
    private_note: null,
    player_note: null,
  });

  useEffect(() => {
    const current = ++version.current;
    setLoading(true); setError(null); setEvent(null); setPlayer(null); setSnapshot(null); setCommitted(false); setBusy(false); mutation.current = false;
    async function load() {
      try {
        const info = await loadManagerParticipant<{ event: EventRow; player: ProfileRow; meId: string; orderedPlayerIds: string[] }>(eventId, playerId, groupId);
        const result = await supabase.rpc("get_manager_evaluation_snapshot_v1", { p_event_id: eventId, p_player_id: playerId });
        if (current !== version.current) return;
        if (result.error) throw result.error;
        const loaded = result.data as ManagerEvaluationSnapshot | null;
        if (!loaded || loaded.event?.group_id !== groupId || loaded.event.id !== eventId || loaded.attendee?.player_id !== playerId) throw new Error("coach.error.attendee");
        setEvent({ ...info.event, ...loaded.event }); setPlayer(info.player); setMeId(info.meId); setOrderedPlayerIds(info.orderedPlayerIds ?? []);
        setSnapshot(loaded); setAttendanceStatus(loaded.attendee.coach_recorded_status);
        setDraft(loaded.feedback[0] ?? { event_id: eventId, player_id: playerId, coach_id: info.meId, engagement: null, attitude: null, performance: null, visible_to_player: false, private_note: null, player_note: null });
        setCustomCriteria(loaded.criteria); setCustomResponses(Object.fromEntries(loaded.responses.map(row => [row.event_criterion_id, row.value_json])));
      } catch (cause) { if (current === version.current) setError(participantError(cause, "coach.error.load")); }
      finally { if (current === version.current) setLoading(false); }
    }
    void load();
    return () => { version.current += 1; };
  }, [eventId, playerId, groupId]);

  const unavailable = !snapshot || snapshot.event.status === "cancelled" || !snapshot.event.requires_evaluation ||
    new Date(snapshot.event.ends_at ?? new Date(new Date(snapshot.event.starts_at).getTime() + snapshot.event.duration_minutes * 60_000)).getTime() > Date.now();
  const locked = busy || committed || unavailable;
  const canSave = !locked && !loading && Boolean(event && player && attendanceStatus);

  const nextPlayerId = useMemo(() => {
    const idx = orderedPlayerIds.indexOf(playerId);
    if (idx < 0) return null;
    return orderedPlayerIds[idx + 1] ?? null;
  }, [orderedPlayerIds, playerId]);

  async function save(goNext = false) {
    if (!canSave || mutation.current || !snapshot) return;
    mutation.current = true;
    const current = version.current;
    let saved = false;
    setBusy(true); setError(null);
    try {
      if (attendanceStatus === "present") {
        if ([draft.engagement, draft.attitude, draft.performance].some(value => value == null || value < 1 || value > 6)) throw new Error("ratings_required");
        const missing = customCriteria.find(criterion => criterion.snapshot_is_required && !validateResponseValue(criterion.snapshot_response_format, criterion.snapshot_choices, customResponses[criterion.id]));
        if (missing) throw new Error("required_criteria_missing");
      }
      const result = await supabase.rpc("save_manager_event_feedback_v2", {
        p_event_id: eventId, p_player_id: playerId, p_expected: snapshot,
        p_values: { attendance: attendanceStatus, feedback: {
          engagement: draft.engagement, attitude: draft.attitude, performance: draft.performance,
          visible_to_player: draft.visible_to_player, private_note: draft.private_note?.trim() || null, player_note: draft.player_note?.trim() || null,
        }, responses: Object.fromEntries(customCriteria.map(criterion => [criterion.id, customResponses[criterion.id] ?? null])) },
      });
      if (result.error) throw result.error;
      if (result.data?.ok !== true) throw new Error("unconfirmed_save");
      saved = true;
      if (current !== version.current) return;
      setCommitted(true);
      if (result.data.notification_required && meId) {
        const msg = await getNotificationMessage("notif.coachPlayerEvaluated", locale, {
          playerName: nameOf(player?.first_name ?? null, player?.last_name ?? null),
          eventType: managerActivityLabel(t, event!.event_type), dateTime: participantDate(event!.starts_at, locale),
        });
        await createAppNotification({ actorUserId: meId, kind: "coach_player_evaluated", title: msg.title, body: msg.body,
          data: { event_id: eventId, group_id: groupId, player_id: playerId, url: `/player/golf/trainings/new?club_event_id=${eventId}` }, recipientUserIds: [playerId] });
      }
      if (current === version.current) router.push(goNext ? nextPlayerId ? `/manager/groups/${groupId}/planning/${eventId}/players/${nextPlayerId}/edit${seasonQuery}` : activityHref : playerHref);
    } catch (cause) { if (current === version.current) setError(saved ? "coach.error.planningNotification" : participantError(cause)); }
    finally { if (current === version.current) { setBusy(false); if (!saved) mutation.current = false; } }
  }

  return (
    <main className={`player-dashboard-bg ${groupStyles.page}`}>
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <h1 className="section-title" style={{ marginBottom: 0 }}>
                {managerFormat(t, "manager.participant.evaluate", { name: player ? nameOf(player.first_name, player.last_name) : t("manager.content.player") })}
              </h1>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={playerHref}>
                <ArrowLeft size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                {t("common.back")}</Link>
            </div>
          </div>

          {error && <div className="marketplace-error" role="alert">{t(error)}</div>}
          {committed ? <p role="status">{t("coach.editor.saved")} <Link href={playerHref}>{t("coach.editor.viewSaved")}</Link></p> : null}
          {!loading && snapshot && unavailable ? <p role="status">{t("manager.participant.unavailable")}</p> : null}
        </div>

        {/* Content */}
        <div className="glass-section">
          {loading ? (
            <div className="glass-card"><CompactLoadingBlock label={t("manager.content.loading")} /></div>
          ) : !event || !player ? (
            <div className="glass-card" style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noData")}</div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="glass-card" style={{ padding: 16, display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0, justifyContent: "space-between", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: 64,
                      height: 64,
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
                    <div style={{ fontSize: 20, fontWeight: 980 }} className="truncate">{nameOf(player.first_name, player.last_name)}</div>
                  </div>
                </div>
                  <div style={{ display: "inline-flex", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, overflow: "hidden", flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => setAttendanceStatus("present")}
                      aria-pressed={attendanceStatus === "present"}
                      disabled={locked}
                      style={{
                        border: "none",
                        borderRight: "1px solid rgba(0,0,0,0.10)",
                        background: attendanceStatus === "present" ? "#22c55e" : "transparent",
                        color: attendanceStatus === "present" ? "#fff" : "rgba(0,0,0,0.82)",
                        fontWeight: 900,
                        fontSize: 11,
                        lineHeight: 1.1,
                        padding: "6px 10px",
                        cursor: locked ? "not-allowed" : "pointer",
                      }}
                    >
                      {t("manager.content.present")}</button>
                    <button
                      type="button"
                      onClick={() => setAttendanceStatus("absent")}
                      aria-pressed={attendanceStatus === "absent"}
                      disabled={locked}
                      style={{
                        border: "none",
                        background: attendanceStatus === "absent" ? "#ef4444" : "transparent",
                        color: attendanceStatus === "absent" ? "#fff" : "rgba(0,0,0,0.82)",
                        fontWeight: 900,
                        fontSize: 11,
                        lineHeight: 1.1,
                        padding: "6px 10px",
                        cursor: locked ? "not-allowed" : "pointer",
                      }}
                    >
                      {t("coach.camps.absent")}</button>
                  </div>
                </div>

                <p style={{ margin: 0 }}>{t("manager.participant.attendanceDraft")}</p>
                {attendanceStatus == null ? <p role="status">{t("manager.participant.attendanceRequired")}</p> : null}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="pill-soft">{participantDate(event.starts_at, locale)}</span>
                  <span className="pill-soft">{event.duration_minutes} {t("common.min")}</span>
                  {event.location_text ? <span className="pill-soft">📍 {event.location_text}</span> : null}
                </div>

              </div>

              <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>{t("manager.participant.ratingTitle")}</div>
                <div
                  style={{
                    border: "1px solid rgba(0,0,0,0.10)",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.68)",
                    padding: 10,
                    fontSize: 12,
                    fontWeight: 800,
                    color: "rgba(0,0,0,0.65)",
                    lineHeight: 1.45,
                  }}
                >
                  <div>{t("manager.participant.engagementHelp")}</div>
                  <div>{t("manager.participant.attitudeHelp")}</div>
                  <div>{t("manager.participant.performanceHelp")}</div>
                </div>

                {attendanceStatus === "absent" ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>
                    {t("manager.participant.absentHelp")}</div>
                ) : (
                  <>
                    <div className="grid-2">
                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingDetail.engagement")}</span>
                        <select
                          value={draft.engagement ?? ""}
                          onChange={(e) => setDraft((p) => ({ ...p, engagement: e.target.value ? Number(e.target.value) : null }))}
                          disabled={locked}
                        >
                          <option value="">-</option>
                          {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label style={{ display: "grid", gap: 6 }}>
                        <span style={fieldLabelStyle}>{t("trainingDetail.attitude")}</span>
                        <select
                          value={draft.attitude ?? ""}
                          onChange={(e) => setDraft((p) => ({ ...p, attitude: e.target.value ? Number(e.target.value) : null }))}
                          disabled={locked}
                        >
                          <option value="">-</option>
                          {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={fieldLabelStyle}>{t("trainingDetail.performance")}</span>
                      <select
                        value={draft.performance ?? ""}
                        onChange={(e) => setDraft((p) => ({ ...p, performance: e.target.value ? Number(e.target.value) : null }))}
                        disabled={locked}
                      >
                        <option value="">-</option>
                        {Array.from({ length: MAX_SCORE }, (_, i) => i + 1).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>

              {attendanceStatus !== "absent" && customCriteria.length ? (
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 14 }}>
                  <div><div className="card-title" style={{ marginBottom: 3 }}>{t("manager.participant.criteria")}</div><div style={{ fontSize: 11, opacity: .6 }}>{t("manager.participant.required")}</div></div>
                  {customCriteria.map((criterion) => (
                    <label key={criterion.id} style={{ display: "grid", gap: 7 }}>
                      <span style={fieldLabelStyle}>{criterion.snapshot_name}{criterion.snapshot_is_required ? " *" : ""}</span>
                      {criterion.snapshot_description ? <small style={{ opacity: .65 }}>{criterion.snapshot_description}</small> : null}
                      <EvaluationResponseField name={criterion.snapshot_name} format={criterion.snapshot_response_format} choices={criterion.snapshot_choices} value={customResponses[criterion.id]} disabled={locked} onChange={(value) => setCustomResponses((current) => ({ ...current, [criterion.id]: value }))}/>
                    </label>
                  ))}
                </div>
              ) : null}

              {attendanceStatus !== "absent" ? (
                <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{t("manager.participant.visibility")}</div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={locked}
                      onClick={() => setDraft((p) => ({ ...p, visible_to_player: !p.visible_to_player }))}
                      aria-pressed={draft.visible_to_player}
                      style={
                        draft.visible_to_player
                          ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.25)" }
                          : {}
                      }
                    >
                      {draft.visible_to_player ? <Eye size={16} style={{ marginRight: 6 }} /> : <EyeOff size={16} style={{ marginRight: 6 }} />}
                      {draft.visible_to_player ? t("manager.participant.visible") : t("manager.participant.hidden")}
                    </button>
                  </div>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={fieldLabelStyle}>{t("manager.participant.playerNote")}</span>
                    <textarea
                      maxLength={4000}
                      value={draft.player_note ?? ""}
                      onChange={(e) => setDraft((p) => ({ ...p, player_note: e.target.value }))}
                      disabled={locked}
                      style={{ minHeight: 90 }}
                      placeholder={t("manager.participant.playerNote")}
                    />
                  </label>
                </div>
              ) : null}

              <div className="glass-card" style={{ padding: 14, display: "grid", gap: 12 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>{t("manager.participant.privateNote")}</div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={fieldLabelStyle}>{t("manager.participant.privateHelp")}</span>
                  <textarea
                    maxLength={4000}
                    value={draft.private_note ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, private_note: e.target.value }))}
                    disabled={locked}
                    style={{ minHeight: 90 }}
                    placeholder={t("manager.participant.privateNote")}
                  />
                </label>
              </div>

              <div className="glass-card" style={{ padding: 12 }}>
                <div style={{ display: "grid", gap: 8, width: "100%" }}>
                  <button
                    type="button"
                    className="cta-green cta-green-inline"
                    disabled={!canSave}
                    onClick={() => save(true)}
                    style={{
                      width: "100%",
                      justifyContent: "center",
                    }}
                  >
                    {busy ? t("manager.settings.saving") : nextPlayerId ? t("manager.participant.next") : t("manager.participant.close")}
                  </button>
                  <Link className="btn" href={playerHref} style={{ width: "100%", textAlign: "center" }}>
                    {t("manager.settings.cancel")}</Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
