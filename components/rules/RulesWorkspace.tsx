"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, CalendarDays, CheckCircle2, ChevronRight, CircleAlert, Clock3, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { rulesPhase } from "@/lib/rulesLearning";
import styles from "./RulesWorkspace.module.css";
import PlayerRulesWorkspace, { PlayerRulesLoading } from "./PlayerRulesWorkspace";
import CoachRulesWorkspace, { CoachRulesLoading } from "./CoachRulesWorkspace";

type Scope = "player" | "coach" | "manager" | "admin";
export type Series = { id:string; position:number; title_i18n:Record<string,string>; discovery_starts_at:string; quiz_opens_at:string; quiz_closes_at:string; results_published_at:string|null; archived_at:string|null; status:string };
export type Card = { position:number; card_version_id:string; rules_card_versions:{ id:string; title:string; situation:string; simple_explanation:string; action_text:string; common_mistake:string; coach_tip:string; official_reference:string; image_url:string|null; image_alt:string; human_review_required:boolean; approved_at:string|null } };
export type RulesLeaderboard =
  | { status:"upcoming"; publishesAt:string|null }
  | { status:"unavailable" }
  | { status:"published"; club:{ name:string|null; participants:number; rows:Array<{rank:number;name:string|null;score:number;isMe:boolean}> }; interclub:{ retainedScores:number; rows:Array<{clubId:string;rank:number|null;name:string;participants:number;eligible:boolean;score:number;minimum:number;isMyClub:boolean}> } };
type Payload = { season:{ title_i18n:Record<string,string>; status:string }|null; series:Series[]; currentSeriesId:string|null; cards:Card[]; progress:Array<{card_version_id:string}>; leaderboard:RulesLeaderboard|null };

export default function RulesWorkspace({ scope }: { scope: Scope }) {
  const { locale } = useI18n(); const tr=useCallback((fr:string,en:string)=>pickLocaleText(locale,fr,en),[locale]);
  const [data,setData]=useState<Payload|null>(null); const [error,setError]=useState(""); const [selected,setSelected]=useState<Card|null>(null);
  const load=useCallback(async()=>{ const { data:session }=await supabase.auth.getSession(); setError(""); const token=session.session?.access_token; if(!token){setError(tr("Session expirée.","Session expired."));return;} const res=await fetch("/api/rules/overview",{headers:{Authorization:`Bearer ${token}`},cache:"no-store"}); const json=await res.json().catch(()=>({})); if(!res.ok){setError(String(json.error??tr("Chargement impossible.","Unable to load.")));return;} setData(json); },[tr]);
  // Loading is an external synchronization; state updates occur after the auth promise resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{void load();},[load]);
  const current=useMemo(()=>data?.series.find(s=>s.id===data.currentSeriesId)??null,[data]);
  const phase=current?rulesPhase(new Date(),{discoveryStartsAt:new Date(current.discovery_starts_at),quizOpensAt:new Date(current.quiz_opens_at),quizClosesAt:new Date(current.quiz_closes_at),resultsPublishedAt:current.results_published_at?new Date(current.results_published_at):null,archivedAt:current.archived_at?new Date(current.archived_at):null}):null;
  const read=new Set(data?.progress.map(p=>p.card_version_id)??[]);
  if(error)return scope==="coach"?<CoachRulesLoading error={error} onRetry={()=>void load()}/>:<main className={styles.page}><section className={styles.state}><CircleAlert/><h1>{tr("Règles de golf","Rules of golf")}</h1><p>{error}</p><button onClick={()=>void load()}><RefreshCw size={16}/>{tr("Réessayer","Try again")}</button></section></main>;
  if(!data)return scope==="player"?<PlayerRulesLoading/>:scope==="coach"?<CoachRulesLoading/>:<main className={styles.page} aria-busy="true"><div className={styles.skeleton}><i/><i/><i/><i/></div></main>;
  if(!data.season)return scope==="coach"?<CoachRulesLoading empty/>:<main className={styles.page}><section className={styles.state}><BookOpen/><h1>{tr("Règles de golf","Rules of golf")}</h1><p>{scope==="admin"?tr("La migration est prête. Créez ou publiez une saison après validation éditoriale.","The migration is ready. Create or publish a season after editorial review."):tr("Aucune saison n’est publiée pour le moment.","No season is published yet.")}</p></section></main>;
  const phaseLabel=phase?tr({upcoming:"À venir",learning:"Apprentissage",quiz_soon:"Quiz bientôt",quiz_open:"Quiz ouvert",quiz_closed:"Quiz terminé",results:"Résultats publiés",archived:"Archivé"}[phase],phase):tr("Préparation","Preparing");
  if(scope==="player")return <PlayerRulesWorkspace series={data.series} current={current} cards={data.cards} read={read} phase={phase} phaseLabel={phaseLabel} leaderboard={data.leaderboard} />;
  if(scope==="coach")return <CoachRulesWorkspace series={data.series} current={current} cards={data.cards} read={read} phaseLabel={phaseLabel} />;
  return <main className={`${styles.page} ${scope==="admin"?styles.adminPage:""}`}>
    {scope==="admin"?<>
      <nav className={styles.adminBreadcrumb} aria-label={tr("Fil d’Ariane","Breadcrumb")}><Link href="/admin">{tr("Administration","Administration")}</Link><ChevronRight size={14} aria-hidden="true"/><span>{tr("Règles de golf","Rules of golf")}</span></nav>
      <header className={styles.adminTopline}><div><p className={styles.adminEyebrow}>{tr("Contenus pédagogiques","Learning content")}</p><h1>{tr("Gestion des règles de golf","Golf rules management")}</h1><p className={styles.adminLead}>{tr("Configurez la saison annuelle, contrôlez les 12 séries et préparez la publication des contenus.","Configure the annual season, review all 12 series and prepare content publication.")}</p></div><div className={styles.adminSummary} aria-label={phaseLabel}><ShieldCheck size={18} aria-hidden="true"/><span><b>{data.series.length}</b> {tr("séries","series")}</span><i aria-hidden="true"/><span>{phaseLabel}</span></div></header>
    </>:<header className={styles.hero}><div><span><BookOpen size={16}/>{tr("Parcours annuel","Annual journey")}</span><h1>{data.season.title_i18n[locale]??data.season.title_i18n.fr}</h1><p>{current?.title_i18n[locale]??current?.title_i18n.fr}</p></div><div className={styles.phase}><Clock3 size={18}/><b>{phaseLabel}</b></div></header>}
    <section className={styles.metrics}>
      <article><CheckCircle2/><div><b>{read.size}/6</b><span>{tr("règles consultées","rules viewed")}</span></div></article>
      <article><CalendarDays/><div><b>{data.series.length}/12</b><span>{tr("séries programmées","scheduled series")}</span></div></article>
      <article>{scope==="manager"?<Users/>:<ShieldCheck/>}<div><b>{tr("Vue "+scope,scope+" view")}</b><span>{tr("suivi sécurisé","secure tracking")}</span></div></article>
    </section>
    {data.cards.length?<section><div className={styles.sectionTitle}><div><span>{tr("Série actuelle","Current series")}</span><h2>{tr("Les six règles à découvrir","Six rules to discover")}</h2></div></div><div className={styles.grid}>{data.cards.map(card=><button key={card.card_version_id} onClick={()=>setSelected(card)} className={styles.card}><span className={styles.cardNumber}>{card.position}</span><div><small>{read.has(card.card_version_id)?tr("Consultée","Viewed"):tr("À découvrir","Discover")}</small><h3>{card.rules_card_versions.title}</h3><p>{card.rules_card_versions.situation}</p><em>{card.rules_card_versions.official_reference}</em></div><ChevronRight size={18}/></button>)}</div></section>:<section className={styles.state}><CircleAlert/><h2>{tr("Contenu en validation","Content under review")}</h2><p>{tr("Cette série ne peut pas être publiée tant que ses six fiches et leurs questions ne sont pas approuvées.","This series cannot be published until its six cards and questions are approved.")}</p></section>}
    <section><div className={styles.sectionTitle}><div><span>{tr("Saison","Season")}</span><h2>{tr("Calendrier des 12 séries","12-series calendar")}</h2></div></div><div className={styles.timeline}>{data.series.map(s=><article key={s.id}><b>{s.position}</b><div><strong>{s.title_i18n[locale]??s.title_i18n.fr}</strong><span>{new Intl.DateTimeFormat(locale==="fr"?"fr-CH":"en-GB",{month:"long",timeZone:"Europe/Zurich"}).format(new Date(s.discovery_starts_at))}</span></div></article>)}</div></section>
    {selected?<div className={styles.backdrop} role="presentation" onMouseDown={()=>setSelected(null)}><article className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="rule-title" onMouseDown={e=>e.stopPropagation()}><button className={styles.close} onClick={()=>setSelected(null)} aria-label={tr("Fermer","Close")}>×</button><small>{selected.rules_card_versions.official_reference}</small><h2 id="rule-title">{selected.rules_card_versions.title}</h2><h3>{tr("Situation","Situation")}</h3><p>{selected.rules_card_versions.situation}</p><h3>{tr("Ce que je dois faire","What I should do")}</h3><p>{selected.rules_card_versions.action_text}</p><h3>{tr("Erreur fréquente","Common mistake")}</h3><p>{selected.rules_card_versions.common_mistake}</p><h3>{tr("Conseil coach","Coach tip")}</h3><p>{selected.rules_card_versions.coach_tip}</p></article></div>:null}
  </main>;
}
