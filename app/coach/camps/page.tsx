"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
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
  upcoming: "À venir",
  in_progress: "En cours",
  completed: "Terminé",
};

function campState(camp: CampRow): Exclude<CampState, "all"> {
  const now = Date.now();
  const starts = camp.days.map((day) => day.starts_at ? new Date(day.starts_at).getTime() : NaN).filter(Number.isFinite);
  const ends = camp.days.map((day) => day.ends_at ? new Date(day.ends_at).getTime() : NaN).filter(Number.isFinite);
  if (!starts.length || now < Math.min(...starts)) return "upcoming";
  if (now <= Math.max(...ends, ...starts)) return "in_progress";
  return "completed";
}

function campDateRange(camp: CampRow) {
  const dates = camp.days.map((day) => day.starts_at).filter(Boolean).map((value) => new Date(value as string)).sort((a, b) => a.getTime() - b.getTime());
  if (!dates.length) return "Dates à définir";
  const format = new Intl.DateTimeFormat("fr-CH", { day: "2-digit", month: "short", year: "numeric" });
  return dates.length === 1 ? format.format(dates[0]) : `${format.format(dates[0])} – ${format.format(dates[dates.length - 1])}`;
}

function fullName(profile?: { first_name: string | null; last_name: string | null } | null) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "—";
}

function fmtRange(startIso: string | null, endIso: string | null) {
  if (!startIso) return "—";
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const dateLabel = new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(start);
  const startTimeLabel = new Intl.DateTimeFormat("fr-CH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  if (!end) return `${dateLabel} · ${startTimeLabel}`;
  const endTimeLabel = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" }).format(end);
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

  async function loadCamps() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/coach/camps", {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Impossible de charger les stages."));
      setCamps((json?.camps ?? []) as CampRow[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
      setCamps([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCamps();
  }, []);

  useEffect(() => {
    const shouldLockScroll = Boolean(participantsDay || registrationCamp || detailCamp);
    if (!shouldLockScroll) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [detailCamp, participantsDay, registrationCamp]);

  useEffect(() => {
    if (!participantsDay && !registrationCamp && !detailCamp) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (participantsDay) setParticipantsDay(null);
      else if (registrationCamp) closeRegistrationModal();
      else setDetailCamp(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [detailCamp, participantsDay, registrationCamp]);

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
    if (!registrationCamp) return;
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
          player_registrations: Object.entries(playerRegistrationsDraft).map(([playerId, registration]) => ({
            player_id: playerId,
            registration_status: registration.registration_status,
            day_status_by_day_index: registration.day_status_by_day_index ?? {},
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Impossible d’enregistrer les inscriptions."));

      await loadCamps();
      closeRegistrationModal();
    } catch (err: unknown) {
      setRegistrationError(err instanceof Error ? err.message : "Impossible d’enregistrer les inscriptions.");
    } finally {
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

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/coach">Coach</Link><ChevronRight size={13} aria-hidden="true" /><span>Stages</span></nav>
      <div className={styles.topline}><div><h1>Stages</h1><p className={styles.lead}>Consultez les journées, les participants et les informations opérationnelles des stages auxquels vous êtes rattaché.</p></div></div>
      {error ? <div className={styles.alertError} role="alert">{error}</div> : null}
      <section className={styles.stats} aria-label="Statistiques des stages"><div className={styles.stat}><span>À venir</span><b>{counts.upcoming}</b></div><div className={styles.stat}><span>En cours</span><b>{counts.inProgress}</b></div><div className={styles.stat}><span>Terminés</span><b>{counts.completed}</b></div><div className={styles.stat}><span>Juniors inscrits</span><b>{counts.participants}</b></div></section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><h2>Liste des stages</h2><p>{filteredCamps.length} stage{filteredCamps.length > 1 ? "s" : ""} affiché{filteredCamps.length > 1 ? "s" : ""}.</p></div></div>
        <div className={styles.toolbar}>
          <label className={styles.field}><span>Rechercher</span><span className={coachStyles.searchField}><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom du stage, club ou coach" /></span></label>
          <label className={styles.field}><span>État</span><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as CampState)}><option value="all">Tous les états</option><option value="upcoming">À venir</option><option value="in_progress">En cours</option><option value="completed">Terminés</option></select></label>
          <label className={styles.field}><span>Période</span><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}><option value="all">Toutes les dates</option><option value="month">Ce mois</option><option value="year">Cette année</option></select></label>
        </div>
        {loading ? <ListLoadingBlock label="Chargement des stages…" /> : filteredCamps.length === 0 ? <div className={styles.empty}>Aucun stage ne correspond aux critères.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Stage</th><th className={styles.compactHeader}>Dates</th><th className={styles.compactHeader}>Head coach</th><th>Participants</th><th>Journées</th><th>État</th><th>Actions</th></tr></thead><tbody>{filteredCamps.map((camp) => {
          const state = campState(camp);
          const registered = camp.player_registrations.filter((registration) => registration.registration_status === "registered").length;
          const badgeClass = state === "in_progress" ? styles.badgeProgress : state === "completed" ? styles.badgeDone : "";
          return <tr key={camp.id}><td data-label="Stage"><div className={styles.titleCell}><b>{camp.title}</b><span className={styles.muted}>{camp.club_name}</span></div></td><td data-label="Dates">{campDateRange(camp)}</td><td data-label="Head coach">{fullName(camp.head_coach)}</td><td data-label="Participants">{registered}</td><td data-label="Journées">{camp.days.length}</td><td data-label="État"><span className={`${styles.badge} ${badgeClass}`}>{CAMP_STATE_LABELS[state]}</span></td><td data-label="Actions"><div className={styles.actions}><button type="button" className={styles.iconButton} title="Consulter" aria-label={`Consulter ${camp.title}`} onClick={() => setDetailCamp(camp)}><Eye size={15} aria-hidden="true" /></button><button type="button" className={styles.iconButton} title="Gérer les juniors" aria-label={`Gérer les juniors de ${camp.title}`} onClick={() => openRegistrationModal(camp)}><Users size={15} aria-hidden="true" /></button></div></td></tr>;
        })}</tbody></table></div>}
      </section>

      {detailCamp ? <div className={coachStyles.overlay} role="dialog" aria-modal="true" aria-labelledby="camp-detail-title" onClick={() => setDetailCamp(null)}><div className={`${coachStyles.modal} ${coachStyles.modalLarge}`} onClick={(event) => event.stopPropagation()}><div className={coachStyles.modalHeader}><div><h2 id="camp-detail-title">{detailCamp.title}</h2><p>{detailCamp.club_name} · {campDateRange(detailCamp)}</p></div><button className={styles.iconButton} type="button" onClick={() => setDetailCamp(null)} title="Fermer" aria-label="Fermer"><X size={16} /></button></div><div className={coachStyles.modalBody}>{detailCamp.notes?.trim() ? <div className={coachStyles.notes} dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(detailCamp.notes) }} /> : null}<div className={coachStyles.dayGrid}>{detailCamp.days.map((day) => day.starts_at ? <CoachPlayerActivityCard key={day.event_id} startsAt={day.starts_at} endsAt={day.ends_at} dateLocale="fr-CH" typeLabel="Stage / camp" title={detailCamp.title} groupName={`Jour ${day.day_index + 1}`} clubName={detailCamp.club_name} location={day.location_text} statusLabel={CAMP_STATE_LABELS[campState(detailCamp)]} actions={<><Link className={styles.secondary} href={`/coach/groups/${day.group_id}/planning/${day.event_id}`}><CalendarDays size={15} />Ouvrir l’activité</Link><button type="button" className={styles.secondary} onClick={() => { setDetailCamp(null); setParticipantsDay(day); }}><Users size={15} />Participants</button></>}><div className={styles.badge}>{day.participants_count} participant{day.participants_count > 1 ? "s" : ""}</div>{day.practical_info ? <p className={coachStyles.practical}>{day.practical_info}</p> : null}</CoachPlayerActivityCard> : <article className={styles.dayCard} key={day.event_id}><div className={styles.cardHead}><div><h3>Jour {day.day_index + 1}</h3><p className={styles.muted}>{fmtRange(day.starts_at, day.ends_at)}</p></div><span className={styles.badge}>{day.participants_count} participant{day.participants_count > 1 ? "s" : ""}</span></div><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => { setDetailCamp(null); setParticipantsDay(day); }}><Users size={15} />Participants</button></div></article>)}</div></div></div></div> : null}

        {registrationCamp ? (
          <div
            className={coachStyles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="registration-modal-title"
            onClick={closeRegistrationModal}
          >
            <div
              className={`${coachStyles.modal} ${coachStyles.modalLarge}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={coachStyles.modalHeader}>
                <div>
                  <h2 id="registration-modal-title">Inscriptions des juniors</h2>
                  <p>{registrationCamp.title}</p>
                </div>
                <button type="button" className={styles.iconButton} onClick={closeRegistrationModal} aria-label="Fermer" title="Fermer" disabled={registrationSaving}>
                  <X size={18} />
                </button>
              </div>

              {registrationError ? <div className={styles.alertError} role="alert">{registrationError}</div> : null}

              <div className={coachStyles.modalBody}>
                <label className={styles.field}>
                  <span>Rechercher un junior</span>
                  <input
                    value={registrationSearch}
                    onChange={(e) => setRegistrationSearch(e.target.value)}
                    placeholder="Prénom, nom, ou les deux"
                  />
                </label>

                {(registrationCamp.available_players ?? []).length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>Ajouter un junior</div>
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
                  <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800 }}>Aucun junior n’est lié à ce stage/camp.</div>
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
                      return fullName(playerA).localeCompare(fullName(playerB), "fr");
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
                              value={draft.registration_status}
                              onChange={(e) =>
                                updateRegistrationDraft(registration.player_id, {
                                  registration_status: normalizeRegistrationStatus(e.target.value),
                                })
                              }
                            >
                              <option value="invited">Invité</option>
                              <option value="registered">Inscrit</option>
                              <option value="declined">Refusé</option>
                            </select>
                          </div>
                          {draft.registration_status === "registered" ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {registrationCamp.days.map((day) => (
                                <label key={`${registration.player_id}-${day.event_id}`} className={coachStyles.dayPresence}>
                                  <span style={{ fontWeight: 800 }}>Jour {day.day_index + 1}</span>
                                  <select
                                    className={coachStyles.select}
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
                                    <option value="present">Présent</option>
                                    <option value="absent">Absent</option>
                                  </select>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,0,0,0.58)" }}>
                              Les jours présents/absents sont disponibles dès que le junior est inscrit.
                            </div>
                          )}
                        </div>
                      );
                  })
                )}
              </div>

              <div className={coachStyles.modalFooter}>
                <button type="button" className={styles.secondary} onClick={closeRegistrationModal} disabled={registrationSaving}>
                  Annuler
                </button>
                <button type="button" className={styles.primary} onClick={() => void saveRegistrations()} disabled={registrationSaving}>
                  {registrationSaving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {participantsDay ? (
          <div
            className={coachStyles.overlay}
            role="dialog"
            aria-modal="true"
            aria-labelledby="participants-modal-title"
            onClick={() => setParticipantsDay(null)}
          >
            <div
              className={coachStyles.modal}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={coachStyles.modalHeader}>
                <div>
                  <h2 id="participants-modal-title">Participants</h2>
                  <p>
                    Jour {participantsDay.day_index + 1} • {participantsDay.participants_count} participant{participantsDay.participants_count > 1 ? "s" : ""}
                  </p>
                </div>
                <button type="button" className={styles.iconButton} onClick={() => setParticipantsDay(null)} aria-label="Fermer" title="Fermer">
                  <X size={18} />
                </button>
              </div>

              <div className={coachStyles.modalBody}>
                {participantsDay.participants.length === 0 ? (
                  <div className={styles.empty}>Aucun junior présent.</div>
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
            </div>
          </div>
        ) : null}
    </main>
  );
}
