"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Users, ArrowRight, Pencil } from "lucide-react";

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

type AttendeeDbRow = {
  player_id: string;
  status: "expected" | "present" | "absent" | "excused";
};

type ProfileLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type AttendeeUiRow = AttendeeDbRow & { profile?: ProfileLite | null };

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

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

const avatarBoxStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 14,
  overflow: "hidden",
  background: "rgba(255,255,255,0.65)",
  border: "1px solid rgba(0,0,0,0.08)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 950,
  color: "var(--green-dark)",
  flexShrink: 0,
};

export default function CoachEventDetailPage() {
  const params = useParams<{ id: string; eventId: string }>();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [event, setEvent] = useState<EventRow | null>(null);
  const [clubName, setClubName] = useState("");
  const [groupName, setGroupName] = useState("");

  const [attendees, setAttendees] = useState<AttendeeUiRow[]>([]);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!eventId) throw new Error("Entraînement manquant.");

      // event
      const eRes = await supabase
        .from("club_events")
        .select("id,group_id,club_id,starts_at,duration_minutes,location_text,series_id,status")
        .eq("id", eventId)
        .maybeSingle();

      if (eRes.error) throw new Error(eRes.error.message);
      if (!eRes.data) throw new Error("Entraînement introuvable.");
      const ev = eRes.data as EventRow;
      setEvent(ev);

      // club name
      const cRes = await supabase.from("clubs").select("id,name").eq("id", ev.club_id).maybeSingle();
      setClubName(!cRes.error && cRes.data ? (cRes.data as ClubRow).name ?? "Club" : "Club");

      // group name
      const gRes = await supabase.from("coach_groups").select("id,name").eq("id", ev.group_id).maybeSingle();
      setGroupName(!gRes.error && gRes.data ? (gRes.data as GroupRow).name ?? "Groupe" : "Groupe");

      // attendees (⚠️ no join, because no FK on player_id -> profiles.id)
      const aRes = await supabase
        .from("club_event_attendees")
        .select("player_id,status")
        .eq("event_id", eventId);

      if (aRes.error) throw new Error(aRes.error.message);

      const aList = (aRes.data ?? []) as AttendeeDbRow[];
      const playerIds = aList.map((r) => r.player_id);

      // profiles (second query)
      let profilesById: Record<string, ProfileLite> = {};
      if (playerIds.length > 0) {
        const pRes = await supabase
          .from("profiles")
          .select("id,first_name,last_name,handicap,avatar_url")
          .in("id", playerIds);

        if (pRes.error) throw new Error(pRes.error.message);

        (pRes.data ?? []).forEach((p: any) => {
          profilesById[p.id] = {
            id: p.id,
            first_name: p.first_name ?? null,
            last_name: p.last_name ?? null,
            handicap: p.handicap ?? null,
            avatar_url: p.avatar_url ?? null,
          };
        });
      }

      const uiRows: AttendeeUiRow[] = aList.map((a) => ({
        ...a,
        profile: profilesById[a.player_id] ?? null,
      }));

      // sort by name (nice UX)
      uiRows.sort((x, y) =>
        nameOf(x.profile?.first_name ?? null, x.profile?.last_name ?? null).localeCompare(
          nameOf(y.profile?.first_name ?? null, y.profile?.last_name ?? null),
          "fr"
        )
      );

      setAttendees(uiRows);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setEvent(null);
      setClubName("");
      setGroupName("");
      setAttendees([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const headerSubtitle = useMemo(() => {
    if (!event) return "";
    return `${fmtDateTime(event.starts_at)} • ${clubName}`;
  }, [event, clubName]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 6 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Entraînement — {groupName || "Groupe"}
              </div>
              <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.60)" }}>
                {headerSubtitle}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning`}>
                Retour
              </Link>
              <Link className="cta-green cta-green-inline" href={`/coach/groups/${groupId}/planning/${eventId}/edit`}>
                Modifier
              </Link>
            </div>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Content */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
            ) : !event ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucune donnée.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <div className="marketplace-item-title" style={{ fontSize: 14, fontWeight: 950 }}>
                    {fmtDateTime(event.starts_at)}
                  </div>
                  <div className="marketplace-price-pill">{event.duration_minutes} min</div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="pill-soft">{clubName || "Club"}</span>
                  {event.series_id ? <span className="pill-soft">Récurrent</span> : <span className="pill-soft">Unique</span>}
                  {event.location_text ? (
                    <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}>
                      📍 {event.location_text}
                    </span>
                  ) : null}
                </div>

                <div className="hr-soft" />

                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
                  <Users size={16} />
                  Participants
                </div>

                {attendees.length === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.55)" }}>Aucun joueur.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {attendees.map((a) => {
                      const p = a.profile ?? null;
                      const playerName = nameOf(p?.first_name ?? null, p?.last_name ?? null);
                      const hcp = typeof p?.handicap === "number" ? Number(p.handicap).toFixed(1) : "—";

                      return (
                        <div
                          key={a.player_id}
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
                            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                              <div style={avatarBoxStyle} aria-hidden="true">
                                {initials(p)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 950 }} className="truncate">
                                  {playerName}
                                </div>
                                <div style={{ opacity: 0.7, fontWeight: 800, marginTop: 4, fontSize: 12 }}>
                                  Handicap {hcp}
                                </div>
                              </div>
                            </div>

                            <div className="pill-soft">{a.status}</div>
                          </div>

                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                            <Link className="btn" href={`/coach/groups/${groupId}/planning/${eventId}/players/${a.player_id}`}>
                              <ArrowRight size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              Détail
                            </Link>

                            <Link
                              className="btn"
                              href={`/coach/groups/${groupId}/planning/${eventId}/players/${a.player_id}/edit`}
                            >
                              <Pencil size={16} style={{ marginRight: 6, verticalAlign: "middle" }} />
                              Évaluer
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  className="glass-card"
                  style={{ padding: 12, fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.62)" }}
                >
                  👉 Le coach ouvre le détail d’un joueur (postes + sensations si saisis), puis l’évalue sur une page dédiée.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}