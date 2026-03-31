"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { Users, X } from "lucide-react";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";

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
    participants: ProfileLite[];
  }>;
};

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
  if (!end) return `${dateLabel} à ${startTimeLabel}`;
  const endTimeLabel = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" }).format(end);
  return `${dateLabel} à ${startTimeLabel} • de ${startTimeLabel} à ${endTimeLabel}`;
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
  const [participantsDay, setParticipantsDay] = useState<CampRow["days"][number] | null>(null);
  const [registrationCamp, setRegistrationCamp] = useState<CampRow | null>(null);
  const [registrationSaving, setRegistrationSaving] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [playerRegistrationsDraft, setPlayerRegistrationsDraft] = useState<
    Record<string, { registration_status: "invited" | "registered" | "declined"; day_status_by_day_index: Record<string, "present" | "absent"> }>
  >({});

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  useEffect(() => {
    const shouldLockScroll = Boolean(participantsDay || registrationCamp);
    if (!shouldLockScroll) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [participantsDay, registrationCamp]);

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

      const updatedCamp: CampRow = {
        ...registrationCamp,
        player_registrations: Object.entries(playerRegistrationsDraft)
          .filter(([playerId, registration]) => {
            const existed = (registrationCamp.player_registrations ?? []).some((entry) => entry.player_id === playerId);
            return existed || registration.registration_status !== "invited";
          })
          .map(([playerId, registration]) => {
            const existing = (registrationCamp.player_registrations ?? []).find((entry) => entry.player_id === playerId) ?? null;
            const player =
              existing?.player ??
              registrationCamp.available_players.find((entry) => entry.id === playerId) ??
              null;
            return {
              player_id: playerId,
              registration_status: registration.registration_status,
              day_status_by_day_index: registration.day_status_by_day_index ?? {},
              player,
            };
          })
          .sort((a, b) => fullName(a.player).localeCompare(fullName(b.player), "fr")),
      };
      updatedCamp.days = updatedCamp.days.map((day) => {
        const participants = updatedCamp.player_registrations
          .filter((registration) => {
            if (registration.registration_status !== "registered") return false;
            return (registration.day_status_by_day_index?.[String(day.day_index)] ?? "present") === "present";
          })
          .map((registration) => registration.player)
          .filter((player): player is ProfileLite => Boolean(player))
          .sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));

        const counts = updatedCamp.player_registrations.reduce(
          (acc, registration) => {
            if (registration.registration_status !== "registered") {
              acc.not_registered += 1;
              return acc;
            }
            const dayStatus = registration.day_status_by_day_index?.[String(day.day_index)] ?? "present";
            if (dayStatus === "absent") acc.absent += 1;
            else acc.present += 1;
            return acc;
          },
          { present: 0, not_registered: 0, absent: 0, excused: 0 }
        );

        return {
          ...day,
          participants,
          counts,
        };
      });
      setCamps((current) => current.map((camp) => (camp.id === updatedCamp.id ? updatedCamp : camp)));
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

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="section-title">Stages/camps</div>
        </div>

        <div className="glass-section">
          <div className="glass-card">
          {loading ? (
            <ListLoadingBlock label="Chargement" />
          ) : error ? (
            <div className="marketplace-error">{error}</div>
          ) : camps.length === 0 ? (
            <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800 }}>Aucun stage/camp.</div>
          ) : (
            <div className="marketplace-list marketplace-list-top">
              {camps.map((camp) => (
                <div key={camp.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div className="marketplace-item-title" style={{ fontSize: 15, fontWeight: 950 }}>{camp.title}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.58)" }}>{camp.club_name}</div>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>Head coach: {fullName(camp.head_coach)}</div>
                    </div>
                    {camp.notes?.trim() ? (
                      <div
                        style={{ fontSize: 12, color: "rgba(0,0,0,0.72)" }}
                        dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(camp.notes) }}
                      />
                    ) : null}
                    <div style={{ display: "flex", justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn" onClick={() => openRegistrationModal(camp)}>
                        Gérer les juniors
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {camp.days.map((day) => (
                        <div key={day.event_id} className="glass-card" style={{ border: "1px solid rgba(0,0,0,0.08)", display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 900 }}>Jour {day.day_index + 1}</div>
                          <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtRange(day.starts_at, day.ends_at)}</div>
                          {day.location_text ? <div style={{ fontSize: 12, color: "rgba(0,0,0,0.6)" }}>📍 {day.location_text}</div> : null}
                          {day.practical_info ? <div style={{ fontSize: 12, color: "rgba(0,0,0,0.72)", whiteSpace: "pre-wrap" }}>{day.practical_info}</div> : null}
                          <div style={{ display: "flex", justifyContent: "flex-start", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                            <Link className="btn" href={`/coach/groups/${day.group_id}/planning/${day.event_id}`}>
                              Voir
                            </Link>
                            <button type="button" className="btn" onClick={() => setParticipantsDay(day)}>
                              <Users size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              Participants ({day.counts.present})
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>

        {registrationCamp ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={closeRegistrationModal}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(15, 23, 42, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div
              className="glass-card"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(920px, 100%)",
                maxHeight: "84vh",
                display: "grid",
                gridTemplateRows: "auto minmax(0, 1fr) auto",
                gap: 12,
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>Inscriptions des juniors</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.58)" }}>{registrationCamp.title}</div>
                </div>
                <button type="button" className="btn btn-ghost" onClick={closeRegistrationModal} aria-label="Fermer" disabled={registrationSaving}>
                  <X size={18} />
                </button>
              </div>

              {registrationError ? <div className="marketplace-error">{registrationError}</div> : null}

              <div style={{ display: "grid", gap: 10, overflowY: "auto", minHeight: 0, paddingRight: 2, overscrollBehavior: "contain" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 800 }}>Rechercher un junior</span>
                  <input
                    className="input"
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
                            className="pill-soft"
                            style={{ cursor: "pointer", border: "none" }}
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
                        <div key={registration.player_id} className="glass-card" style={{ display: "grid", gap: 10, border: "1px solid rgba(0,0,0,0.08)" }}>
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontWeight: 950, lineHeight: 1.2 }}>{fullName(registration.player)}</div>
                            <select
                              className="input"
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
                                <label key={`${registration.player_id}-${day.event_id}`} className="pill-soft" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontWeight: 800 }}>Jour {day.day_index + 1}</span>
                                  <select
                                    className="input"
                                    style={{ minWidth: 120 }}
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

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn" onClick={closeRegistrationModal} disabled={registrationSaving}>
                  Annuler
                </button>
                <button type="button" className="btn" onClick={() => void saveRegistrations()} disabled={registrationSaving}>
                  {registrationSaving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {participantsDay ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setParticipantsDay(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(15, 23, 42, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div
              className="glass-card"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(560px, 100%)",
                maxHeight: "80vh",
                display: "grid",
                gridTemplateRows: "auto minmax(0, 1fr)",
                gap: 12,
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "grid", gap: 4 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>Participants</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.58)" }}>
                    Jour {participantsDay.day_index + 1} • {participantsDay.counts.present} présent{participantsDay.counts.present > 1 ? "s" : ""}
                  </div>
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => setParticipantsDay(null)} aria-label="Fermer">
                  <X size={18} />
                </button>
              </div>

              <div style={{ display: "grid", gap: 10, overflowY: "auto", minHeight: 0, paddingRight: 2, overscrollBehavior: "contain" }}>
                {participantsDay.participants.length === 0 ? (
                  <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800 }}>Aucun junior présent.</div>
                ) : (
                  participantsDay.participants.map((player) => (
                    <div
                      key={player.id}
                      className="glass-card"
                      style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid rgba(0,0,0,0.08)" }}
                    >
                      <div
                        aria-hidden="true"
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: "50%",
                          overflow: "hidden",
                          flexShrink: 0,
                          background: "linear-gradient(135deg, #14532d 0%, #064e3b 100%)",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 900,
                        }}
                      >
                        {player.avatar_url ? (
                          <img src={player.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : (
                          initials(player)
                        )}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 950 }}>{fullName(player)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
