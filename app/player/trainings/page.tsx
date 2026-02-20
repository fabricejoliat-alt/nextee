"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type SessionRow = {
  id: string;
  start_at: string;
  location_text: string | null;
  session_type: "club" | "private" | "individual";
  club_id: string | null;
  total_minutes: number | null;
  motivation: number | null;
  difficulty: number | null;
  satisfaction: number | null;
  created_at: string;
};

type ClubRow = { id: string; name: string | null };

const PAGE_SIZE = 10;

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

function typeLabel(t: SessionRow["session_type"]) {
  if (t === "club") return "Club";
  if (t === "private") return "Privé";
  return "Individuel";
}

function uuidOrNull(v: any) {
  const s = String(v ?? "").trim();
  if (!s || s === "undefined" || s === "null") return null;
  return s;
}

function startOfDayISO(dateStr: string) {
  // dateStr = YYYY-MM-DD
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toISOString();
}

function nextDayStartISO(dateStr: string) {
  // inclusive end-date -> we filter with lt nextDayStart
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export default function TrainingsListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});

  // ✅ date filter
  const [fromDate, setFromDate] = useState<string>(""); // YYYY-MM-DD
  const [toDate, setToDate] = useState<string>(""); // YYYY-MM-DD

  // ✅ pagination
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // ✅ delete state
  const [deletingId, setDeletingId] = useState<string>("");

  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / PAGE_SIZE));

  const totalThisPage = useMemo(() => {
    return sessions.reduce((sum, s) => sum + (s.total_minutes || 0), 0);
  }, [sessions]);

  const hasDateFilter = Boolean(fromDate || toDate);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error("Session invalide.");

      // ---- query sessions (sorted newest -> oldest) + pagination + date filter
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let q = supabase
        .from("training_sessions")
        .select(
          "id,start_at,location_text,session_type,club_id,total_minutes,motivation,difficulty,satisfaction,created_at",
          { count: "exact" }
        )
        .order("start_at", { ascending: false });

      // date filter
      if (fromDate) {
        q = q.gte("start_at", startOfDayISO(fromDate));
      }
      if (toDate) {
        q = q.lt("start_at", nextDayStartISO(toDate));
      }

      q = q.range(from, to);

      const sRes = await q;
      if (sRes.error) throw new Error(sRes.error.message);

      const list = (sRes.data ?? []) as SessionRow[];
      setSessions(list);
      setTotalCount(sRes.count ?? 0);

      // ---- clubs names (only for this page)
      const clubIds = Array.from(
        new Set(
          list
            .map((s) => uuidOrNull(s.club_id))
            .filter((x): x is string => typeof x === "string" && x.length > 0)
        )
      );

      if (clubIds.length === 0) {
        setClubNameById({});
        setLoading(false);
        return;
      }

      const cRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
      if (cRes.error) {
        setClubNameById({});
        setLoading(false);
        return;
      }

      const map: Record<string, string> = {};
      (cRes.data ?? []).forEach((c: ClubRow) => {
        map[c.id] = (c.name ?? "Club") as string;
      });
      setClubNameById(map);

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setSessions([]);
      setClubNameById({});
      setTotalCount(0);
      setLoading(false);
    }
  }

  // reload on filter/page
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fromDate, toDate]);

  // keep page valid if filter changes results
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  function clearFilters() {
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  function onChangeFrom(v: string) {
    setFromDate(v);
    setPage(1);
  }

  function onChangeTo(v: string) {
    setToDate(v);
    setPage(1);
  }

  async function handleDelete(sessionId: string) {
    const ok = window.confirm("Supprimer cet entraînement ? Cette action est définitive.");
    if (!ok) return;

    setDeletingId(sessionId);
    setError(null);

    // 1) delete items
    const delItems = await supabase.from("training_session_items").delete().eq("session_id", sessionId);
    if (delItems.error) {
      setError(delItems.error.message);
      setDeletingId("");
      return;
    }

    // 2) delete session
    const delSession = await supabase.from("training_sessions").delete().eq("id", sessionId);
    if (delSession.error) {
      setError(delSession.error.message);
      setDeletingId("");
      return;
    }

    // 3) reload current page (count + pagination correct)
    setDeletingId("");
    await load();
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 10 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Mes entraînements
              </div>

              <div className="marketplace-filter-label" style={{ marginTop: 6, marginBottom: 8 }}>
                {loading ? "…" : `${totalCount} séance(s) • ${totalThisPage} min (page ${page}/${totalPages})`}
              </div>
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/trainings/new">
                Ajouter
              </Link>
              <Link className="cta-green cta-green-inline" href="/player">
                Dashboard
              </Link>
            </div>
          </div>

          {/* Date filter row */}
          <div className="marketplace-filter-row" style={{ marginTop: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="marketplace-filter-label" style={{ margin: 0 }}>
                Du
              </span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => onChangeFrom(e.target.value)}
                disabled={loading}
                style={{
                  background: "rgba(255,255,255,0.78)",
                  border: "1px solid rgba(255,255,255,0.22)",
                }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="marketplace-filter-label" style={{ margin: 0 }}>
                Au
              </span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => onChangeTo(e.target.value)}
                disabled={loading}
                style={{
                  background: "rgba(255,255,255,0.78)",
                  border: "1px solid rgba(255,255,255,0.22)",
                }}
              />
            </label>

            <button
              className="btn marketplace-filter-clear"
              type="button"
              onClick={clearFilters}
              disabled={loading || !hasDateFilter}
              title={!hasDateFilter ? "Aucun filtre" : "Effacer le filtre"}
            >
              Effacer
            </button>
          </div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* List */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Chargement…</div>
            ) : totalCount === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucun entraînement pour le moment.</div>
            ) : sessions.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>Aucun résultat pour ce filtre.</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {sessions.map((s) => {
                  const clubName =
                    s.session_type === "club" && s.club_id ? clubNameById[s.club_id] ?? "Club" : null;

                  const deleting = deletingId === s.id;

                  return (
                    <Link key={s.id} href={`/player/trainings/${s.id}`} className="marketplace-link">
                      <div className="marketplace-item">
                        <div style={{ display: "grid", gap: 8 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 10,
                              alignItems: "baseline",
                            }}
                          >
                            <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                              {fmtDateTime(s.start_at)}
                            </div>

                            <div className="marketplace-price-pill">
                              {(s.total_minutes ?? 0) > 0 ? `${s.total_minutes} min` : "—"}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <span className="pill-soft">{typeLabel(s.session_type)}</span>
                            {clubName && <span className="pill-soft">{clubName}</span>}
                            {s.location_text && (
                              <span
                                className="truncate"
                                style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}
                              >
                                📍 {s.location_text}
                              </span>
                            )}
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <span className="pill-soft">Motivation: {s.motivation ?? "—"}</span>
                            <span className="pill-soft">Difficulté: {s.difficulty ?? "—"}</span>
                            <span className="pill-soft">Satisfaction: {s.satisfaction ?? "—"}</span>
                          </div>

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                            <Link className="btn" href={`/player/trainings/${s.id}`} onClick={(e) => e.stopPropagation()}>
                              Voir
                            </Link>

                            <Link
                              className="btn"
                              href={`/player/trainings/${s.id}/edit`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Modifier
                            </Link>

                            {/* ✅ Supprimer */}
                            <button
                              type="button"
                              className="btn btn-danger soft"
                              disabled={loading || deleting}
                              onClick={(e) => {
                                e.preventDefault(); // empêche la navigation du Link parent
                                e.stopPropagation();
                                handleDelete(s.id);
                              }}
                              title="Supprimer cet entraînement"
                            >
                              {deleting ? "Suppression…" : "Supprimer"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pagination (like marketplace) */}
          {totalCount > 0 && (
            <div className="glass-section">
              <div className="marketplace-pagination">
                <button
                  className="btn"
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={loading || page <= 1}
                >
                  ← Précédent
                </button>

                <div className="marketplace-page-indicator">
                  Page {page} / {totalPages}
                </div>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={loading || page >= totalPages}
                >
                  Suivant →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}