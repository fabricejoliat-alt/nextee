"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { SlidersHorizontal } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type Round = {
  id: string;
  start_at: string;
  round_type: "training" | "competition";
  competition_name: string | null;
  course_name: string | null;
  tee_name: string | null;

  total_score: number | null;
  total_putts: number | null;
  gir: number | null;
};

type HoleLite = {
  round_id: string;
  par: number | null;
  score: number | null;
};

const PAGE_SIZE = 10;

type Preset = "month" | "last3" | "all" | "custom";

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

function fmtDateOnly(iso: string, locale: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-CH" : "en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
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

function roundTitle(r: Round, t: (key: string) => string) {
  if (r.round_type === "competition") {
    return `${t("rounds.competition")}${r.competition_name ? ` — ${r.competition_name}` : ""}`;
  }
  return t("rounds.training");
}

function diffLabelFromDiff(diff: number | null) {
  if (typeof diff !== "number") return null;
  if (diff === 0) return "E";
  return diff > 0 ? `+${diff}` : String(diff);
}

export default function RoundsListPage() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rounds, setRounds] = useState<Round[]>([]);
  const [holesByRoundId, setHolesByRoundId] = useState<Record<string, HoleLite[]>>({});

  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const [preset, setPreset] = useState<Preset>("month");
  const [customOpen, setCustomOpen] = useState(false);

  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / PAGE_SIZE));
  const hasDateFilter = Boolean(fromDate || toDate);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userRes.user) throw new Error(t("rounds.error.invalidSession"));

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let q = supabase
        .from("golf_rounds")
        .select(
          "id,start_at,round_type,competition_name,course_name,tee_name,total_score,total_putts,gir",
          { count: "exact" }
        )
        .order("start_at", { ascending: false });

      if (fromDate) q = q.gte("start_at", startOfDayISO(fromDate));
      if (toDate) q = q.lt("start_at", nextDayStartISO(toDate));

      q = q.range(from, to);

      const rRes = await q;
      if (rRes.error) throw new Error(rRes.error.message);

      const list = (rRes.data ?? []) as Round[];
      setRounds(list);
      setTotalCount(rRes.count ?? 0);

      // 🔁 Comme sur la scorecard: on calcule parTotal et scoreTotal depuis les trous
      const roundIds = list.map((r) => r.id);
      if (roundIds.length > 0) {
        const hRes = await supabase
          .from("golf_round_holes")
          .select("round_id,par,score")
          .in("round_id", roundIds);

        if (hRes.error) throw new Error(hRes.error.message);

        const map: Record<string, HoleLite[]> = {};
        (hRes.data ?? []).forEach((row: any) => {
          const rid = row.round_id as string;
          if (!map[rid]) map[rid] = [];
          map[rid].push({
            round_id: rid,
            par: typeof row.par === "number" ? row.par : row.par ?? null,
            score: typeof row.score === "number" ? row.score : row.score ?? null,
          });
        });
        setHolesByRoundId(map);
      } else {
        setHolesByRoundId({});
      }

      setLoading(false);
    } catch (e: any) {
      setError(e?.message ?? t("common.errorLoading"));
      setRounds([]);
      setHolesByRoundId({});
      setTotalCount(0);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fromDate, toDate]);

  useEffect(() => {
  const now = new Date();
  const { start, end } = monthRangeLocal(now);

  const endInclusive = new Date(end);
  endInclusive.setDate(endInclusive.getDate() - 1);

  setFromDate(isoToYMD(start));
  setToDate(isoToYMD(endInclusive));
}, []);

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

  if (preset === "all") {
    setFromDate("");
    setToDate("");
    setPage(1);
    return;
  }

  // preset === "custom" => on ne touche pas aux dates
}, [preset]);

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

  const computedByRoundId = useMemo(() => {
    const out: Record<
      string,
      { parTotal: number | null; scoreTotal: number | null; diff: number | null; diffLabel: string | null }
    > = {};

    rounds.forEach((r) => {
      const holes = holesByRoundId[r.id] ?? [];

      const parTotal = holes.reduce((acc, h) => acc + (typeof h.par === "number" ? h.par : 0), 0) || 0;

      const scoreTotalFromHoles = holes.reduce((acc, h) => acc + (typeof h.score === "number" ? h.score : 0), 0);
      const holesWithScore = holes.filter((h) => typeof h.score === "number").length;

      const scoreTotal =
        typeof r.total_score === "number" ? r.total_score : holesWithScore > 0 ? scoreTotalFromHoles : null;

      const diff = typeof scoreTotal === "number" && parTotal > 0 ? scoreTotal - parTotal : null;

      out[r.id] = {
        parTotal: parTotal > 0 ? parTotal : null,
        scoreTotal,
        diff,
        diffLabel: diffLabelFromDiff(diff),
      };
    });

    return out;
  }, [rounds, holesByRoundId]);

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        {/* Header */}
        <div className="glass-section">
          <div className="marketplace-header">
            <div className="section-title" style={{ marginBottom: 0 }}>
              {t("rounds.title")}
            </div>

            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href="/player/golf/rounds/new">
                {t("common.add")}
              </Link>
              <Link className="cta-green cta-green-inline" href="/player">
                {t("common.dashboard")}
              </Link>
            </div>
          </div>

          {/* ✅ Filters (preset select + custom dates) */}
<div className="glass-card" style={{ marginTop: 12, padding: 14, overflow: "hidden" }}>
  <div style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <SlidersHorizontal size={16} />
      <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.72)" }}>{t("common.period")}</div>
    </div>

    <select
      value={preset}
      onChange={(e) => {
        const v = e.target.value as Preset;

        if (v === "custom") {
          setPreset("custom");

          // Si aucune date, on initialise sur le mois courant
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
      aria-label={t("common.filterByPeriod")}
    >
      <option value="month">{t("common.thisMonth")}</option>
      <option value="last3">{t("common.last3Months")}</option>
      <option value="all">{t("common.allActivity")}</option>
      <option value="custom">{t("common.custom")}</option>
    </select>

    {customOpen && preset === "custom" && (
      <>
        <div className="hr-soft" style={{ margin: "2px 0" }} />

        <div style={{ display: "grid", gap: 10, overflow: "hidden" }}>
          <label style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>{t("common.from")}</span>
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
            <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(0,0,0,0.65)" }}>{t("common.to")}</span>
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
            title={!hasDateFilter ? t("common.noFilter") : t("common.clearFilter")}
            style={{ width: "100%", height: 44 }}
          >
            {t("common.clearDates")}
          </button>
        </div>
      </>
    )}
  </div>
</div>

          {error && <div className="marketplace-error">{error}</div>}
        </div>

        {/* Stats (sans “sur cette page”) */}
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
                {t("rounds.games")}
              </span>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="glass-section">
          <div className="glass-card">
            {loading ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.loading")}</div>
            ) : totalCount === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("rounds.noneYet")}</div>
            ) : rounds.length === 0 ? (
              <div style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800 }}>{t("common.noResultsForFilter")}</div>
            ) : (
              <div className="marketplace-list marketplace-list-top">
                {rounds.map((r) => {
                  const c = computedByRoundId[r.id];
                  const configParts: string[] = [];
                  if (r.course_name) configParts.push(r.course_name);
                  if (r.tee_name) configParts.push(r.tee_name);
                  const configLine = configParts.filter(Boolean).join(" • ");

                  return (
                    <Link
                      key={r.id}
                      href={`/player/golf/rounds/${r.id}/scorecard`}
                      className="marketplace-link"
                      title={t("rounds.openScorecard")}
                    >
                      <div className="marketplace-item">
                        <div style={{ display: "grid", gap: 10 }}>
                          {/* Ligne 1: date (sans heure) + bloc score (comme scorecard) */}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              alignItems: "flex-start",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div className="marketplace-item-title truncate" style={{ fontSize: 14, fontWeight: 950 }}>
                                {fmtDateOnly(r.start_at, locale)}
                              </div>

                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                                <span className="pill-soft">{roundTitle(r, t)}</span>

                                {!!configLine && (
                                  <span
                                    className="truncate"
                                    style={{ color: "rgba(0,0,0,0.55)", fontWeight: 800, fontSize: 12 }}
                                  >
                                    ⛳ {configLine}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.60)" }}>{t("rounds.score")}</div>
                              <div style={{ fontWeight: 1200, fontSize: 44, lineHeight: 0.95 }}>
                                {c?.scoreTotal ?? "—"}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 950, color: "rgba(0,0,0,0.62)", marginTop: 2 }}>
                                {c?.diffLabel ? `(${c.diffLabel})` : " "}
                              </div>
                            </div>
                          </div>

                          <div className="hr-soft" style={{ margin: "2px 0" }} />

                          {/* Stats rapides (comme avant) */}
                          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)" }}>
                            {t("rounds.putts")}: <span style={{ fontWeight: 900 }}>{r.total_putts ?? "—"}</span>
                            {" • "}
                            GIR: <span style={{ fontWeight: 900 }}>{r.gir ?? "—"}</span>
                            {c?.parTotal ? (
                              <span style={{ fontWeight: 800, color: "rgba(0,0,0,0.55)" }}> • Par {c.parTotal}</span>
                            ) : null}
                          </div>

                          <div className="hr-soft" style={{ margin: "2px 0" }} />

                          {/* action unique */}
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                            <Link
                              className="btn"
                              href={`/player/golf/rounds/${r.id}/scorecard`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {t("rounds.scorecard")}
                            </Link>
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
                  {t("common.prev")}
                </button>

                <div className="marketplace-page-indicator">
                  {t("common.page")} {page} / {totalPages}
                </div>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={loading || page >= totalPages}
                >
                  {t("common.next")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
