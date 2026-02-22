"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { Flame, Mountain, Smile, SlidersHorizontal } from "lucide-react";

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

type SessionItemRow = {
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  other_detail: string | null;
  created_at?: string;
};

const PAGE_SIZE = 10;

type Preset = "month" | "last3" | "next3" | "all" | "custom";

function isoToYMD(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthRangeLocal(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function last3MonthsRangeLocal(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

/** Les 3 prochains mois à partir d'aujourd'hui (fenêtre glissante) */
function next3MonthsFromTodayRangeLocal(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  end.setMonth(end.getMonth() + 3); // + 3 mois
  return { start, end };
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(0,0,0,0.10)",
  borderRadius: 12,
  padding: "0 12px",
  background: "rgba(255,255,255,0.75)",
  fontWeight: 950,
  color: "rgba(0,0,0,0.80)",
  outline: "none",
  appearance: "none",
};

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
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toISOString();
}

function nextDayStartISO(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    warmup_mobility: "Échauffement / mobilité",
    long_game: "Long jeu",
    putting: "Putting",
    wedging: "Wedging",
    pitching: "Pitching",
    chipping: "Chipping",
    bunker: "Bunker",
    course: "Parcours",
    mental: "Mental",
    fitness: "Fitness",
    other: "Autre",
  };
  return map[cat] ?? cat;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

/** Notes sur 6 (comme sur /player). Ajuste si besoin. */
const MAX_SCORE = 6;

function RatingBar({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
}) {
  const v = typeof value === "number" ? value : 0;
  const pct = clamp((v / MAX_SCORE) * 100, 0, 100);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ display: "inline-flex" }}>{icon}</span>
          <span style={{ fontWeight: 950, fontSize: 12, color: "rgba(0,0,0,0.65)" }}>{label}</span>
        </div>

        <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.55)" }}>{value ?? "—"}</div>
      </div>

      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function TrainingsListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [clubNameById, setClubNameById] = useState<Record<string, string>>({});

  const [itemsBySessionId, setItemsBySessionId] = useState<Record<string, SessionItemRow[]>>({});

  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [preset, setPreset] = useState<Preset>("all");
  const [customOpen, setCustomOpen] = useState(false);

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [deletingId, setDeletingId] = useState<string>("");

  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / PAGE_SIZE));

  // ⚠️ total minutes calculé sur la page courante (comme avant)
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

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let q = supabase
        .from("training_sessions")
        .select(
          "id,start_at,location_text,session_type,club_id,total_minutes,motivation,difficulty,satisfaction,created_at",
          { count: "exact" }
        )
        .order("start_at", { ascending: false });

      if (fromDate) q = q.gte("start_at", startOfDayISO(fromDate));
      if (toDate) q = q.lt("start_at", nextDayStartISO(toDate));

      q = q.range(from, to);

      const sRes = await q;
      if (sRes.error) throw new Error(sRes.error.message);

      const list = (sRes.data ?? []) as SessionRow[];
      setSessions(list);
      setTotalCount(sRes.count ?? 0);

      // clubs names (only for this page)
      const clubIds = Array.from(
        new Set(
          list
            .map((s) => uuidOrNull(s.club_id))
            .filter((x): x is string => typeof x === "string" && x.length > 0)
        )
      );

      if (clubIds.length > 0) {
        const cRes = await supabase.from("clubs").select("id,name").in("id", clubIds);
        if (!cRes.error) {
          const map: Record<string, string> = {};
          (cRes.data ?? []).forEach((c: ClubRow) => {
            map[c.id] = (c.name ?? "Club") as string;
          });
          setClubNameById(map);
        } else {
          setClubNameById({});
        }
      } else {
        setClubNameById({});
      }

      // items (postes) for sessions in this page
      const sessionIds = list.map((s) => s.id);
      if (sessionIds.length > 0) {
        const itRes = await supabase
          .from("training_session_items")
          .select("session_id,category,minutes,note,other_detail,created_at")
          .in("session_id", sessionIds)
          .order("created_at", { ascending: true });

        if (!itRes.error) {
          const map: Record<string, SessionItemRow[]> = {};
          (itRes.data ?? []).forEach((r: any) => {
            const sid = r.session_id as string;
            if (!map[sid]) map[sid] = [];
            map[sid].push(r as SessionItemRow);
          });
          setItemsBySessionId(map);
        } else {
          setItemsBySessionId({});
        }
      } else {
        setItemsBySessionId({});
      }

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? "Erreur chargement.");
      setSessions([]);
      setClubNameById({});
      setItemsBySessionId({});
      setTotalCount(0);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fromDate, toDate]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  useEffect(() => {
  const now = new Date();

  if (preset === "month") {
    const { start, end } = monthRangeLocal(now);
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);
    setFromDate(isoToYMD(start));
    setToDate(isoToYMD(endInclusive));
    setPage(1);
    return;
  }

  if (preset === "last3") {
    const { start, end } = last3MonthsRangeLocal(now);
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);
    setFromDate(isoToYMD(start));
    setToDate(isoToYMD(endInclusive));
    setPage(1);
    return;
  }

  if (preset === "next3") {
    const { start, end } = next3MonthsFromTodayRangeLocal(now);
    const endInclusive = new Date(end);
    endInclusive.setDate(endInclusive.getDate() - 1);
    setFromDate(isoToYMD(start));
    setToDate(isoToYMD(endInclusive));
    setPage(1);
    return;
  }

  if (preset === "all") {
    setFromDate("");
    setToDate("");
    setPage(1);
    return;
  }

  // preset === "custom" => on ne touche pas aux dates
}, [preset]);

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

    const delItems = await supabase.from("training_session_items").delete().eq("session_id", sessionId);
    if (delItems.error) {
      setError(delItems.error.message);
      setDeletingId("");
      return;
    }

    const delSession = await supabase.from("training_sessions").delete().eq("id", sessionId);
    if (delSession.error) {
      setError(delSession.error.message);
      setDeletingId("");
      return;
    }

    setDeletingId("");
    await load();
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              Mes entraînements
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/trainings/new">
                Ajouter
              </Link>
              <Link className="cta-green cta-green-inline" href="/player">
                Dashboard
              </Link>
            </div>
          </div>

          {/* ✅ Filters (preset select + custom dates) */}
<div className="glass-card" style={{ marginTop: 12, padding: 14, overflow: "hidden" }}>
  <div style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <SlidersHorizontal size={16} />
      <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>
        Période
      </div>
    </div>

    <select
      value={preset}
      onChange={(e) => {
        const v = e.target.value as Preset;

        if (v === "custom") {
          setPreset("custom");

          // si aucune date, on initialise sur mois courant
          if (!fromDate && !toDate) {
            const now = new Date();
            const { start, end } = monthRangeLocal(now);
            const endInclusive = new Date(end);
            endInclusive.setDate(endInclusive.getDate() - 1);
            setFromDate(isoToYMD(start));
            setToDate(isoToYMD(endInclusive));
          }

          setCustomOpen(true);
          setPage(1);
          return;
        }

        setPreset(v);
        setCustomOpen(false);
      }}
      disabled={loading}
      style={selectStyle}
      aria-label="Filtrer par période"
    >
      <option value="month">Ce mois</option>
      <option value="last3">3 derniers mois</option>
      <option value="next3">Les 3 prochains mois</option>
      <option value="all">Toute l’activité</option>
      <option value="custom">Personnalisé</option>
    </select>

    {customOpen && preset === "custom" && (
      <>
        <div className="hr-soft" style={{ margin: "2px 0" }} />

        <div style={{ display: "grid", gap: 10, overflow: "hidden" }}>
          <label style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>Du</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPreset("custom");
                setCustomOpen(true);
                setPage(1);
              }}
              disabled={loading}
              style={dateInputStyle}
            />
          </label>

          <label style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>Au</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPreset("custom");
                setCustomOpen(true);
                setPage(1);
              }}
              disabled={loading}
              style={dateInputStyle}
            />
          </label>

          <button
            className="btn"
            type="button"
            onClick={() => {
              setFromDate("");
              setToDate("");
              setPreset("all");
              setCustomOpen(false);
              setPage(1);
            }}
            disabled={loading || !hasDateFilter}
            style={{ width: "100%", height: 44 }}
          >
            Effacer les dates
          </button>
        </div>
      </>
    )}
  </div>
</div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* ✅ Statistique entre les 2 containers */}
        <div className="glass-section" style={{ marginTop: 12 }}>
          <div
            className="glass-card"
            style={{
              padding: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
              <span style={{ fontSize: 18 }}>{loading ? "…" : totalCount}</span>
              <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>
                séance(s)
              </span>
            </div>

            <div style={{ fontWeight: 950, color: "rgba(0,0,0,0.82)" }}>
              <span style={{ fontSize: 18 }}>{loading ? "…" : totalThisPage}</span>
              <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.62)" }}>min</span>
            </div>
          </div>
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
                  const postes = itemsBySessionId[s.id] ?? [];

                  return (
                    <Link key={s.id} href={`/player/trainings/${s.id}`} className="marketplace-link">
                      <div className="marketplace-item">
                        <div style={{ display: "grid", gap: 10 }}>
                          {/* 1) Date/heure + durée */}
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

                          {/* 2) Golf vs privé vs individuel (+ lieu) */}
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            {s.session_type === "club" ? (
                              clubName && <span className="pill-soft">{clubName}</span>
                            ) : (
                              <span className="pill-soft">{typeLabel(s.session_type)}</span>
                            )}

                            {s.location_text && (
                              <span
                                className="truncate"
                                style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}
                              >
                                📍 {s.location_text}
                              </span>
                            )}
                          </div>

                          {/* filets fins autour des postes */}
                          {postes.length > 0 && <div className="hr-soft" style={{ margin: "2px 0" }} />}

                          {postes.length > 0 && (
                            <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                              {postes.map((p, i) => {
                                const extra = (p.note ?? p.other_detail ?? "").trim();
                                return (
                                  <li
                                    key={`${p.session_id}-${i}`}
                                    style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}
                                  >
                                    {categoryLabel(p.category)} — {p.minutes} min
                                    {extra ? (
                                      <span style={{ fontWeight: 700, color: "rgba(0,0,0,0.55)" }}> • {extra}</span>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          {postes.length > 0 && <div className="hr-soft" style={{ margin: "2px 0" }} />}

                          {/* sensations */}
                          <div style={{ display: "grid", gap: 10 }}>
                            <RatingBar icon={<Flame size={16} />} label="Motivation" value={s.motivation} />
                            <RatingBar icon={<Mountain size={16} />} label="Difficulté" value={s.difficulty} />
                            <RatingBar icon={<Smile size={16} />} label="Satisfaction" value={s.satisfaction} />
                          </div>

                          {/* actions */}
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                            <Link className="btn" href={`/player/golf/trainings/${s.id}`} onClick={(e) => e.stopPropagation()}>
                              Voir
                            </Link>

                            <Link
                              className="btn"
                              href={`/player/golf/trainings/${s.id}/edit`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Modifier
                            </Link>

                            <button
                              type="button"
                              className="btn btn-danger soft"
                              disabled={loading || deleting}
                              onClick={(e) => {
                                e.preventDefault();
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

          {/* Pagination */}
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
const dateInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.90)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(0,0,0,0.10)",
  borderRadius: 10,
  padding: "10px 12px",
  WebkitAppearance: "none",
  appearance: "none",
};