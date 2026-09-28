"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { ArrowLeft, Pencil } from "lucide-react";
import playerUiStyles from "@/components/player/PlayerUI.module.css";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { HorizontalScorecard, RoundPerformanceInsights } from "@/components/golf/GolfRoundsWorkspace";
import { getRouteParam } from "@/lib/routeParams";

type Round = {
  id: string;
  user_id: string;
  start_at: string;
  round_type: "training" | "competition";
  competition_name: string | null;
  notes: string | null;
  om_organization_id: string | null;
  om_competition_level: string | null;
  om_competition_format: string | null;
  om_rounds_18_count: number | null;
  score_entry_mode: "full" | "hole_only" | null;
  course_name: string | null;
  tee_name: string | null;

  slope_rating: number | null;
  course_rating: number | null;

  total_score: number | null;
  total_putts: number | null;
  gir: number | null;

  eagles: number | null;
  birdies: number | null;
  pars: number | null;
  bogeys: number | null;
  doubles_plus: number | null;
};

type Hole = {
  id: string;
  hole_no: number;
  par: number | null;
  score: number | null;
  putts: number | null;
  fairway_hit: boolean | null;
  note: string | null;
};

type TournamentRoundRow = {
  id: string;
  competition_name: string | null;
};

function fmtDate(iso: string, locale: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(
    locale === "fr" ? "fr-CH" : locale === "de" ? "de-CH" : locale === "it" ? "it-CH" : "en-GB",
    {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    }
  ).format(d);
}

// GIR rule used in your app
function isGIR(par: number | null, score: number | null, putts: number | null) {
  if (typeof par !== "number") return false;
  if (typeof score !== "number") return false;
  if (typeof putts !== "number") return false;
  return score - putts <= par - 2;
}

export default function ScorecardPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ roundId: string | string[] }>();
  const roundId = useMemo(() => getRouteParam(params?.roundId), [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [roundPositionLabel, setRoundPositionLabel] = useState<string | null>(null);
  const [prevRoundId, setPrevRoundId] = useState<string | null>(null);
  const [nextRoundId, setNextRoundId] = useState<string | null>(null);

  async function load() {
    if (!roundId) {
      setError(t("roundsScorecard.error.invalidRoundId"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const rRes = await supabase
      .from("golf_rounds")
      .select("id,user_id,start_at,round_type,competition_name,notes,om_organization_id,om_competition_level,om_competition_format,om_rounds_18_count,score_entry_mode,course_name,tee_name,slope_rating,course_rating,total_score,total_putts,gir,eagles,birdies,pars,bogeys,doubles_plus")
      .eq("id", roundId)
      .maybeSingle();

    if (rRes.error) {
      setError(rRes.error.message);
      setRound(null);
      setLoading(false);
      return;
    }
    if (!rRes.data) {
      setError(t("roundsScorecard.error.notFound"));
      setRound(null);
      setLoading(false);
      return;
    }
    const loadedRound = rRes.data as Round;
    setRound(loadedRound);

    setRoundPositionLabel(null);
    setPrevRoundId(null);
    setNextRoundId(null);
    if (
      loadedRound.round_type === "competition" &&
      (loadedRound.om_rounds_18_count ?? 1) > 1 &&
      loadedRound.om_organization_id &&
      loadedRound.om_competition_format
    ) {
      const year = new Date(loadedRound.start_at).getFullYear();
      const yearStart = `${year}-01-01T00:00:00.000Z`;
      const nextYearStart = `${year + 1}-01-01T00:00:00.000Z`;

      const sameTournamentRes = await supabase
        .from("golf_rounds")
        .select("id,competition_name")
        .eq("round_type", "competition")
        .eq("user_id", loadedRound.user_id)
        .eq("om_organization_id", loadedRound.om_organization_id)
        .eq("om_competition_format", loadedRound.om_competition_format)
        .eq("om_competition_level", loadedRound.om_competition_level)
        .eq("om_rounds_18_count", loadedRound.om_rounds_18_count)
        .gte("start_at", yearStart)
        .lt("start_at", nextYearStart)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true });

      if (!sameTournamentRes.error) {
        const normCurrentName = (loadedRound.competition_name ?? "").trim().toLowerCase();
        const tournamentRows = (sameTournamentRes.data ?? []) as TournamentRoundRow[];
        const sameTournament = tournamentRows.filter((r) => {
          const normName = (r.competition_name ?? "").trim().toLowerCase();
          return normName === normCurrentName;
        });
        const idx = sameTournament.findIndex((r) => r.id === loadedRound.id);
        if (idx >= 0) {
          setRoundPositionLabel(`Tour ${idx + 1}/${sameTournament.length}`);
          if (idx > 0) setPrevRoundId(String(sameTournament[idx - 1].id));
          if (idx < sameTournament.length - 1) setNextRoundId(String(sameTournament[idx + 1].id));
        }
      }
    }

    const hRes = await supabase
      .from("golf_round_holes")
      .select("id,hole_no,par,score,putts,fairway_hit,note")
      .eq("round_id", roundId)
      .order("hole_no", { ascending: true });

    if (hRes.error) {
      setError(hRes.error.message);
      setLoading(false);
      return;
    }

    setHoles((hRes.data ?? []) as Hole[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const computed = useMemo(() => {
    const parTotal = holes.reduce((acc, h) => acc + (typeof h.par === "number" ? h.par : 0), 0);

    const scoreTotalFromHoles = holes.reduce((acc, h) => acc + (typeof h.score === "number" ? h.score : 0), 0);
    const holesWithScore = holes.filter((h) => typeof h.score === "number").length;
    const overParTotalFromHoles = holes.reduce(
      (acc, h) =>
        acc +
        (typeof h.par === "number" && typeof h.score === "number"
          ? h.score - h.par
          : 0),
      0
    );
    const holesWithParAndScore = holes.filter((h) => typeof h.par === "number" && typeof h.score === "number").length;

    const scoreTotal =
      typeof round?.total_score === "number" ? round.total_score : holesWithScore > 0 ? scoreTotalFromHoles : null;

    const filled = holes.filter((h) => typeof h.par === "number" && typeof h.score === "number");

    let eagles = 0,
      birdies = 0,
      pars = 0,
      bogeys = 0,
      doubleBogeys = 0,
      doublesPlus = 0;

    const useStats = round?.score_entry_mode !== "hole_only";
    let girCount = 0;
    let puttsTotal = 0;
    let scramblingOpportunities = 0;
    let scramblingSuccesses = 0;

    filled.forEach((h) => {
      const d = (h.score as number) - (h.par as number);

      if (d <= -2) eagles++;
      else if (d === -1) birdies++;
      else if (d === 0) pars++;
      else if (d === 1) bogeys++;
      else if (d === 2) doubleBogeys++;
      else if (d >= 3) doublesPlus++;

      if (useStats) {
        if (isGIR(h.par, h.score, h.putts)) girCount++;
        else if (typeof h.putts === "number") {
          // Scrambling: par (or better) after missing GIR.
          scramblingOpportunities += 1;
          if ((h.score as number) <= (h.par as number)) scramblingSuccesses += 1;
        }
        if (typeof h.putts === "number") puttsTotal += h.putts;
      }
    });

    const gir = typeof round?.gir === "number" ? round.gir : filled.length ? girCount : null;
    const putts = typeof round?.total_putts === "number" ? round.total_putts : puttsTotal || null;
    const scramblingPct =
      scramblingOpportunities > 0
        ? Math.round((scramblingSuccesses / scramblingOpportunities) * 100)
        : null;

    return {
      parTotal: parTotal || null,
      scoreTotal,
      overParTotal: holesWithParAndScore > 0 ? overParTotalFromHoles : null,
      eagles: typeof round?.eagles === "number" ? round.eagles : eagles,
      birdies: typeof round?.birdies === "number" ? round.birdies : birdies,
      pars: typeof round?.pars === "number" ? round.pars : pars,
      bogeys: typeof round?.bogeys === "number" ? round.bogeys : bogeys,
      doubleBogeys,
      doublesPlus,
      gir,
      putts,
      scramblingPct,
      scramblingSuccesses,
      scramblingOpportunities,
      holesPlayed: holesWithScore,
    };
  }, [holes, round]);

  const configLine = useMemo(() => {
    if (!round) return "";
    const parts: string[] = [];
    parts.push(round.round_type === "competition" ? t("rounds.competition") : t("rounds.training"));
    if (round.course_name) parts.push(round.course_name);
    if (round.tee_name) parts.push(round.tee_name);
    return parts.filter(Boolean).join(" • ");
  }, [round, t]);

  if (loading) {
    return (
      <div className="player-dashboard-bg">
        <div className={`app-shell marketplace-page ${playerUiStyles.page}`}>
          <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("rounds.title"), href: "/player/golf/rounds" }, { label: t("rounds.scorecard") }]} />
          <div className={playerUiStyles.topline}>
            <div>
              <h1>{t("rounds.scorecard")}</h1>
              <p className={playerUiStyles.lead}>{t("common.loading")}</p>
            </div>
          </div>
          <div className={playerUiStyles.panel}>
            <CompactLoadingBlock label={t("common.loading")} />
          </div>
        </div>
      </div>
    );
  }

  if (!round) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 900 }}>{t("rounds.scorecard")}</div>
          <div style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>
            {error ?? t("roundsScorecard.error.cannotDisplay")}
          </div>
        </div>
        <Link className="btn" href="/player/golf/rounds">
          {t("common.back")}
        </Link>
      </div>
    );
  }

  return (
    <div className="player-dashboard-bg">
      <div className={`app-shell marketplace-page ${playerUiStyles.page}`}>
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("rounds.title"), href: "/player/golf/rounds" }, { label: t("rounds.scorecard") }]} />
        <div className={playerUiStyles.topline}>
          <div>
            <h1>{t("rounds.scorecard")}</h1>
            <p className={playerUiStyles.lead}>{configLine || fmtDate(round.start_at, locale)}</p>
          </div>
          <div className="marketplace-actions" style={{ marginTop: 2 }}>
              {prevRoundId ? (
                <Link className={playerUiStyles.secondary} href={`/player/golf/rounds/${prevRoundId}/scorecard`}>
                  Tour precedent
                </Link>
              ) : null}
              {nextRoundId ? (
                <Link className={playerUiStyles.secondary} href={`/player/golf/rounds/${nextRoundId}/scorecard`}>
                  Tour suivant
                </Link>
              ) : null}
              <Link className={playerUiStyles.primary} href={`/player/golf/rounds/${round.id}/edit`}>
                <Pencil size={15} aria-hidden="true" />
                {t("common.edit")}
              </Link>
              <Link className={playerUiStyles.secondary} href="/player/golf/rounds">
                <ArrowLeft size={16} aria-hidden="true" />
                {t("rounds.title")}
              </Link>
            </div>
        </div>
        {error && <div className="marketplace-error" role="alert">{error}</div>}

        {/* Summary glass card */}
        <div className="glass-section">
          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "center" }}>
              <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                <div style={{ fontWeight: 1100, fontSize: 16, lineHeight: 1.15 }} className="truncate">
                  {fmtDate(round.start_at, locale)}
                </div>

                {roundPositionLabel && (
                  <div style={{ fontSize: 12, fontWeight: 1000, color: "rgba(0,0,0,0.70)" }}>
                    {roundPositionLabel}
                  </div>
                )}

                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.65)", lineHeight: 1.35 }} className="truncate">
                  {configLine || " "}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={kvRow}>
                    <span style={kvKey}>{t("roundsScorecard.slope")}</span>
                    <span style={kvVal}>{typeof round.slope_rating === "number" ? round.slope_rating : "—"}</span>
                  </div>

                  <div style={kvRow}>
                    <span style={kvKey}>{t("roundsScorecard.courseRating")}</span>
                    <span style={kvVal}>{typeof round.course_rating === "number" ? round.course_rating : "—"}</span>
                  </div>
                </div>

                {round.notes?.trim() ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.72)", lineHeight: 1.45 }}>
                    <span style={{ fontWeight: 950 }}>Notes:</span> {round.notes}
                  </div>
                ) : null}
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(0,0,0,0.60)" }}>{t("rounds.score")}</div>
                <div style={{ fontWeight: 1200, fontSize: 44, lineHeight: 0.95 }}>{computed.scoreTotal ?? "—"}</div>
                <div style={{ fontSize: 14, fontWeight: 950, color: "rgba(0,0,0,0.62)", marginTop: 2 }}>
                  {computed.overParTotal != null
                    ? computed.overParTotal > 0
                      ? `(+${computed.overParTotal})`
                      : computed.overParTotal < 0
                      ? `(${computed.overParTotal})`
                      : `(0)`
                    : " "}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-section">
          <HorizontalScorecard holes={holes} />
        </div>

        <div className="glass-section">
          <RoundPerformanceInsights roundId={round.id} holes={holes} />
        </div>
      </div>
    </div>
  );
}

const kvRow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.10)",
  background: "rgba(255,255,255,0.55)",
};

const kvKey: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  color: "rgba(0,0,0,0.55)",
};

const kvVal: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 1100,
  color: "rgba(0,0,0,0.82)",
};
