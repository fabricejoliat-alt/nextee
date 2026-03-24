"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { PlusCircle, Users, X } from "lucide-react";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";

type ProfileRow = { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null };

type CampSummary = {
  id: string;
  club_id: string;
  title: string;
  notes: string | null;
  club_name: string;
  head_coach: ProfileRow | null;
  days: Array<{
    event_id: string;
    day_index: number;
    practical_info: string | null;
    starts_at: string | null;
    ends_at: string | null;
    location_text: string | null;
    participants_count: number;
    participants: ProfileRow[];
  }>;
  stats: { invited: number; registered: number; coaches: number };
};

function fullName(p?: { first_name: string | null; last_name: string | null } | null) {
  const first = String(p?.first_name ?? "").trim();
  const last = String(p?.last_name ?? "").trim();
  return `${first} ${last}`.trim() || "—";
}

function fmtRange(startIso: string | null, endIso: string | null) {
  if (!startIso) return "—";
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const dateLabel = new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  if (!end) return dateLabel;
  const timeLabel = new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit" }).format(end);
  return `${dateLabel} → ${timeLabel}`;
}

export default function ManagerCampsPage() {
  const [loading, setLoading] = useState(true);
  const [deletingCampId, setDeletingCampId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [camps, setCamps] = useState<CampSummary[]>([]);
  const [participantsDay, setParticipantsDay] = useState<CampSummary["days"][number] | null>(null);

  async function authHeaders() {
    const { data } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
  }

  async function loadCamps() {
    const headers = await authHeaders();
    const res = await fetch("/api/manager/camps", { headers, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(json?.error ?? "Impossible de charger les stages."));
    setCamps((json?.camps ?? []) as CampSummary[]);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      await loadCamps();
    } catch (err: any) {
      setError(err?.message ?? "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function deleteCamp(campId: string) {
    const confirmed = window.confirm("Supprimer ce stage/camp et toutes ses journées ?");
    if (!confirmed) return;
    setDeletingCampId(campId);
    setError(null);
    setSuccess(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/manager/camps/${campId}`, { method: "DELETE", headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Suppression impossible."));
      setSuccess("Stage/camp supprimé.");
      await loadCamps();
    } catch (err: any) {
      setError(err?.message ?? "Suppression impossible.");
    } finally {
      setDeletingCampId(null);
    }
  }

  return (
    <div className="manager-page">
      <div className="glass-section">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div className="section-title">Stages/camps</div>
            <div className="section-subtitle">Liste des stages multi-jours déjà configurés.</div>
          </div>
          <Link href="/manager/camps/new" className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <PlusCircle size={18} /> Ajouter un camp
          </Link>
        </div>
      </div>

      <div className="glass-section">
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 900 }}>Stages/camps configurés</div>

          {error ? <div className="marketplace-error">{error}</div> : null}
          {success ? (
            <div
              style={{
                borderRadius: 12,
                padding: "10px 12px",
                background: "rgba(22,163,74,0.12)",
                border: "1px solid rgba(22,163,74,0.24)",
                color: "rgba(21,128,61,1)",
                fontWeight: 800,
              }}
            >
              {success}
            </div>
          ) : null}

          {loading ? (
            <ListLoadingBlock label="Chargement" />
          ) : camps.length === 0 ? (
            <div style={{ color: "rgba(0,0,0,0.58)", fontWeight: 800 }}>Aucun stage/camp pour le moment.</div>
          ) : (
            <div className="marketplace-list marketplace-list-top">
              {camps.map((camp) => (
                <div key={camp.id} className="marketplace-item" style={{ border: "1px solid rgba(0,0,0,0.10)", borderRadius: 14, background: "rgba(255,255,255,0.78)" }}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <div className="marketplace-item-title" style={{ fontSize: 15, fontWeight: 950 }}>{camp.title}</div>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.58)" }}>{camp.club_name}</div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                        <span className="pill-soft">{camp.days.length} jour(s)</span>
                        <Link href={`/manager/camps/new?campId=${camp.id}`} className="btn">Éditer</Link>
                        <button type="button" className="btn" onClick={() => void deleteCamp(camp.id)} disabled={deletingCampId === camp.id}>
                          {deletingCampId === camp.id ? "Suppression…" : "Supprimer"}
                        </button>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                      Head coach: {fullName(camp.head_coach)}
                    </div>

                    {camp.notes?.trim() ? (
                      <div
                        style={{ fontSize: 12, color: "rgba(0,0,0,0.72)" }}
                        dangerouslySetInnerHTML={{ __html: normalizeCampRichTextHtml(camp.notes) }}
                      />
                    ) : null}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span className="pill-soft">Invités: {camp.stats.invited}</span>
                      <span className="pill-soft">Inscrits: {camp.stats.registered}</span>
                      <span className="pill-soft">Coachs: {camp.stats.coaches}</span>
                    </div>

                    <div style={{ display: "grid", gap: 8 }}>
                      {camp.days.map((day) => (
                        <div key={day.event_id} className="glass-card" style={{ border: "1px solid rgba(0,0,0,0.08)", display: "grid", gap: 8 }}>
                          <div style={{ fontWeight: 900 }}>Jour {day.day_index + 1}</div>
                          <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtRange(day.starts_at, day.ends_at)}</div>
                          {day.location_text ? <div style={{ fontSize: 12, color: "rgba(0,0,0,0.6)" }}>📍 {day.location_text}</div> : null}
                          {day.practical_info ? <div style={{ fontSize: 12, color: "rgba(0,0,0,0.72)", whiteSpace: "pre-wrap" }}>{day.practical_info}</div> : null}
                          <div>
                            <button type="button" className="btn" onClick={() => setParticipantsDay(day)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <Users size={15} /> Participants ({day.participants_count})
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
                        {String(player.first_name ?? "").trim().charAt(0)}{String(player.last_name ?? "").trim().charAt(0)}
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
