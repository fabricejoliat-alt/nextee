"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Eye, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { useManagerClubSelection } from "@/components/manager/useManagerClubSelection";
import ManagerClubSelect from "@/components/manager/ManagerClubSelect";
import { omBonusSubtitle, omDate, omPoints, omText, omError } from "@/lib/managerOrderOfMerit";
import styles from "./OrderOfMerit.module.css";

type RankingMode = "net" | "brut";

type ProfileAvatar = { id: string; avatar_url: string | null };
type RankingRow = {
  player_id: string;
  full_name: string;
  tournament_points_net: number | string;
  bonus_points_net: number | string;
  total_points_net: number | string;
  rank_net: number;
  tournament_points_brut: number | string;
  bonus_points_brut: number | string;
  total_points_brut: number | string;
  rank_brut: number;
  period_slot: number;
  period_limit: number;
};
type TournamentScore = {
  round_id: string;
  competition_level: string;
  competition_format: string;
  rounds_18_count: number;
  total_points_net: number | string;
  total_points_brut: number | string;
  occurred_on: string;
  calculated_at: string;
};
type RoundMeta = { id: string; start_at: string; competition_name: string | null; course_name: string | null };
type BonusEntry = {
  id: string;
  bonus_type: string;
  points_net: number | string;
  points_brut: number | string;
  description: string | null;
  occurred_on: string;
};
type PointDetail = {
  id: string;
  date: string;
  sortOccurredOn: string;
  sortCalculatedAt: string;
  sortRoundId: string;
  title: string | null;
  labelKey: string;
  subtitle: string | null;
  pointsNet: number;
  pointsBrut: number;
  includedNet: boolean;
  includedBrut: boolean;
  isBonus: boolean;
};

function numberValue(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[parts.length - 1].slice(0, 1)}`.toUpperCase();
}

export default function ManagerOrderOfMeritPage() {
  const {t,locale}=useI18n(),club=useManagerClubSelection(),{clubId}=club;
  const tr=(key:string,values?:Record<string,string|number>)=>omText(t,key,values);
  const formatPoints=(value:number|string|null|undefined)=>omPoints(value,locale);
  const formatDate=(value:string)=>omDate(value,locale,tr("undated"));
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()), []);
  const yearStart = useMemo(() => `${today.slice(0, 4)}-01-01`, [today]);

  const [rankingLoading, setRankingLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState(yearStart);
  const [toDate, setToDate] = useState(today);
  const [mode, setMode] = useState<RankingMode>("net");
  const [storedRows, setRows] = useState<RankingRow[]>([]);
  const [avatarByPlayerId, setAvatarByPlayerId] = useState<Record<string, string | null>>({});
  const [storedPlayer, setSelectedPlayer] = useState<RankingRow | null>(null);
  const [details, setDetails] = useState<PointDetail[]>([]);

  const [loadedScope,setLoadedScope]=useState("");
  const scope=`${clubId}:${fromDate}:${toDate}`,rankVersion=useRef(0),detailVersion=useRef(0);
  const validDates=Boolean(fromDate&&toDate&&fromDate<=toDate);
  const ready=scope===loadedScope&&!club.loading&&!club.error;
  const rows=ready?storedRows:[],selectedPlayer=ready?storedPlayer:null;
  const loadRanking=useCallback(async()=>{
    const token=++rankVersion.current;++detailVersion.current;setSelectedPlayer(null);setDetails([]);setRows([]);setLoadedScope("");setAvatarByPlayerId({});setError(null);
    if(!clubId||!fromDate||!toDate||fromDate>toDate){setRankingLoading(false);return;}
    setRankingLoading(true);
    try{
      const {data,error:cause}=await supabase.rpc("get_manager_om_ranking_v1",{p_club_id:clubId,p_from:fromDate,p_to:toDate,p_player_id:null});
      if(cause)throw cause;
      if(data?.club_id!==clubId||!Array.isArray(data.rows)||!Array.isArray(data.avatars))throw new Error("invalid_response");
      if(token!==rankVersion.current)return;
      setRows(data.rows);setAvatarByPlayerId(Object.fromEntries((data.avatars as ProfileAvatar[]).map(p=>[p.id,p.avatar_url])));setLoadedScope(scope);
    }catch(cause){if(token===rankVersion.current){const failure=omError(cause);setError(failure.definite?failure.key:"load");}}
    finally{if(token===rankVersion.current)setRankingLoading(false);}
  },[clubId,fromDate,toDate,scope]);
  async function loadDetails(player: RankingRow) {
    if(!ready)return;
    const token=++detailVersion.current;
    setSelectedPlayer(player);setDetailsLoading(true);setDetails([]);setError(null);
    try{
    const {data,error:cause}=await supabase.rpc("get_manager_om_ranking_v1",{p_club_id:clubId,p_from:fromDate,p_to:toDate,p_player_id:player.player_id});
    if(cause)throw cause;
    if(data?.club_id!==clubId||data.player_id!==player.player_id||!Array.isArray(data.scores)||!Array.isArray(data.bonuses)||!Array.isArray(data.rounds))throw new Error("invalid_response");
    if(token!==detailVersion.current)return;
    const scores=data.scores as TournamentScore[],bonuses=data.bonuses as BonusEntry[];
    const roundById=new Map((data.rounds as RoundMeta[]).map(round=>[round.id,round]));
    const scoreGroups = new Map<string, TournamentScore[]>();
    scores.forEach((score) => {
      const round = roundById.get(score.round_id);
      const year = round?.start_at ? new Date(round.start_at).getFullYear() : "";
      const competitionName = round?.competition_name?.trim().toLocaleLowerCase("fr") || score.round_id;
      const key = score.rounds_18_count > 1
        ? `${score.competition_level}|${score.competition_format}|${score.rounds_18_count}|${year}|${competitionName}`
        : score.round_id;
      scoreGroups.set(key, [...(scoreGroups.get(key) ?? []), score]);
    });

    const tournamentDetails: PointDetail[] = Array.from(scoreGroups.entries()).map(([groupKey, group]) => {
      const score = [...group].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.calculated_at.localeCompare(a.calculated_at) || a.round_id.localeCompare(b.round_id))[0];
      const round = roundById.get(score.round_id);
      return {
        id: `score:${groupKey}`,
        date: round?.start_at ?? score.occurred_on,
        sortOccurredOn: score.occurred_on,
        sortCalculatedAt: score.calculated_at,
        sortRoundId: score.round_id,
        title: round?.competition_name?.trim() || null,
        labelKey: `level.${["club_internal","club_official","regional","national","international"].includes(score.competition_level)?score.competition_level:"other"}`,
        subtitle: round?.course_name || null,
        pointsNet: numberValue(score.total_points_net),
        pointsBrut: numberValue(score.total_points_brut),
        includedNet: false,
        includedBrut: false,
        isBonus: false,
      };
    });

    const limit = player.period_limit;
    const tournamentTieBreak = (a: PointDetail, b: PointDetail) => b.sortOccurredOn.localeCompare(a.sortOccurredOn) || b.sortCalculatedAt.localeCompare(a.sortCalculatedAt) || a.sortRoundId.localeCompare(b.sortRoundId);
    const includedNetIds = new Set([...tournamentDetails].sort((a, b) => b.pointsNet - a.pointsNet || tournamentTieBreak(a, b)).slice(0, limit).map((detail) => detail.id));
    const includedBrutIds = new Set([...tournamentDetails].sort((a, b) => b.pointsBrut - a.pointsBrut || tournamentTieBreak(a, b)).slice(0, limit).map((detail) => detail.id));
    tournamentDetails.forEach((detail) => {
      detail.includedNet = includedNetIds.has(detail.id);
      detail.includedBrut = includedBrutIds.has(detail.id);
    });
    const bonusDetails: PointDetail[] = bonuses.map((bonus) => ({
      id: `bonus:${bonus.id}`,
      date: bonus.occurred_on,
      sortOccurredOn: bonus.occurred_on,
      sortCalculatedAt: "",
      sortRoundId: "",
      title: null,
      labelKey: `bonus.${["training_presence","camp_day_presence","competition_participation_club","competition_participation_regional","competition_participation_national","competition_participation_international","internal_contest_podium","manual_adjustment"].includes(bonus.bonus_type)?bonus.bonus_type:"other"}`,
      subtitle: omBonusSubtitle(bonus.bonus_type, bonus.description),
      pointsNet: numberValue(bonus.points_net),
      pointsBrut: numberValue(bonus.points_brut),
      includedNet: true,
      includedBrut: true,
      isBonus: true,
    }));
    setDetails([...tournamentDetails, ...bonusDetails].sort((a, b) => b.date.localeCompare(a.date)));
    }catch(cause){if(token===detailVersion.current){const failure=omError(cause);setError(failure.definite?failure.key:"load");}}
    finally{if(token===detailVersion.current)setDetailsLoading(false);}
  }
  useEffect(()=>{void loadRanking();const ranks=rankVersion,detail=detailVersion;return()=>{ranks.current++;detail.current++;};},[loadRanking]);

  const sortedRows = [...rows].sort((a, b) => {
    const rankDifference = mode === "net" ? a.rank_net - b.rank_net : a.rank_brut - b.rank_brut;
    return rankDifference || a.full_name.localeCompare(b.full_name, locale);
  });
  const periodLimit = rows[0]?.period_limit ?? 0;
  const tournamentTotal = rows.reduce((sum, row) => sum + numberValue(mode === "net" ? row.tournament_points_net : row.tournament_points_brut), 0);
  const bonusTotal = rows.reduce((sum, row) => sum + numberValue(mode === "net" ? row.bonus_points_net : row.bonus_points_brut), 0);

  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/manager">Manager</Link><ChevronRight size={13}/><span>{tr("title")}</span><ChevronRight size={13}/><span>{tr("ranking")}</span></nav>
    <div className={styles.topline}><div><h1>{tr("ranking")}</h1><p className={styles.lead}>{tr("rankingLead")}</p></div></div>
    {error||club.error||!validDates?<div className={styles.alertError} role="alert">{club.error||tr(`error.${!validDates?"invalid_dates":error}`)}</div>:null}
    <section className={styles.stats}>
      {[["rankedPlayers",rows.length],["bestResults",periodLimit||"—"],["tournamentPoints",formatPoints(tournamentTotal)],["bonusPoints",formatPoints(bonusTotal)]].map(([key,value])=><div className={styles.stat} key={key}><span>{tr(String(key))}</span><b>{ready?value:"—"}</b></div>)}
    </section>
    <section className={styles.panel}>
      <div className={styles.panelHeader}><div><h2>{tr("title")}</h2>{ready?<p>{tr("rankedCount",{n:rows.length})}</p>:null}</div><button type="button" className={styles.secondary} disabled={rankingLoading||club.loading||!clubId||!validDates} onClick={()=>void loadRanking()}>{tr("retry")}</button></div>
      <div className={styles.toolbar}>
        <label className={styles.field}><span>{tr("from")}</span><input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label>
        <label className={styles.field}><span>{tr("to")}</span><input type="date" min={fromDate||undefined} value={toDate} onChange={e=>setToDate(e.target.value)}/></label>
        <div className={styles.segmented} role="group" aria-label={tr("mode")}>{(["net","brut"] as const).map(m=><button type="button" key={m} className={`${styles.segment} ${mode===m?styles.segmentActive:""}`} aria-pressed={mode===m} onClick={()=>setMode(m)}>{tr(m)}</button>)}</div>
      </div>
      <ManagerClubSelect clubs={club.clubs} clubId={clubId} onChange={club.setClubId}/>
      {club.loading||rankingLoading?<ListLoadingBlock label={tr("loading")}/>:!ready?null:!rows.length?<div className={styles.empty}>{tr("noPoints")}</div>:<div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr>{["rank","player","tournaments","bonus","total","actions"].map(k=><th key={k} scope="col">{tr(k)}</th>)}</tr></thead><tbody>{sortedRows.map(row=><tr key={row.player_id}>
          <td data-label={tr("rank")}><span className={styles.rank}>#{mode==="net"?row.rank_net:row.rank_brut}</span></td>
          <td data-label={tr("player")}><div className={styles.playerCell}><span className={styles.avatar} aria-hidden="true" style={avatarByPlayerId[row.player_id]?{backgroundImage:`url(${avatarByPlayerId[row.player_id]})`}:undefined}>{avatarByPlayerId[row.player_id]?null:initialsFromName(row.full_name)}</span><b>{row.full_name}</b></div></td>
          <td data-label={tr("tournaments")}>{formatPoints(mode==="net"?row.tournament_points_net:row.tournament_points_brut)}</td>
          <td data-label={tr("bonus")}>{formatPoints(mode==="net"?row.bonus_points_net:row.bonus_points_brut)}</td>
          <td data-label={tr("total")}><strong>{formatPoints(mode==="net"?row.total_points_net:row.total_points_brut)}</strong></td>
          <td data-label={tr("actions")}><div className={styles.actions}><button type="button" className={styles.iconButton} aria-label={tr("details",{name:row.full_name})} onClick={()=>void loadDetails(row)}><Eye size={15}/></button></div></td>
        </tr>)}</tbody></table></div>}
      {selectedPlayer?<div className={styles.detailPanel}>
        <div className={styles.detailHeader}><div><h3>{tr("details",{name:selectedPlayer.full_name})}</h3><p>{tr("detailsHelp",{n:selectedPlayer.period_limit})}</p></div><button type="button" className={styles.iconButton} aria-label={tr("close")} onClick={()=>{detailVersion.current++;setSelectedPlayer(null);setDetails([]);}}><X size={15}/></button></div>
        <div className={styles.detailTotals}>{[["tournamentPoints",mode==="net"?selectedPlayer.tournament_points_net:selectedPlayer.tournament_points_brut],["bonusPoints",mode==="net"?selectedPlayer.bonus_points_net:selectedPlayer.bonus_points_brut],["total",mode==="net"?selectedPlayer.total_points_net:selectedPlayer.total_points_brut]].map(([key,value])=><div className={styles.detailTotal} key={key}><span>{tr(String(key))} {tr(mode)}</span><b>{formatPoints(value)}</b></div>)}</div>
        {detailsLoading?<ListLoadingBlock label={tr("loading")}/>:error?null:!details.length?<div className={styles.empty}>{tr("noDetails")}</div>:<div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr>{["date","source","net","brut"].map(k=><th key={k} scope="col">{tr(k)}</th>)}<th scope="col">{tr("calculation",{mode:tr(mode)})}</th></tr></thead><tbody>{details.map(detail=>{
            const included=mode==="net"?detail.includedNet:detail.includedBrut;
            return <tr key={detail.id}><td data-label={tr("date")}>{formatDate(detail.date)}</td><td data-label={tr("source")}><div className={styles.titleCell}><b>{detail.title||tr(detail.labelKey)}</b>{!detail.isBonus||detail.subtitle?<span className={styles.muted}>{[!detail.isBonus?tr(detail.labelKey):null,detail.subtitle].filter(Boolean).join(" · ")}</span>:null}</div></td><td data-label={tr("net")}>{formatPoints(detail.pointsNet)}</td><td data-label={tr("brut")}>{formatPoints(detail.pointsBrut)}</td><td data-label={tr("calculation",{mode:tr(mode)})}><span className={`${styles.badge} ${detail.isBonus?styles.badgeBonus:included?"":styles.badgeMuted}`}>{tr(detail.isBonus?"added":included?"included":"excluded")}</span></td></tr>;
          })}</tbody>
        </table></div>}
      </div>:null}
    </section>
  </main>;
}
