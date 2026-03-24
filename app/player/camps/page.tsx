"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";

type ProfileLite = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };
type CampRow = {
  id: string;
  club_name: string;
  title: string;
  notes: string | null;
  registration_status: "invited" | "registered" | "declined";
  head_coach: ProfileLite | null;
  days: Array<{
    event_id: string;
    day_index: number;
    practical_info: string | null;
    starts_at: string | null;
    ends_at: string | null;
    location_text: string | null;
    status: string;
    attendance_status: "present" | "not_registered" | "absent" | "excused";
    participants_count: number;
    participants: ProfileLite[];
  }>;
};

function fullName(profile?: { first_name: string | null; last_name: string | null } | null) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "—";
}

function initials(profile?: { first_name: string | null; last_name: string | null } | null) {
  const first = String(profile?.first_name ?? "").trim();
  const last = String(profile?.last_name ?? "").trim();
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
}

function fmtRange(startIso: string | null, endIso: string | null) {
  if (!startIso) return "—";
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const dateLabel = new Intl.DateTimeFormat("fr-CH", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(start);
  const startTime = new Intl.DateTimeFormat("fr-CH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  })
    .format(start)
    .replace(":", "h");
  if (!end) return `${dateLabel} • à ${startTime}`;
  const endTime = new Intl.DateTimeFormat("fr-CH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  })
    .format(end)
    .replace(":", "h");
  return `${dateLabel} • de ${startTime} à ${endTime}`;
}

function CoachMiniCard({ coach }: { coach: ProfileLite | null }) {
  if (!coach) return null;
  return (
    <div
      className="glass-card"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minWidth: 0,
        background: "rgba(255,255,255,0.96)",
        border: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      {coach.avatar_url ? (
        <img src={coach.avatar_url} alt={fullName(coach)} style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
      ) : (
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(15,118,110,0.12)", color: "rgba(15,118,110,1)", display: "grid", placeItems: "center", fontWeight: 900, flexShrink: 0 }}>
          {initials(coach)}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 900, fontSize: 14, lineHeight: 1.2 }}>{fullName(coach)}</div>
      </div>
    </div>
  );
}

export default function PlayerCampsPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [camps, setCamps] = useState<CampRow[]>([]);
  const [participantsDay, setParticipantsDay] = useState<CampRow["days"][number] | null>(null);

  const childId = useMemo(() => String(searchParams.get("child_id") ?? "").trim(), [searchParams]);

  async function headers() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
      const res = await fetch(`/api/player/camps${query}`, {
        headers: await headers(),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Impossible de charger les stages."));
      setCamps((json?.camps ?? []) as CampRow[]);
    } catch (err: any) {
      setError(err?.message ?? "Erreur de chargement");
      setCamps([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [childId]);

  async function registerCamp(campId: string) {
    setBusyKey(`register-${campId}`);
    setError(null);
    try {
      const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
      const res = await fetch(`/api/player/camps/${encodeURIComponent(campId)}/register${query}`, {
        method: "POST",
        headers: await headers(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Inscription impossible."));
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Inscription impossible.");
    } finally {
      setBusyKey("");
    }
  }

  async function unregisterCamp(campId: string) {
    setBusyKey(`unregister-${campId}`);
    setError(null);
    try {
      const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
      const res = await fetch(`/api/player/camps/${encodeURIComponent(campId)}/register${query}`, {
        method: "DELETE",
        headers: await headers(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Désinscription impossible."));
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Désinscription impossible.");
    } finally {
      setBusyKey("");
    }
  }

  async function setDayAttendance(eventId: string, status: "present" | "absent") {
    setBusyKey(`day-${eventId}`);
    setError(null);
    try {
      const query = childId ? `?child_id=${encodeURIComponent(childId)}` : "";
      const res = await fetch(`/api/player/camps/days/${encodeURIComponent(eventId)}/attendance${query}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(await headers()),
        },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Mise à jour impossible."));
      setCamps((current) =>
        current.map((camp) => ({
          ...camp,
          days: camp.days.map((day) => (day.event_id === eventId ? { ...day, attendance_status: status } : day)),
        }))
      );
    } catch (err: any) {
      setError(err?.message ?? "Mise à jour impossible.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="section-title">Stages/camps</div>
          {error ? <div className="marketplace-error" style={{ marginTop: 12 }}>{error}</div> : null}
        </div>

        <div className="glass-section">
          {loading ? (
            <ListLoadingBlock label="Chargement" />
          ) : camps.length === 0 ? (
            <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800 }}>Aucun stage/camp disponible.</div>
          ) : (
            <div className="marketplace-list marketplace-list-top">
              {camps.map((camp) => {
                const isRegistered = camp.registration_status === "registered";
                return (
                  <div key={camp.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 18, background: "rgba(255,255,255,0.82)", display: "grid", gap: 14 }}>
                    <div className="glass-card" style={{ display: "grid", gap: 12, background: "rgba(255,255,255,0.96)", border: "1px solid rgba(0,0,0,0.08)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                        <div style={{ display: "grid", gap: 0 }}>
                          <div className="card-title" style={{ marginBottom: 0 }}>{camp.title}</div>
                          <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.58)", marginTop: 2 }}>Organisé par {camp.club_name}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {!isRegistered ? (
                            <button type="button" className="btn" onClick={() => void registerCamp(camp.id)} disabled={busyKey === `register-${camp.id}`}>
                              {busyKey === `register-${camp.id}` ? "Inscription…" : "S'inscrire"}
                            </button>
                          ) : (
                            <>
                              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "rgba(21,128,61,1)", fontWeight: 900, fontSize: 14 }}>
                                <CheckCircle2 size={16} /> Inscrit
                              </div>
                              <button type="button" className="btn" onClick={() => void unregisterCamp(camp.id)} disabled={busyKey === `unregister-${camp.id}`}>
                                {busyKey === `unregister-${camp.id}` ? "Désinscription…" : "Se désinscrire"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {camp.notes?.trim() ? (
                        <div
                          style={{ fontSize: 14, color: "#111827", paddingBlock: 6 }}
                          dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(camp.notes) }}
                        />
                      ) : null}

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.56)", textTransform: "uppercase", letterSpacing: 0.4 }}>Responsable du camp</div>
                        <CoachMiniCard coach={camp.head_coach} />
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(0,0,0,0.56)", textTransform: "uppercase", letterSpacing: 0.4 }}>Programme</div>
                      {camp.days.map((day) => {
                        const dayPresent = day.attendance_status === "present";
                        return (
                          <div
                            key={day.event_id}
                            className="marketplace-item"
                            style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}
                          >
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
                                <div>{fmtRange(day.starts_at, day.ends_at)}</div>
                              </div>

                              <div className="hr-soft" style={{ margin: "1px 0" }} />

                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                                  <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                                    {camp.title} • Jour {day.day_index + 1}
                                  </div>
                                </div>
                                {isRegistered ? (
                                  <AttendanceToggle
                                    checked={dayPresent}
                                    onToggle={() => void setDayAttendance(day.event_id, dayPresent ? "absent" : "present")}
                                    disabled={busyKey === `day-${day.event_id}`}
                                    disabledCursor="wait"
                                    ariaLabel="Basculer présence"
                                    leftLabel="Absent"
                                    rightLabel="Présent"
                                  />
                                ) : null}
                              </div>

                              {day.location_text ? (
                                <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800, fontSize: 12 }} className="truncate">
                                  📍 {day.location_text}
                                </div>
                              ) : null}

                              {day.practical_info ? (
                                <div style={{ fontSize: 12, color: "rgba(0,0,0,0.72)", whiteSpace: "pre-wrap", fontWeight: 700 }}>
                                  {day.practical_info}
                                </div>
                              ) : null}

                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button type="button" className="btn" onClick={() => setParticipantsDay(day)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                  <Users size={15} /> Participants ({day.participants_count})
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {participantsDay ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setParticipantsDay(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.42)", display: "grid", placeItems: "center", zIndex: 1000, padding: 16 }}
        >
          <div
            className="glass-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(640px, 100%)", maxHeight: "80vh", display: "grid", gridTemplateRows: "auto 1fr", gap: 12, overflow: "hidden" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div className="marketplace-item-title" style={{ fontSize: 18, fontWeight: 950 }}>Participants</div>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,0.58)", fontWeight: 800 }}>Jour {participantsDay.day_index + 1}</div>
              </div>
              <button type="button" className="btn" onClick={() => setParticipantsDay(null)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <X size={16} /> Fermer
              </button>
            </div>
            <div style={{ overflowY: "auto", display: "grid", gap: 10 }}>
              {participantsDay.participants.length === 0 ? (
                <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800 }}>Aucun participant pour le moment.</div>
              ) : (
                participantsDay.participants.map((player) => (
                  <div key={player.id} className="glass-card" style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid rgba(0,0,0,0.08)" }}>
                    {player.avatar_url ? (
                      <img src={player.avatar_url} alt={fullName(player)} style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 42, height: 42, borderRadius: "50%", background: "rgba(20,83,45,0.12)", color: "rgba(20,83,45,1)", display: "grid", placeItems: "center", fontWeight: 900, flexShrink: 0 }}>
                        {initials(player)}
                      </div>
                    )}
                    <div style={{ fontWeight: 900 }}>{fullName(player)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
