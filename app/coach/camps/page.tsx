"use client";
import { coachCampRegistrationChanges } from "@/lib/coachCampRegistrations";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale, coachText } from "@/lib/i18n/coachMessages";
import { coachCaughtErrorKey, coachUiErrorKey } from "@/lib/coachUiErrors";
import { CalendarDays, ChevronRight, Eye, Search, Users, X } from "lucide-react";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";
import styles from "@/app/manager/camps/Camps.module.css";
import coachStyles from "./CoachCamps.module.css";
import CoachPlayerActivityCard from "@/components/coach/player-detail/CoachPlayerActivityCard";

type ProfileLite = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type CampRow = {
  id: string;
  club_name: string;
  title: string;
  notes: string | null;
  head_coach: ProfileLite | null;
  available_players: ProfileLite[];
  player_registrations: Array<{
    player_id: string;
    registration_status: "invited" | "registered" | "declined";
    day_status_by_day_index: Record<string, "present" | "absent">;
    player: ProfileLite | null;
  }>;
    days: Array<{
      event_id: string;
      day_index: number;
    practical_info: string | null;
    starts_at: string | null;
    ends_at: string | null;
    location_text: string | null;
      status: string;
      group_id: string;
      counts: { present: number; not_registered: number; absent: number; excused: number };
      participants_count: number;
      participants: ProfileLite[];
    }>;
  };
type CampState = "all" | "upcoming" | "in_progress" | "completed";

const CAMP_STATE_LABELS: Record<Exclude<CampState, "all">, string> = {
  upcoming: "coach.camps.upcoming",
  in_progress: "coach.camps.inProgress",
  completed: "coach.camps.completedOne",
};

function campState(camp: CampRow): Exclude<CampState, "all"> {
  const now = Date.now();
  const starts = camp.days.map((day) => day.starts_at ? new Date(day.starts_at).getTime() : NaN).filter(Number.isFinite);
  const ends = camp.days.map((day) => day.ends_at ? new Date(day.ends_at).getTime() : NaN).filter(Number.isFinite);
  if (!starts.length || now < Math.min(...starts)) return "upcoming";
  if (now <= Math.max(...ends, ...starts)) return "in_progress";
  return "completed";
}

function campDateRange(camp: CampRow, locale: string, empty: string) {
  const dates = camp.days.map((day) => day.starts_at).filter(Boolean).map((value) => new Date(value as string)).sort((a, b) => a.getTime() - b.getTime());
  if (!dates.length) return empty;
  const format = new Intl.DateTimeFormat(coachDateLocale(locale), { day: "2-digit", month: "short", year: "numeric" });
  return dates.length === 1 ? format.format(dates[0]) : `${format.format(dates[0])} – ${format.format(dates[dates.length - 1])}`;
}

function fullName(profile?: { first_name: string | null; last_name: string | null } | null) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "—";
}

function fmtRange(startIso: string | null, endIso: string | null, locale: string) {
  if (!startIso) return "—";
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const dateLabel = new Intl.DateTimeFormat(coachDateLocale(locale), {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(start);
  const startTimeLabel = new Intl.DateTimeFormat(coachDateLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  if (!end) return `${dateLabel} · ${startTimeLabel}`;
  const endTimeLabel = new Intl.DateTimeFormat(coachDateLocale(locale), { hour: "2-digit", minute: "2-digit" }).format(end);
  return `${dateLabel} · ${startTimeLabel} – ${endTimeLabel}`;
}

function normalizeRegistrationStatus(value: unknown): "invited" | "registered" | "declined" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "registered" || normalized === "declined") return normalized;
  return "invited";
}

function normalizePresenceStatus(value: unknown): "present" | "absent" {
  return String(value ?? "").trim().toLowerCase() === "absent" ? "absent" : "present";
}

export default function CoachCampsPage() {
  const { locale, t } = useI18n();
  const saveInFlight = useRef(false);
  const loadVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [camps, setCamps] = useState<CampRow[]>([]);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<CampState>("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [detailCamp, setDetailCamp] = useState<CampRow | null>(null);
  const [participantsDay, setParticipantsDay] = useState<CampRow["days"][number] | null>(null);
  const [registrationCamp, setRegistrationCamp] = useState<CampRow | null>(null);
  const [registrationSaving, setRegistrationSaving] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [playerRegistrationsDraft, setPlayerRegistrationsDraft] = useState<
    Record<string, { registration_status: "invited" | "registered" | "declined"; day_status_by_day_index: Record<string, "present" | "absent"> }>
  >({});

  const loadCamps = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/coach/camps", {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(coachUiErrorKey(res.status, json, "coach.error.load"));
      if (version !== loadVersion.current) return;
      setCamps((json?.camps ?? []) as CampRow[]);
    } catch (err: unknown) {
      if (version === loadVersion.current) { setError(coachCaughtErrorKey(err, "coach.error.load")); setCamps([]); }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCamps();
    return () => { loadVersion.current += 1; };
  }, [loadCamps]);

  function initials(profile?: { first_name: string | null; last_name: string | null } | null) {
    const first = String(profile?.first_name ?? "").trim();
    const last = String(profile?.last_name ?? "").trim();
    return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "J";
  }

  function openRegistrationModal(camp: CampRow) {
    setRegistrationCamp(camp);
    setRegistrationError(null);
    setRegistrationSearch("");
    setPlayerRegistrationsDraft(
      Object.fromEntries(
        (camp.player_registrations ?? []).map((registration) => [
          registration.player_id,
          {
            registration_status: normalizeRegistrationStatus(registration.registration_status),
            day_status_by_day_index: Object.fromEntries(
              camp.days.map((day) => [
                String(day.day_index),
                normalizePresenceStatus(registration.day_status_by_day_index?.[String(day.day_index)]),
              ])
            ),
          },
        ])
      )
    );
  }

  function closeRegistrationModal() {
    if (saveInFlight.current) return;
    setRegistrationCamp(null);
    setRegistrationError(null);
    setRegistrationSearch("");
    setPlayerRegistrationsDraft({});
  }

  function updateRegistrationDraft(
    playerId: string,
    patch: Partial<{ registration_status: "invited" | "registered" | "declined"; day_status_by_day_index: Record<string, "present" | "absent"> }>
  ) {
    setPlayerRegistrationsDraft((current) => ({
      ...current,
      [playerId]: {
        registration_status: current[playerId]?.registration_status ?? "invited",
        day_status_by_day_index: current[playerId]?.day_status_by_day_index ?? {},
        ...patch,
      },
    }));
  }

  async function saveRegistrations() {
    if (!registrationCamp || saveInFlight.current) return;
    saveInFlight.current = true;
    setRegistrationSaving(true);
    setRegistrationError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`/api/coach/camps/${registrationCamp.id}/registrations`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          player_registrations: coachCampRegistrationChanges(registrationCamp.player_registrations, playerRegistrationsDraft),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(coachUiErrorKey(res.status, json, "coach.error.save"));

      await loadCamps();
      saveInFlight.current = false;
      closeRegistrationModal();
    } catch (err: unknown) {
      setRegistrationError(coachCaughtErrorKey(err, "coach.error.save"));
    } finally {
      saveInFlight.current = false;
      setRegistrationSaving(false);
    }
  }

  function normalizeSearchText(value: string) {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function matchesRegistrationSearch(profile: ProfileLite | null, query: string) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;
    const first = normalizeSearchText(String(profile?.first_name ?? ""));
    const last = normalizeSearchText(String(profile?.last_name ?? ""));
    const full = `${first} ${last}`.trim();
    const compact = `${first}${last}`.trim();
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    return tokens.every((token) => full.includes(token) || compact.includes(token) || first.includes(token) || last.includes(token));
  }

  const filteredCamps = useMemo(() => camps.filter((camp) => {
    if (stateFilter !== "all" && campState(camp) !== stateFilter) return false;
    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery && !normalizeSearchText(`${camp.title} ${camp.club_name} ${fullName(camp.head_coach)}`).includes(normalizedQuery)) return false;
    if (periodFilter === "all") return true;
    const firstDate = camp.days.map((day) => day.starts_at ? new Date(day.starts_at) : null).filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime())[0];
    if (!firstDate) return false;
    const now = new Date();
    return periodFilter === "month" ? firstDate.getMonth() === now.getMonth() && firstDate.getFullYear() === now.getFullYear() : firstDate.getFullYear() === now.getFullYear();
  }), [camps, periodFilter, query, stateFilter]);

  const counts = useMemo(() => ({
    upcoming: camps.filter((camp) => campState(camp) === "upcoming").length,
    inProgress: camps.filter((camp) => campState(camp) === "in_progress").length,
    completed: camps.filter((camp) => campState(camp) === "completed").length,
    participants: new Set(camps.flatMap((camp) => camp.player_registrations.filter((registration) => registration.registration_status === "registered").map((registration) => registration.player_id))).size,
  }), [camps]);

  const noRegistrationSearchMatch = registrationCamp && registrationSearch.trim() &&
    ![...registrationCamp.available_players, ...registrationCamp.player_registrations.map((entry) => entry.player)]
      .some((player) => matchesRegistrationSearch(player, registrationSearch));

  return (
    <main className={styles.page}>
      <nav data-ui="breadcrumb" className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/coach">{t("common.coach")}</Link><ChevronRight size={13} aria-hidden="true" /><span>{t("coach.camps.title")}</span></nav>
      <div className={styles.topline}><div><h1>{t("coach.camps.title")}</h1><p className={styles.lead}>{t("coach.camps.intro")}</p></div></div>
      {error ? <div className={styles.alertError} role="alert">{t(error)} <button type="button" className={styles.secondary} onClick={() => void loadCamps()}>{t("coach.retry")}</button></div> : null}
      <section className={styles.stats} aria-label={t("coach.camps.statistics")} aria-busy={loading}><div className={styles.stat}><span>{t("coach.camps.upcoming")}</span><b>{loading || error ? "—" : counts.upcoming}</b></div><div className={styles.stat}><span>{t("coach.camps.inProgress")}</span><b>{loading || error ? "—" : counts.inProgress}</b></div><div className={styles.stat}><span>{t("coach.camps.completed")}</span><b>{loading || error ? "—" : counts.completed}</b></div><div className={styles.stat}><span>{t("coach.camps.registeredPlayers")}</span><b>{loading || error ? "—" : counts.participants}</b></div></section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>{t("coach.camps.list")}</h2><p>{loading ? t("common.loading") : error ? "—" : coachText(t, filteredCamps.length === 1 ? "coach.camps.one" : "coach.camps.count", { count: filteredCamps.length })}</p></div></div>
        <div className={styles.toolbar}>
          <label className={styles.field}><span>{t("coach.directory.search")}</span><span className={coachStyles.searchField}><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("coach.camps.search")} /></span></label>
          <label className={styles.field}><span>{t("coach.camps.state")}</span><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as CampState)}><option value="all">{t("coach.camps.allStates")}</option><option value="upcoming">{t("coach.camps.upcoming")}</option><option value="in_progress">{t("coach.camps.inProgress")}</option><option value="completed">{t("coach.camps.completed")}</option></select></label>
          <label className={styles.field}><span>{t("coach.camps.period")}</span><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">{t("coach.camps.allDates")}</option><option value="month">{t("coach.camps.month")}</option><option value="year">{t("coach.camps.year")}</option></select></label>
        </div>
        {loading ? <CoachListSkeleton label={t("coach.camps.loading")} /> : error ? null : filteredCamps.length === 0 ? <div className={styles.empty}>{t("coach.camps.empty")}</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{t("coach.camps.camp")}</th><th className={styles.compactHeader}>{t("coach.camps.dates")}</th><th className={styles.compactHeader}>{t("coach.camps.headCoach")}</th><th>{t("coach.camps.participants")}</th><th>{t("coach.camps.days")}</th><th>{t("coach.camps.state")}</th><th>{t("coach.directory.actions")}</th></tr></thead><tbody>{filteredCamps.map((camp) => {
          const state = campState(camp);
          const registered = camp.player_registrations.filter((registration) => registration.registration_status === "registered").length;
          const badgeClass = state === "in_progress" ? styles.badgeProgress : state === "completed" ? styles.badgeDone : "";
          return <tr key={camp.id}><td data-label={t("coach.camps.camp")}><div className={styles.titleCell}><b>{camp.title}</b><span className={styles.muted}>{camp.club_name}</span></div></td><td data-label={t("coach.camps.dates")}>{campDateRange(camp, locale, t("coach.camps.datesUnknown"))}</td><td data-label={t("coach.camps.headCoach")}>{fullName(camp.head_coach)}</td><td data-label={t("coach.camps.participants")}>{registered}</td><td data-label={t("coach.camps.days")}>{camp.days.length}</td><td data-label={t("coach.camps.state")}><span className={`${styles.badge} ${badgeClass}`}>{t(CAMP_STATE_LABELS[state])}</span></td><td data-label={t("coach.directory.actions")}><div className={styles.actions}><button type="button" className={styles.iconButton} title={t("coach.directory.view")} aria-label={coachText(t, "coach.directory.viewNamed", { name: camp.title })} aria-haspopup="dialog" onClick={() => setDetailCamp(camp)}><Eye size={15} aria-hidden="true" /></button><button type="button" className={styles.iconButton} title={t("coach.camps.manage")} aria-label={coachText(t, "coach.camps.manageNamed", { name: camp.title })} aria-haspopup="dialog" onClick={() => openRegistrationModal(camp)}><Users size={15} aria-hidden="true" /></button></div></td></tr>;
        })}</tbody></table></div>}
      </section>

      {detailCamp ? <AccessibleDialog className={`${coachStyles.modal} ${coachStyles.modalLarge}`} labelledBy="camp-detail-title" onClose={() => setDetailCamp(null)}><div className={coachStyles.modalHeader}><div><h2 id="camp-detail-title">{detailCamp.title}</h2><p>{detailCamp.club_name} · {campDateRange(detailCamp, locale, t("coach.camps.datesUnknown"))}</p></div><button className={styles.iconButton} type="button" onClick={() => setDetailCamp(null)} title={t("common.close")} aria-label={t("common.close")}><X size={16} /></button></div><div className={coachStyles.modalBody}>{detailCamp.notes?.trim() ? <div className={coachStyles.notes} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(detailCamp.notes) }} /> : null}<div className={coachStyles.dayGrid}>{detailCamp.days.map((day) => day.starts_at ? <CoachPlayerActivityCard key={day.event_id} startsAt={day.starts_at} endsAt={day.ends_at} dateLocale={coachDateLocale(locale)} typeLabel={t("coach.activity.camp")} title={detailCamp.title} groupName={coachText(t, "coach.camps.day", { number: day.day_index + 1 })} clubName={detailCamp.club_name} location={day.location_text} statusLabel={t(CAMP_STATE_LABELS[campState(detailCamp)])} actions={<><Link className={styles.secondary} href={`/coach/groups/${day.group_id}/planning/${day.event_id}`}><CalendarDays size={15} />{t("coach.camps.openActivity")}</Link><button type="button" className={styles.secondary} onClick={() => { setDetailCamp(null); setParticipantsDay(day); }}><Users size={15} />{t("coach.camps.participants")}</button></>}><div className={styles.badge}>{coachText(t, day.participants_count === 1 ? "coach.camps.participantOne" : "coach.camps.participantsCount", { count: day.participants_count })}</div>{day.practical_info ? <p className={coachStyles.practical}>{day.practical_info}</p> : null}</CoachPlayerActivityCard> : <article className={styles.dayCard} key={day.event_id}><div className={styles.cardHead}><div><h3>{coachText(t, "coach.camps.day", { number: day.day_index + 1 })}</h3><p className={styles.muted}>{fmtRange(day.starts_at, day.ends_at, locale)}</p></div><span className={styles.badge}>{coachText(t, day.participants_count === 1 ? "coach.camps.participantOne" : "coach.camps.participantsCount", { count: day.participants_count })}</span></div><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => { setDetailCamp(null); setParticipantsDay(day); }}><Users size={15} />{t("coach.camps.participants")}</button></div></article>)}</div></div></AccessibleDialog> : null}

        {registrationCamp ? (
          <AccessibleDialog className={`${coachStyles.modal} ${coachStyles.modalLarge}`} labelledBy="registration-modal-title" onClose={closeRegistrationModal}>
              <div className={coachStyles.modalHeader}>
                <div>
                  <h2 id="registration-modal-title">{t("coach.camps.registrations")}</h2>
                  <p>{registrationCamp.title}</p>
                </div>
                <button type="button" className={styles.iconButton} onClick={closeRegistrationModal} aria-label={t("common.close")} title={t("common.close")} disabled={registrationSaving}>
                  <X size={18} />
                </button>
              </div>

              <fieldset className={`${coachStyles.modalBody} ${coachStyles.formBody}`} disabled={registrationSaving} aria-busy={registrationSaving}>
                {registrationError ? <div className={styles.alertError} role="alert">{t(registrationError)}</div> : null}
                <label className={styles.field}>
                  <span>{t("coach.camps.searchPlayer")}</span>
                  <input
                    value={registrationSearch}
                    onChange={(e) => setRegistrationSearch(e.target.value)}
                    placeholder={t("coach.camps.playerPlaceholder")}
                  />
                </label>

                {noRegistrationSearchMatch ? <p role="status">{t("coach.camps.noSearchMatch")}</p> : null}

                {(registrationCamp.available_players ?? []).length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>{t("coach.camps.addPlayer")}</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {registrationCamp.available_players
                        .filter((player) => matchesRegistrationSearch(player, registrationSearch))
                        .filter((player) => !playerRegistrationsDraft[player.id])
                        .map((player) => (
                          <button
                            key={player.id}
                            type="button"
                            className={coachStyles.addPlayer}
                            onClick={() =>
                              updateRegistrationDraft(player.id, {
                                registration_status: "registered",
                                day_status_by_day_index: Object.fromEntries(
                                  registrationCamp.days.map((day) => [String(day.day_index), "present" as const])
                                ),
                              })
                            }
                          >
                            {fullName(player)}
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}

                {Object.keys(playerRegistrationsDraft).length === 0 ? (
                  <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800 }}>{t("coach.camps.noPlayers")}</div>
                ) : (
                  Object.entries(playerRegistrationsDraft)
                    .sort(([playerIdA], [playerIdB]) => {
                      const playerA =
                        registrationCamp.player_registrations.find((entry) => entry.player_id === playerIdA)?.player ??
                        registrationCamp.available_players.find((entry) => entry.id === playerIdA) ??
                        null;
                      const playerB =
                        registrationCamp.player_registrations.find((entry) => entry.player_id === playerIdB)?.player ??
                        registrationCamp.available_players.find((entry) => entry.id === playerIdB) ??
                        null;
                      return fullName(playerA).localeCompare(fullName(playerB), locale);
                    })
                    .filter(([playerId]) => {
                      const player =
                        registrationCamp.player_registrations.find((entry) => entry.player_id === playerId)?.player ??
                        registrationCamp.available_players.find((entry) => entry.id === playerId) ??
                        null;
                      return matchesRegistrationSearch(player, registrationSearch);
                    })
                    .map(([playerId, draft]) => {
                      const player =
                        registrationCamp.player_registrations.find((entry) => entry.player_id === playerId)?.player ??
                        registrationCamp.available_players.find((entry) => entry.id === playerId) ??
                        null;
                      const registration = { player_id: playerId, player };
                      return (
                        <div key={registration.player_id} className={coachStyles.registrationRow}>
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontWeight: 950, lineHeight: 1.2 }}>{fullName(registration.player)}</div>
                            <select
                              className={coachStyles.select}
                              aria-label={coachText(t, "coach.camps.registrationStatus", { name: fullName(player) })}
                              value={draft.registration_status}
                              onChange={(e) =>
                                updateRegistrationDraft(registration.player_id, {
                                  registration_status: normalizeRegistrationStatus(e.target.value),
                                })
                              }
                            >
                              <option value="invited">{t("coach.camps.invited")}</option>
                              <option value="registered">{t("coach.camps.registered")}</option>
                              <option value="declined">{t("coach.camps.declined")}</option>
                            </select>
                          </div>
                          {draft.registration_status === "registered" ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {registrationCamp.days.map((day) => (
                                <label key={`${registration.player_id}-${day.event_id}`} className={coachStyles.dayPresence}>
                                  <span style={{ fontWeight: 800 }}>{coachText(t, "coach.camps.day", { number: day.day_index + 1 })}</span>
                                  <select
                                    className={coachStyles.select}
                                    aria-label={coachText(t, "coach.camps.presenceStatus", { name: fullName(player), number: day.day_index + 1 })}
                                    value={draft.day_status_by_day_index[String(day.day_index)] ?? "present"}
                                    onChange={(e) =>
                                      updateRegistrationDraft(registration.player_id, {
                                        day_status_by_day_index: {
                                          ...draft.day_status_by_day_index,
                                          [String(day.day_index)]: normalizePresenceStatus(e.target.value),
                                        },
                                      })
                                    }
                                  >
                                    <option value="present">{t("coach.camps.present")}</option>
                                    <option value="absent">{t("coach.camps.absent")}</option>
                                  </select>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,0,0,0.58)" }}>
                              {t("coach.camps.presenceHint")}
                            </div>
                          )}
                        </div>
                      );
                  })
                )}
              </fieldset>

              <div className={coachStyles.modalFooter}>
                <button type="button" className={styles.secondary} onClick={closeRegistrationModal} disabled={registrationSaving}>
                  {t("coach.directory.cancel")}
                </button>
                <button type="button" className={styles.primary} onClick={() => void saveRegistrations()} disabled={registrationSaving}>
                  {registrationSaving ? t("coach.directory.saving") : t("coach.directory.save")}
                </button>
              </div>
          </AccessibleDialog>
        ) : null}

        {participantsDay ? (
          <AccessibleDialog className={coachStyles.modal} labelledBy="participants-modal-title" onClose={() => setParticipantsDay(null)}>
              <div className={coachStyles.modalHeader}>
                <div>
                  <h2 id="participants-modal-title">{t("coach.camps.participants")}</h2>
                  <p>
                    {coachText(t, "coach.camps.day", { number: participantsDay.day_index + 1 })} • {coachText(t, participantsDay.participants_count === 1 ? "coach.camps.participantOne" : "coach.camps.participantsCount", { count: participantsDay.participants_count })}
                  </p>
                </div>
                <button type="button" className={styles.iconButton} onClick={() => setParticipantsDay(null)} aria-label={t("common.close")} title={t("common.close")}>
                  <X size={18} />
                </button>
              </div>

              <div className={coachStyles.modalBody}>
                {participantsDay.participants.length === 0 ? (
                  <div className={styles.empty}>{t("coach.camps.noPresent")}</div>
                ) : (
                  participantsDay.participants.map((player) => (
                    <div key={player.id} className={coachStyles.participantRow}>
                      <div aria-hidden="true" className={styles.avatar}>
                        {player.avatar_url ? (
                          <img src={player.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : (
                          initials(player)
                        )}
                      </div>
                      <b>{fullName(player)}</b>
                    </div>
                  ))
                )}
              </div>
          </AccessibleDialog>
        ) : null}
    </main>
  );
}
