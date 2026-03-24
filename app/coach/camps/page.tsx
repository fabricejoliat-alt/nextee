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

export default function CoachCampsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [camps, setCamps] = useState<CampRow[]>([]);
  const [participantsDay, setParticipantsDay] = useState<CampRow["days"][number] | null>(null);

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
      } catch (err: any) {
        setError(err?.message ?? "Erreur de chargement");
        setCamps([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function initials(profile?: { first_name: string | null; last_name: string | null } | null) {
    const first = String(profile?.first_name ?? "").trim();
    const last = String(profile?.last_name ?? "").trim();
    return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || "J";
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
              style={{ width: "min(560px, 100%)", maxHeight: "80vh", display: "grid", gap: 12, overflow: "hidden" }}
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

              <div style={{ display: "grid", gap: 10, overflowY: "auto", paddingRight: 2 }}>
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
