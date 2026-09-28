"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bell, ExternalLink, MapPin, Trophy } from "lucide-react";
import ActivityDateTile from "@/components/ui/ActivityDateTile";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { supabase } from "@/lib/supabaseClient";
import playerUiStyles from "@/components/player/PlayerUI.module.css";
import styles from "./CompetitionDetail.module.css";

type CompetitionEvent = {
  id:string; event_type:"competition"|"interclub"; title:string|null; starts_at:string; ends_at:string|null;
  duration_minutes:number|null; location_text:string|null; status:string|null; competition_level:string|null;
  competition_category:string|null; external_registration_url:string|null; competition_note:string|null;
};
type Reminder = { scheduled_for:string|null; channel:string|null; message_template:string|null; status:string|null; sent_at:string|null };
type Payload = { event:CompetitionEvent; attendanceStatus:string|null; clubName:string|null; groupName:string|null; showClubName:boolean; reminder:Reminder|null };

const levelLabels:Record<string,string>={internal:"Interne",club:"Club",regional:"Régionale",national:"Nationale",international:"Internationale"};

export default function CompetitionDetailPage(){
  const {locale}=useI18n();
  const params=useParams<{eventId:string}>();
  const eventId=String(params?.eventId??"").trim();
  const [data,setData]=useState<Payload|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const dateLocale=locale==="fr"?"fr-CH":locale==="de"?"de-CH":locale==="it"?"it-CH":"en-US";

  useEffect(()=>{let cancelled=false;void(async()=>{try{setLoading(true);setError(null);const [{effectiveUserId},{data:auth}]=await Promise.all([resolveEffectivePlayerContext(),supabase.auth.getSession()]);const token=auth.session?.access_token??"";if(!token)throw new Error(pickLocaleText(locale,"Session invalide.","Invalid session."));const query=new URLSearchParams({child_id:effectiveUserId});const response=await fetch(`/api/player/competitions/${encodeURIComponent(eventId)}?${query}`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});const json=await response.json();if(!response.ok)throw new Error(String(json.error??pickLocaleText(locale,"Chargement impossible.","Unable to load.")));if(!cancelled)setData(json as Payload)}catch(caught){if(!cancelled)setError(caught instanceof Error?caught.message:pickLocaleText(locale,"Chargement impossible.","Unable to load."))}finally{if(!cancelled)setLoading(false)}})();return()=>{cancelled=true}},[eventId,locale]);

  if(loading)return <div className="player-dashboard-bg"><div className="app-shell marketplace-page"><div className={styles.loading} aria-label={pickLocaleText(locale,"Chargement…","Loading…")}/></div></div>;
  const event=data?.event;
  if(!event||error)return <div className="player-dashboard-bg"><div className="app-shell marketplace-page"><div className={playerUiStyles.alertError}>{error??pickLocaleText(locale,"Compétition introuvable.","Competition not found.")}</div></div></div>;

  const start=new Date(event.starts_at);
  const end=event.ends_at?new Date(event.ends_at):new Date(start.getTime()+Math.max(0,Number(event.duration_minutes??0))*60000);
  const dateTime=(value:Date)=>new Intl.DateTimeFormat(dateLocale,{dateStyle:"long",timeStyle:"short"}).format(value);
  const isFuture=end.getTime()>=Date.now();
  const category=event.competition_category==="all"?pickLocaleText(locale,"Toutes catégories","All categories"):event.competition_category?.toUpperCase()||"—";
  const level=levelLabels[String(event.competition_level??"")]??event.competition_level??"—";
  const attendance=data.attendanceStatus==="present"?pickLocaleText(locale,"Présent","Present"):data.attendanceStatus==="absent"?pickLocaleText(locale,"Absent","Absent"):data.attendanceStatus==="excused"?pickLocaleText(locale,"Excusé","Excused"):pickLocaleText(locale,"Attendu","Expected");
  const organizer=[data.showClubName?data.clubName:null,data.groupName].filter(Boolean).join(" · ");

  return <div className="player-dashboard-bg"><div className="app-shell marketplace-page"><div className={styles.page}>
    <PlayerBreadcrumb items={[{label:"Player",href:"/player"},{label:pickLocaleText(locale,"Mes activités","My activities"),href:"/player/golf/trainings?type=all"},{label:pickLocaleText(locale,"Compétition","Competition")}]}/>
    <header className={playerUiStyles.topline}><div><h1>{pickLocaleText(locale,"Détail de la compétition","Competition details")}</h1><p className={playerUiStyles.lead}>{pickLocaleText(locale,"Retrouve les informations pratiques et les rappels liés à cette compétition.","Review the practical information and reminders for this competition.")}</p></div><div className={playerUiStyles.actions}><Link className={playerUiStyles.secondary} href="/player/golf/trainings?type=all"><ArrowLeft size={15}/>{pickLocaleText(locale,"Retour aux activités","Back to activities")}</Link></div></header>

    <article className={`glass-card ${styles.summary}`}>
      <ActivityDateTile startsAt={event.starts_at} locale={dateLocale} className={styles.dateTile}/>
      <div className={styles.summaryBody}><span className={styles.summaryType}>{event.event_type==="interclub"?"Interclub":pickLocaleText(locale,"Compétition","Competition")}</span><strong className={styles.summaryTitle}>{event.title?.trim()||pickLocaleText(locale,"Compétition du club","Club competition")}{organizer?` · ${organizer}`:""}</strong>{event.location_text?<span className={styles.summaryLocation}><MapPin size={14}/>{event.location_text}</span>:null}</div>
      <span className={styles.summaryStatus}><Trophy size={14}/>{isFuture?pickLocaleText(locale,"À venir","Upcoming"):pickLocaleText(locale,"Terminée","Completed")}</span>
    </article>

    <section className={styles.panel}>
      <div className={styles.panelHeader}><h2>{pickLocaleText(locale,"Détails de la compétition","Competition details")}</h2><p>{pickLocaleText(locale,"Informations communiquées par le club pour cette compétition.","Information shared by the club for this competition.")}</p></div>
      <div className={styles.details}>
        <Detail label={pickLocaleText(locale,"Début","Start")} value={dateTime(start)}/><Detail label={pickLocaleText(locale,"Fin","End")} value={dateTime(end)}/>
        <Detail label={pickLocaleText(locale,"Niveau","Level")} value={level}/><Detail label={pickLocaleText(locale,"Catégorie","Category")} value={category}/>
        <Detail label={pickLocaleText(locale,"Participation","Participation")} value={attendance}/><Detail label={pickLocaleText(locale,"Lieu","Location")} value={event.location_text||pickLocaleText(locale,"Lieu non renseigné","Location not specified")}/>
      </div>
      {event.competition_note?<div className={styles.note}><span className={styles.blockLabel}>{pickLocaleText(locale,"Informations et consignes","Information and instructions")}</span><p>{event.competition_note}</p></div>:null}
      {data.reminder?<div className={styles.reminder}><span className={styles.blockLabel}>{pickLocaleText(locale,"Rappel","Reminder")}</span><div className={styles.reminderMeta}><Bell size={14}/>{data.reminder.scheduled_for?dateTime(new Date(data.reminder.scheduled_for)):pickLocaleText(locale,"Date non renseignée","Date not specified")}</div>{data.reminder.message_template?<p>{data.reminder.message_template}</p>:null}</div>:null}
      {!event.competition_note&&!data.reminder?<div className={styles.empty}>{pickLocaleText(locale,"Aucune information complémentaire ni rappel.","No additional information or reminder.")}</div>:null}
      <div className={styles.actions}>{event.external_registration_url?<a className={playerUiStyles.primary} href={event.external_registration_url} target="_blank" rel="noreferrer noopener"><ExternalLink size={15}/>{pickLocaleText(locale,"Ouvrir l’inscription","Open registration")}</a>:null}</div>
    </section>
  </div></div></div>;
}

function Detail({label,value}:{label:string;value:string}){return <div className={styles.detail}><span>{label}</span><strong>{value}</strong></div>}
