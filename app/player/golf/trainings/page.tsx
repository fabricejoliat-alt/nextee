"use client";
import { useRetainedLoading } from "@/lib/useRetainedLoading";

import CalendarSubscriptionButton from "@/components/calendar/CalendarSubscriptionButton";

import { organizationFetch as fetch } from "@/lib/organizationFetch";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ClipboardCheck, Eye, SlidersHorizontal, MapPin, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useRememberedPeriod } from "@/lib/useRememberedPeriod";
import { playerTrainingEvaluationState } from "@/lib/playerTrainingEvaluation";
import { loadPlayerCalendar } from "@/lib/playerCalendarRead";
import dynamic from "next/dynamic";
import { savePlayerAttendance } from "@/lib/playerAttendanceWrite";
import { invalidateClientPageCacheByPrefix } from "@/lib/clientPageCache";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import playerUiStyles from "@/components/player/PlayerUI.module.css";
import styles from "./PlayerActivities.module.css";
import dashboardStyles from "@/app/player/PlayerDashboard.module.css";
import AccessibleDialog from "@/components/ui/AccessibleDialog";

function PlannerFormLoading(){const {t}=useI18n();return <div className={styles.plannerLoading} role="status">{t("common.loading")}</div>}
const PlayerTrainingNewClient = dynamic(() => import("./new/PlayerTrainingNewClient"), { ssr:false, loading:PlannerFormLoading });

type CalendarView = "season" | "month" | "week" | "day" | "custom";
type PlannerType = "training" | "competition" | "camp";
type StatusFilter = "all" | "upcoming" | "past" | "evaluation" | "completed";
type ParticipationFilter = "all" | "present" | "absent" | "expected" | "not_registered";
type AttendanceStatus = "expected" | "present" | "absent" | "excused" | "not_registered" | null;
type SessionRow = { id:string; start_at:string; location_text:string|null; session_type:"club"|"private"|"individual"; club_id:string|null; total_minutes:number|null; motivation:number|null; difficulty:number|null; satisfaction:number|null; club_event_id:string|null; player_camp_id?:string|null; player_camp_title?:string|null; player_camp_coach_name?:string|null };
type PlannedEventRow = { id:string; event_type:"training"|"interclub"|"camp"|"session"|"event"|"competition"|null; title:string|null; starts_at:string; ends_at:string|null; duration_minutes:number; location_text:string|null; club_id:string; group_id:string|null; status:"scheduled"|"cancelled"; requires_evaluation:boolean; competition_category?:"u10"|"u12"|"u14"|"u16"|"u18"|"all"|null; competition_note?:string|null };
type PersonalEventRow = { id:string; event_type:"competition"|"camp"; title:string; starts_at:string; ends_at:string; location_text:string|null; notes:string|null; status:"scheduled"|"cancelled" };
type CampRegistration = { campId:string; registered:boolean };
type ApiResponse = { completedSessionIds:string[]; viewerUserId:string; effectiveUserId:string; effectivePlayerName:string; performanceEnabled:boolean; sessions:SessionRow[]; attendeeEvents:PlannedEventRow[]; attendeeStatusByEventId:Record<string,AttendanceStatus>; campRegistrationByEventId:Record<string,CampRegistration>; attendanceChangeableEventIds:string[]; competitionEvents:PersonalEventRow[]; activeClubCount:number; clubNameById:Record<string,string>; groupNameById:Record<string,string> };
type Activity = { key:string; id:string; startsAt:string; endsAt:string; type:string; typeValue:string; title:string; organizer:string; location:string; attendance:AttendanceStatus; campRegistration?:CampRegistration; isFuture:boolean; isCompetition:boolean; needsEvaluation:boolean; optionalEvaluation:boolean; completed:boolean; detail:string|null; category:string|null; event?:PlannedEventRow; session?:SessionRow };

function addDays(d:Date,n:number){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function startDay(d:Date){return new Date(d.getFullYear(),d.getMonth(),d.getDate())}
function startWeek(d:Date){return addDays(startDay(d),-((d.getDay()+6)%7))}
function ymd(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function localDateTimeValue(date:Date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}T${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`}
function defaultPlannerStart(){const date=new Date();date.setDate(date.getDate()+1);date.setHours(18,0,0,0);return localDateTimeValue(date)}
function cap(s:string){return s.charAt(0).toUpperCase()+s.slice(1)}
function eventType(v:PlannedEventRow["event_type"],l:string){if(v==="training")return pickLocaleText(l,"Entraînement","Training");if(v==="interclub")return "Interclub";if(v==="camp")return pickLocaleText(l,"Stage","Camp");if(v==="session")return pickLocaleText(l,"Réunion","Session");if(v==="competition")return pickLocaleText(l,"Compétition","Competition");return pickLocaleText(l,"Événement","Event")}
function sessionType(v:SessionRow["session_type"],l:string){if(v==="private")return pickLocaleText(l,"Cours privé","Private lesson");if(v==="individual")return pickLocaleText(l,"Entraînement individuel","Individual training");return pickLocaleText(l,"Entraînement","Training")}
function participation(s:AttendanceStatus):ParticipationFilter{if(s==="absent"||s==="excused")return "absent";if(s==="not_registered")return "not_registered";if(s==="present")return "present";return "expected"}
function category(v:PlannedEventRow["competition_category"],l:string){if(!v)return pickLocaleText(l,"Catégorie non précisée","Category not specified");return v==="all"?pickLocaleText(l,"Toutes catégories","All categories"):v.toUpperCase()}
function dedupePlannedActivities(items:Activity[]){const unique=new Map<string,Activity>();items.forEach(item=>{const key=[item.typeValue,new Date(item.startsAt).getTime(),new Date(item.endsAt).getTime(),item.title.trim().toLocaleLowerCase(),item.location.trim().toLocaleLowerCase(),item.event?.club_id??""].join("|");const current=unique.get(key);if(!current||(!current.session&&item.session))unique.set(key,item)});return Array.from(unique.values())}

export default function PlayerActivitiesPage(){
  const {locale,t}=useI18n(); const searchParams=useSearchParams(); const tr=useCallback((fr:string,en:string)=>pickLocaleText(locale,fr,en),[locale]);
  const dateLocale=locale==="fr"?"fr-CH":locale==="de"?"de-CH":locale==="it"?"it-CH":"en-US";
  const [now]=useState(()=>Date.now()); const [loading,setLoading]=useRetainedLoading(); const [error,setError]=useState<string|null>(null);
  const [sessions,setSessions]=useState<SessionRow[]>([]); const [events,setEvents]=useState<PlannedEventRow[]>([]); const [personal,setPersonal]=useState<PersonalEventRow[]>([]);
  const [attendanceChangeableEventIds,setAttendanceChangeableEventIds]=useState<Set<string>>(new Set());
  const [attendance,setAttendance]=useState<Record<string,AttendanceStatus>>({}); const [clubs,setClubs]=useState<Record<string,string>>({}); const [groups,setGroups]=useState<Record<string,string>>({});
  const [campRegistrationByEventId,setCampRegistrationByEventId]=useState<Record<string,CampRegistration>>({});
  const [activeClubCount,setActiveClubCount]=useState(0);
  const [completeIds,setCompleteIds]=useState<Set<string>>(new Set()); const [performance,setPerformance]=useState(false); const [playerId,setPlayerId]=useState("");
  const [busyId,setBusyId]=useState(""); const {period:view,setPeriod:setView,from:customFrom,setFrom:setCustomFrom,to:customTo,setTo:setCustomTo}=useRememberedPeriod<CalendarView>("player:calendar","month",["season","month","week","day","custom"]); const [typeFilter,setTypeFilter]=useState("all"); const [statusFilter,setStatusFilter]=useState<StatusFilter>(searchParams.get("view")==="evaluations"?"evaluation":"all"); const [participationFilter,setParticipationFilter]=useState<ParticipationFilter>("all"); const [anchor,setAnchor]=useState(()=>new Date()); const [expanded,setExpanded]=useState<string|null>(null);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [selectedDay,setSelectedDay]=useState<string|null>(null);
  const [plannerType,setPlannerType]=useState<PlannerType|null>(()=>{const plan=searchParams.get("plan");return plan==="training"||plan==="competition"||plan==="camp"?plan:null});const [plannerTitle,setPlannerTitle]=useState("");const [plannerLocation,setPlannerLocation]=useState("");const [plannerNotes,setPlannerNotes]=useState("");const [plannerStart,setPlannerStart]=useState(defaultPlannerStart);const [plannerEnd,setPlannerEnd]=useState(()=>{const date=new Date(defaultPlannerStart());date.setHours(date.getHours()+2);return localDateTimeValue(date)});const [plannerBusy,setPlannerBusy]=useState(false);const [reloadKey,setReloadKey]=useState(0);

  useEffect(()=>{const onQuickAdd=(event:Event)=>{const type=(event as CustomEvent<{type?:string}>).detail?.type;if(type!=="competition"&&type!=="camp")return;setPlannerType(type);requestAnimationFrame(()=>document.getElementById("personal-planning-title")?.scrollIntoView({block:"start"}))};window.addEventListener("player:open-personal-planner",onQuickAdd);return()=>window.removeEventListener("player:open-personal-planner",onQuickAdd)},[]);

  const selectedChildId=String(searchParams.get("child_id")??"").trim();
  useEffect(()=>{let cancelled=false;void(async()=>{setLoading(true);setError(null);try{
    const {data:auth}=await supabase.auth.getSession();const token=auth.session?.access_token??"";
    const json=await loadPlayerCalendar<ApiResponse>({token,explicitChildId:selectedChildId,
      storedChildId:window.localStorage.getItem("parent:selected_child_id")??"",fetcher:fetch,
      forgetStoredChild:()=>window.localStorage.removeItem("parent:selected_child_id")});
    if(cancelled)return;
    if(json.viewerUserId!==json.effectiveUserId)window.localStorage.setItem("parent:selected_child_id",json.effectiveUserId);
    else if(!selectedChildId)window.localStorage.removeItem("parent:selected_child_id");
    const loaded=json.sessions??[];const done=new Set(json.completedSessionIds??[]);
    setSessions(loaded);setEvents(json.attendeeEvents??[]);setPersonal(json.competitionEvents??[]);setAttendance(json.attendeeStatusByEventId??{});setCampRegistrationByEventId(json.campRegistrationByEventId??{});setAttendanceChangeableEventIds(new Set(json.attendanceChangeableEventIds??[]));setClubs(json.clubNameById??{});setGroups(json.groupNameById??{});setActiveClubCount(Number(json.activeClubCount??0));setCompleteIds(done);setPerformance(Boolean(json.performanceEnabled));setPlayerId(json.effectiveUserId??"");
  }catch(e){if(!cancelled)setError(e instanceof Error?e.message:"Unable to load calendar")}finally{if(!cancelled)setLoading(false)}})();return()=>{cancelled=true}},[reloadKey,selectedChildId,setLoading]);

  const activities=useMemo<Activity[]>(()=>{
    const byEvent=new Map<string,SessionRow>();sessions.forEach(s=>{if(s.club_event_id&&!byEvent.has(s.club_event_id))byEvent.set(s.club_event_id,s)});
    const planned=dedupePlannedActivities(events.filter(e=>e.status==="scheduled").map(e=>{const s=byEvent.get(e.id);const att=e.event_type==="camp"&&campRegistrationByEventId[e.id]?.registered===false?"not_registered":attendance[e.id]??null;const end=e.ends_at??new Date(new Date(e.starts_at).getTime()+Math.max(1,e.duration_minutes)*60000).toISOString();const future=new Date(end).getTime()>=now;const done=Boolean(s&&completeIds.has(s.id));const type=eventType(e.event_type,locale);const group=e.group_id?groups[e.group_id]:"";const club=clubs[e.club_id]??tr("Club","Club");const organizer=group?(activeClubCount>1?`${club} · ${group}`:group):(activeClubCount>1?club:"");return{key:`event-${e.id}`,id:e.id,startsAt:e.starts_at,endsAt:end,type,typeValue:e.event_type??"event",title:e.title?.trim()||(group?`${type} · ${group}`:type),organizer,location:e.location_text?.trim()||tr("Lieu non renseigné","Location not specified"),attendance:att,campRegistration:campRegistrationByEventId[e.id],isFuture:future,isCompetition:e.event_type==="competition"||e.event_type==="interclub",...playerTrainingEvaluationState({performanceEnabled:performance,isPast:!future,completed:done,eventType:e.event_type??"event",requiresEvaluation:e.requires_evaluation,attendance:att}),detail:e.competition_note?.trim()||null,category:e.event_type==="competition"?category(e.competition_category,locale):null,event:e,session:s} as Activity}));
    const standalone=sessions.filter(s=>!s.club_event_id).map(s=>{const future=new Date(s.start_at).getTime()>=now;const done=completeIds.has(s.id);const type=s.player_camp_id?tr("Stage","Camp"):sessionType(s.session_type,locale);const coach=s.player_camp_coach_name?.trim()??"";const organizer=coach||(s.club_id?(activeClubCount>1?clubs[s.club_id]??tr("Club","Club"):""):tr("Activité personnelle","Personal activity"));return{key:`session-${s.id}`,id:s.id,startsAt:s.start_at,endsAt:new Date(new Date(s.start_at).getTime()+Math.max(1,Number(s.total_minutes??60))*60000).toISOString(),type,typeValue:s.player_camp_id?"camp":s.session_type,title:s.player_camp_title?.trim()||type,organizer,location:s.location_text?.trim()||tr("Lieu non renseigné","Location not specified"),attendance:null,isFuture:future,isCompetition:false,...playerTrainingEvaluationState({performanceEnabled:performance,isPast:!future,completed:done}),detail:null,category:null,session:s}});
    const own=personal.filter(e=>e.status==="scheduled").map(e=>{const future=new Date(e.ends_at||e.starts_at).getTime()>=now;return{key:`personal-${e.id}`,id:e.id,startsAt:e.starts_at,endsAt:e.ends_at,type:e.event_type==="camp"?tr("Stage","Camp"):tr("Compétition","Competition"),typeValue:e.event_type,title:e.title,organizer:tr("Activité personnelle","Personal activity"),location:e.location_text?.trim()||tr("Lieu non renseigné","Location not specified"),attendance:null,isFuture:future,isCompetition:e.event_type==="competition",needsEvaluation:false,optionalEvaluation:false,completed:!future,detail:e.notes?.trim()||null,category:null}});
    return [...planned,...standalone,...own].sort((a,b)=>new Date(a.startsAt).getTime()-new Date(b.startsAt).getTime()) as Activity[];
  },[activeClubCount,attendance,campRegistrationByEventId,clubs,completeIds,events,groups,locale,now,performance,personal,sessions,tr]);

  const visible=useMemo(()=>{const from=view==="custom"?new Date(`${customFrom || "0001-01-01"}T00:00:00`):view==="season"?new Date(anchor.getFullYear(),0,1):view==="month"?new Date(anchor.getFullYear(),anchor.getMonth(),1):view==="week"?startWeek(anchor):startDay(anchor);const to=view==="custom"?new Date(`${customTo || "9999-12-31"}T23:59:59`):view==="season"?new Date(anchor.getFullYear()+1,0,1):view==="month"?new Date(anchor.getFullYear(),anchor.getMonth()+1,1):view==="week"?addDays(from,7):addDays(from,1);return activities.filter(a=>{const t=new Date(a.startsAt).getTime();if(t<from.getTime()||t>=to.getTime())return false;if(typeFilter!=="all"&&a.typeValue!==typeFilter)return false;if(statusFilter==="upcoming"&&!a.isFuture)return false;if(statusFilter==="past"&&a.isFuture)return false;if(statusFilter==="evaluation"&&!a.needsEvaluation)return false;if(statusFilter==="completed"&&!a.completed)return false;if(participationFilter!=="all"&&participation(a.attendance)!==participationFilter)return false;return true})},[activities,anchor,participationFilter,statusFilter,typeFilter,view,customFrom,customTo]);
  const byDay=useMemo(()=>visible.reduce<Record<string,Activity[]>>((r,a)=>{(r[ymd(new Date(a.startsAt))]??=[]).push(a);return r},{}),[visible]);
  const periodLabel=useMemo(()=>{if(view==="custom")return `${customFrom || "…"} – ${customTo || "…"}`;if(view==="season")return String(anchor.getFullYear());if(view==="month")return cap(new Intl.DateTimeFormat(dateLocale,{month:"long",year:"numeric"}).format(anchor));if(view==="week"){const s=startWeek(anchor),e=addDays(s,6);return `${new Intl.DateTimeFormat(dateLocale,{day:"numeric",month:"short"}).format(s)} – ${new Intl.DateTimeFormat(dateLocale,{day:"numeric",month:"short",year:"numeric"}).format(e)}`}return cap(new Intl.DateTimeFormat(dateLocale,{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(anchor))},[anchor,dateLocale,view,customFrom,customTo]);
  function move(n:-1|1){if(view==="season")setAnchor(d=>new Date(d.getFullYear()+n,0,1));else if(view==="month")setAnchor(d=>new Date(d.getFullYear(),d.getMonth()+n,1));else if(view!=="custom")setAnchor(d=>addDays(d,n*(view==="week"?7:1)))}
  function changeView(next:CalendarView){setView(next);if(next==="season")setStatusFilter("all")}
  async function updateAttendance(e:PlannedEventRow,next:"present"|"absent"){
    if(!playerId||busyId)return;
    setBusyId(e.id);setError(null);
    try{
      const result=await savePlayerAttendance(playerId,e.id,next, locale);
      setAttendance(current=>({...current,[e.id]:result.status}));
      if(result.notificationWarning)setError(tr("Présence enregistrée, mais la notification au coach n’a pas pu être envoyée.","Attendance saved, but the coach notification could not be sent."));
    }catch(cause){
      if(cause instanceof Error && "status" in cause && cause.status===409)setAttendanceChangeableEventIds(current=>{const nextIds=new Set(current);nextIds.delete(e.id);return nextIds});
      setError(cause instanceof Error?cause.message:tr("Impossible de modifier la présence.","Unable to update attendance."));
    }finally{setBusyId("")}
  }
  function toggle(a:Activity){
    if(!a.event)return;
    const next=participation(a.attendance)==="absent"?"present":"absent";
    if(window.confirm(next==="absent"?tr("Confirmer votre absence ?","Confirm your absence?"):tr("Confirmer votre présence ?","Confirm your attendance?")))void updateAttendance(a.event,next);
  }
  function openPlanner(type:PlannerType){const start=defaultPlannerStart();const end=new Date(start);end.setHours(end.getHours()+2);setPlannerType(current=>current===type?null:type);setPlannerTitle("");setPlannerLocation("");setPlannerNotes("");setPlannerStart(start);setPlannerEnd(localDateTimeValue(end));setError(null)}
  async function savePersonalActivity(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(!plannerType||plannerType==="training"||plannerBusy)return;if(!playerId){setError(tr("Session invalide.","Invalid session."));return}const startsAt=new Date(plannerStart);const endsAt=new Date(plannerEnd);const title=plannerTitle.trim();if(Number.isNaN(startsAt.getTime())){setError(tr("Date et heure invalides.","Invalid date and time."));return}if(!title){setError(plannerType==="camp"?tr("Le nom du stage est requis.","Camp title is required."):tr("Le nom de la compétition est requis.","Competition title is required."));return}if(Number.isNaN(endsAt.getTime())||endsAt<=startsAt){setError(tr("La fin doit être postérieure au début.","The end must be after the start."));return}setPlannerBusy(true);setError(null);const result=await supabase.from("player_activity_events").insert({organization_id:null,user_id:playerId,event_type:plannerType,title,starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),location_text:plannerLocation.trim()||null,notes:plannerNotes.trim()||null,status:"scheduled"}).select("id,event_type,title,starts_at,ends_at,location_text,notes,status").single();if(result.error){setError(result.error.message);setPlannerBusy(false);return}setPersonal(current=>[result.data as PersonalEventRow,...current]);invalidateClientPageCacheByPrefix("page-cache:player-home:");invalidateClientPageCacheByPrefix("page-cache:player-trainings:");setAnchor(startsAt);setStatusFilter(startsAt.getTime()>=Date.now()?"upcoming":"all");setPlannerType(null);setPlannerBusy(false)}

  return <div className={`player-dashboard-bg ${styles.page}`}><div className={`app-shell ${styles.shell}`}>
    <PlayerBreadcrumb items={[{label:"Player",href:"/player"},{label:t("nav.calendar")}]} />
    <header className={playerUiStyles.topline}><div><h1>{t("nav.calendar")}</h1><p className={playerUiStyles.lead}>{tr("Retrouvez votre programme, confirmez vos présences et complétez vos évaluations.","Review your schedule, confirm attendance and complete your evaluations.")}</p></div></header>
    <CalendarSubscriptionButton kind="player" playerId={playerId} disabled={loading || Boolean(error) || !playerId}/>
    {error?<div className={styles.error} role="alert">{error}</div>:null}
    {plannerType?<section id="personal-planning-title" className={styles.plannerSection} aria-labelledby="personal-planner-heading"><div className={`${styles.plannerPanel} ${plannerType==="training"?styles.trainingPlannerPanel:""}`}><div className={styles.plannerPanelHeading}><div><span>{plannerType==="training"?tr("Entraînement personnel","Personal training"):plannerType==="competition"?tr("Compétition personnelle","Personal competition"):tr("Stage personnel","Personal camp")}</span><h3 id="personal-planner-heading">{plannerType==="training"?tr("Ajouter ou planifier un entraînement","Add or schedule a training"):plannerType==="competition"?tr("Planifier une compétition","Schedule a competition"):tr("Planifier un stage","Schedule a camp")}</h3></div><button type="button" onClick={()=>setPlannerType(null)} aria-label={tr("Fermer le formulaire","Close form")}><X size={17}/></button></div>{plannerType==="training"?<div className={styles.embeddedTrainingForm}><PlayerTrainingNewClient embedded embeddedSubmitClassName={styles.saveButton} embeddedSubmitLabel={tr("Ajouter au calendrier","Add to calendar")} onSaved={()=>{setPlannerType(null);setReloadKey(current=>current+1)}}/></div>:<form className={styles.plannerForm} onSubmit={savePersonalActivity}>
      <label className={styles.wideField}><span>{plannerType==="camp"?tr("Nom du stage","Camp name"):tr("Nom de la compétition","Competition name")}</span><input value={plannerTitle} onChange={e=>setPlannerTitle(e.target.value)} required placeholder={plannerType==="camp"?tr("Stage de printemps","Spring camp"):tr("Championnat du club","Club championship")}/></label>
      <label><span>{tr("Début","Start")}</span><input type="datetime-local" value={plannerStart} onChange={e=>{setPlannerStart(e.target.value);const next=new Date(e.target.value);if(!Number.isNaN(next.getTime())){next.setHours(next.getHours()+2);setPlannerEnd(localDateTimeValue(next))}}} required/></label>
      <label><span>{tr("Fin","End")}</span><input type="datetime-local" value={plannerEnd} onChange={e=>setPlannerEnd(e.target.value)} required/></label>
      <label className={styles.wideField}><span>{tr("Lieu","Location")}</span><input value={plannerLocation} onChange={e=>setPlannerLocation(e.target.value)} placeholder={tr("Lieu de l’activité","Activity location")}/></label>
      <label className={styles.wideField}><span>{tr("Notes","Notes")}</span><textarea rows={3} value={plannerNotes} onChange={e=>setPlannerNotes(e.target.value)} placeholder={tr("Informations utiles…","Useful information…")}/></label>
      <div className={styles.plannerActions}><button type="button" className={styles.cancelButton} onClick={()=>setPlannerType(null)} disabled={plannerBusy}>{tr("Annuler","Cancel")}</button><button type="submit" className={styles.saveButton} disabled={plannerBusy}>{plannerBusy?tr("Enregistrement…","Saving…"):tr("Ajouter au calendrier","Add to calendar")}</button></div>
    </form>}</div></section>:null}
    <section id="activities-calendar" className={styles.calendarSection}><div className={styles.controls}>
      <div className={styles.controlsHeading}><h2>{tr("Calendrier des activités","Activity calendar")}</h2><div className={styles.filterActions}><button type="button" className={styles.secondaryButton} aria-expanded={filtersOpen} aria-controls="player-calendar-filters" onClick={()=>setFiltersOpen(open=>!open)}><SlidersHorizontal size={16} aria-hidden="true"/>{pickLocaleText(locale,"Filtrer","Filter","Filtern","Filtra")}</button><AddActivityDropdown onPlan={type=>{openPlanner(type);requestAnimationFrame(()=>document.getElementById("personal-planning-title")?.scrollIntoView({block:"center"}))}}/></div></div>
      {filtersOpen?<div id="player-calendar-filters" className={styles.filters}><Select label={tr("Type d’activité","Activity type")} value={typeFilter} onChange={setTypeFilter} options={[["all",tr("Tous les types","All types")],["training",tr("Entraînement","Training")],["club",tr("Entraînement club","Club training")],["individual",tr("Individuel","Individual")],["private",tr("Cours privé","Private lesson")],["competition",tr("Compétition","Competition")],["interclub","Interclub"],["camp",tr("Stage","Camp")],["session",tr("Réunion","Session")],["event",tr("Événement","Event")]]}/><Select label={tr("Statut","Status")} value={statusFilter} onChange={v=>setStatusFilter(v as StatusFilter)} options={[["all",tr("Tous les statuts","All statuses")],["upcoming",tr("À venir","Upcoming")],["past",tr("Passées","Past")],["evaluation",tr("À évaluer","To evaluate")],["completed",tr("Terminées","Completed")]]}/><Select label={tr("Participation","Participation")} value={participationFilter} onChange={v=>setParticipationFilter(v as ParticipationFilter)} options={[["all",tr("Toutes","All")],["present",tr("Présent","Present")],["absent",tr("Absent / excusé","Absent / excused")],["expected",tr("À confirmer","To confirm")],["not_registered",pickLocaleText(locale,"Non inscrit","Not registered","Nicht angemeldet","Non iscritto")]]}/></div>:null}

    </div><div className={`${styles.agendaPanel} ${view==="season"?styles.seasonPanel:""}`}><div className={styles.calendarToolbar}>      <div className={styles.controlFooter}><div className={styles.viewSwitch}>{(["season","month","week","day","custom"] as CalendarView[]).map(v=><button key={v} type="button" className={view===v?styles.active:""} onClick={()=>changeView(v)}>{v==="season"?tr("Saison","Season"):v==="month"?tr("Mois","Month"):v==="week"?tr("Semaine","Week"):v==="day"?tr("Jour","Day"):t("common.custom")}</button>)}</div><div className={styles.periodNav}>{view!=="custom"?<><button type="button" onClick={()=>move(-1)} aria-label={tr("Période précédente","Previous period")}><ChevronLeft size={17}/></button><button type="button" onClick={()=>setAnchor(new Date())}>{tr("Aujourd’hui","Today")}</button><button type="button" onClick={()=>move(1)} aria-label={tr("Période suivante","Next period")}><ChevronRight size={17}/></button></>:null}</div></div>
      {view==="custom"?<div className={styles.filters}><label>{pickLocaleText(locale,"Du","From","Von","Dal")}<input type="date" value={customFrom} max={customTo||undefined} onChange={e=>setCustomFrom(e.target.value)}/></label><label>{pickLocaleText(locale,"Au","To","Bis","Al")}<input type="date" value={customTo} min={customFrom||undefined} onChange={e=>setCustomTo(e.target.value)}/></label></div>:null}<div className={styles.agendaHeading}><h2>{periodLabel}</h2></div></div>{loading?<CalendarLoadingSkeleton label={tr("Chargement des activités…","Loading activities…")}/>:view==="season"?<SeasonOverview activities={visible} year={anchor.getFullYear()} dateLocale={dateLocale} onSelectDay={setSelectedDay}/>:Object.keys(byDay).length===0?<div className={styles.empty}><CalendarDays size={22}/><strong>{tr("Aucune activité sur cette période","No activity in this period")}</strong><span>{tr("Modifiez les filtres ou consultez une autre période.","Change the filters or browse another period.")}</span></div>:<div className={styles.agenda}>{Object.entries(byDay).map(([day,items])=><ActivityDay key={day} items={items} locale={locale} dateLocale={dateLocale} playerId={playerId} busyId={busyId} attendanceChangeableEventIds={attendanceChangeableEventIds} expanded={expanded} setExpanded={setExpanded} toggle={toggle}/>)}</div>}{!loading?<div className={styles.iconLegend} aria-label={tr("Légende des actions","Action legend")}><span><i className={styles.legendView}><Eye size={14}/></i>{tr("Consulter","View")}</span><span><i className={styles.legendRequired}><ClipboardCheck size={15}/></i>{tr("Évaluation requise","Required evaluation")}</span><span><i className={styles.legendOptional}><ClipboardCheck size={15}/></i>{tr("Évaluation facultative","Optional evaluation")}</span></div>:null}</div></section>
  </div>{selectedDay && byDay[selectedDay]?.length ? <AccessibleDialog portal onClose={()=>setSelectedDay(null)} labelledBy="season-day-title" className={styles.dayDialog}>
      <header className={styles.dayDialogHeader}><h2 id="season-day-title">{cap(new Intl.DateTimeFormat(dateLocale,{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date(`${selectedDay}T12:00:00`)))}</h2><button type="button" onClick={()=>setSelectedDay(null)} aria-label={t("common.close")}><X size={20}/></button></header>
      <div className={styles.dayDialogActivities}><ActivityDay inDialog items={byDay[selectedDay]} locale={locale} dateLocale={dateLocale} playerId={playerId} busyId={busyId} attendanceChangeableEventIds={attendanceChangeableEventIds} expanded={expanded} setExpanded={setExpanded} toggle={toggle}/></div>
    </AccessibleDialog>:null}</div>
}

function AddActivityDropdown({onPlan}:{onPlan:(type:"competition"|"camp")=>void}){
  const {locale,t}=useI18n();
  const [open,setOpen]=useState(false);
  const rootRef=useRef<HTMLDivElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const label=pickLocaleText(locale,"Ajouter une activité","Add an activity","Aktivität hinzufügen","Aggiungi un’attività");
  useEffect(()=>{
    if(!open)return;
    const onPointerDown=(event:PointerEvent)=>{if(!rootRef.current?.contains(event.target as Node))setOpen(false)};
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);triggerRef.current?.focus()}};
    document.addEventListener("pointerdown",onPointerDown);
    document.addEventListener("keydown",onKeyDown);
    return()=>{document.removeEventListener("pointerdown",onPointerDown);document.removeEventListener("keydown",onKeyDown)};
  },[open]);
  return <div className={styles.addActivity} ref={rootRef} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false)}}>
    <button ref={triggerRef} type="button" className={styles.addActivityButton} aria-expanded={open} aria-controls="calendar-add-activity" onClick={()=>setOpen(current=>!current)}><Plus size={18} aria-hidden="true"/>{label}<ChevronDown size={15} aria-hidden="true"/></button>
    {open?<div id="calendar-add-activity" className={styles.addActivityMenu} role="group" aria-label={label}>
      <Link href="/player/golf/trainings/new?session_type=individual" onClick={()=>setOpen(false)}><Plus size={25} aria-hidden="true"/>{t("player.quickAddIndividualTraining")}</Link>
      <Link href="/player/golf/rounds/new" onClick={()=>setOpen(false)}><Plus size={25} aria-hidden="true"/>{t("player.quickAddTrainingRound")}</Link>
      <button type="button" onClick={()=>{setOpen(false);onPlan("camp")}}><Plus size={25} aria-hidden="true"/>{t("player.quickAddCamp")}</button>
    </div>:null}
  </div>
}
function CalendarLoadingSkeleton({label}:{label:string}){return <div className={styles.calendarSkeleton} aria-live="polite" aria-busy="true" aria-label={label}>{Array.from({length:3},(_,index)=><div className={styles.calendarSkeletonRow} key={index}><span className={styles.calendarSkeletonDate}/><div><span/><span/><span/></div><span className={styles.calendarSkeletonAction}/></div>)}</div>}
function Select({label,value,onChange,options}:{label:string;value:string;onChange:(v:string)=>void;options:string[][]}){return <label><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}>{options.map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></label>}
function schedule(a:string,b:string,l:string){const x=new Date(a),y=new Date(b);const time=(d:Date)=>new Intl.DateTimeFormat(l,{hour:"2-digit",minute:"2-digit"}).format(d);return ymd(x)===ymd(y)?`${time(x)} – ${time(y)}`:`${new Intl.DateTimeFormat(l,{day:"numeric",month:"short"}).format(x)} – ${new Intl.DateTimeFormat(l,{day:"numeric",month:"short"}).format(y)}`}
function SeasonOverview({activities,year,dateLocale,onSelectDay}:{activities:Activity[];year:number;dateLocale:string;onSelectDay:(day:string)=>void}){const weekdays=Array.from({length:7},(_,index)=>new Intl.DateTimeFormat(dateLocale,{weekday:"narrow"}).format(addDays(new Date(2024,0,1),index)));return <div className={styles.seasonMonths}>{Array.from({length:12},(_,month)=>{const monthActivities=activities.filter(a=>{const date=new Date(a.startsAt);return date.getFullYear()===year&&date.getMonth()===month});const byDate=monthActivities.reduce<Record<number,Activity[]>>((result,item)=>{const day=new Date(item.startsAt).getDate();(result[day]??=[]).push(item);return result},{});const offset=(new Date(year,month,1).getDay()+6)%7;const daysInMonth=new Date(year,month+1,0).getDate();return <section key={month} className={styles.seasonMonth}><h3>{cap(new Intl.DateTimeFormat(dateLocale,{month:"long"}).format(new Date(year,month,1)))}</h3><div className={styles.seasonWeekdays}>{weekdays.map((day,index)=><span key={`${day}-${index}`}>{day}</span>)}</div><div className={styles.seasonGrid}>{Array.from({length:daysInMonth},(_,index)=>{const day=index+1;const items=byDate[day]??[];const position=offset+index;const types=Array.from(new Set(items.map(item=>item.type)));return <button type="button" disabled={!items.length} aria-haspopup={items.length?"dialog":undefined} aria-label={`${new Intl.DateTimeFormat(dateLocale,{dateStyle:"full"}).format(new Date(year,month,day))} · ${items.map(item=>item.type).join(", ")}`} onClick={()=>onSelectDay(ymd(new Date(year,month,day)))} key={day} className={`${styles.seasonActivity} ${items.length===0?styles.seasonEmptyDay:""}`} style={{gridColumn:position%7+1,gridRow:Math.floor(position/7)+1}}><span className={styles.seasonDate}><b>{day}</b></span>{types.length?<div>{types.map(type=><span key={type}>{type}</span>)}</div>:null}</button>})}</div></section>})}</div>}
function ActivityDay({inDialog=false,items,locale,dateLocale,playerId,busyId,attendanceChangeableEventIds,expanded,setExpanded,toggle}:{inDialog?:boolean;items:Activity[];locale:string;dateLocale:string;playerId:string;busyId:string;attendanceChangeableEventIds:Set<string>;expanded:string|null;setExpanded:(v:string|null)=>void;toggle:(a:Activity)=>void}){
  const tr=(fr:string,en:string,de?:string)=>pickLocaleText(locale,fr,en,de);
  return <>{items.map(a=>{
    const detailHref=a.session?`/player/golf/trainings/${a.session.id}`:null;
    const evalHref=a.session?`/player/golf/trainings/${a.session.id}/edit`:a.event?.event_type==="training"?`/player/golf/trainings/new?club_event_id=${a.event.id}`:null;
    const campHref=a.campRegistration?`/player/camps?${new URLSearchParams({camp_id:a.campRegistration.campId,...(playerId?{child_id:playerId}:{})})}`:null;
    const eventDetailHref=a.event?(campHref??(a.event.event_type==="competition"||a.event.event_type==="interclub"?`/player/golf/competitions/${a.event.id}`:`/player/golf/trainings/new?club_event_id=${a.event.id}&mode=view`)):null;
    const consultHref=detailHref??eventDetailHref;
    const activityHref=inDialog?consultHref:a.needsEvaluation||a.optionalEvaluation?evalHref:consultHref;
    const open=expanded===a.key;
    const activityDate=new Date(a.startsAt);
    const dateDay=new Intl.DateTimeFormat(dateLocale,{weekday:"short"}).format(activityDate).replace(".","");
    const dateMonth=new Intl.DateTimeFormat(dateLocale,{month:"short"}).format(activityDate).replace(".","");
    const activityTime=new Intl.DateTimeFormat(dateLocale,{hour:"2-digit",minute:"2-digit"}).format(activityDate);
    const activityDetail=
      a.typeValue==="camp"&&a.title.trim()&&a.title.trim()!==a.type.trim()
        ? a.title.trim()
        : a.event?.event_type==="session"&&a.title.trim()
          ? a.title.trim()
          : a.organizer;
    const isAbsent=participation(a.attendance)==="absent";
    const showRegistration=Boolean(a.isFuture&&campHref&&a.campRegistration&&!a.campRegistration.registered);
    const showAttendance=Boolean(a.event&&!a.isCompetition&&!showRegistration&&(a.isFuture||attendanceChangeableEventIds.has(a.event.id)));
    return <article key={a.key} className={`${dashboardStyles.activityItem} ${styles.dashboardActivity}`}>
      <div className={dashboardStyles.activityDate} aria-label={new Intl.DateTimeFormat(dateLocale,{dateStyle:"full",timeStyle:"short"}).format(activityDate)}>
        <span>{dateDay}</span><b>{activityDate.getDate()}</b><span>{dateMonth}</span><time dateTime={a.startsAt}>{activityTime}</time>
      </div>
      <div className={dashboardStyles.activityBody}>
        {activityHref?<Link className={dashboardStyles.activityTitle} href={activityHref}>{a.type}</Link>:<span className={dashboardStyles.activityTitle}>{a.type}</span>}
        {activityDetail?<span className={dashboardStyles.activityMeta}>{activityDetail}</span>:null}
        <span className={`planning-event-location ${dashboardStyles.activityLocation}`}><MapPin size={14} aria-hidden="true"/><span>{a.location}</span></span>
      </div>
      <div className={styles.activityAction}>
        {inDialog ? (consultHref ? <Link className={styles.activityIconAction} href={consultHref} aria-label={tr(`Voir ${a.title}`,`View ${a.title}`)}><Eye size={17}/></Link> : <button type="button" className={styles.textButton} aria-expanded={open} onClick={()=>setExpanded(open?null:a.key)}>{tr("Détails","Details")}<ArrowRight size={14}/></button>) : <>
        {showRegistration&&campHref?<Link className={styles.primaryButton} href={campHref}>{tr("S’inscrire","Register","Anmelden")}</Link>:null}
        {showAttendance?<AttendanceToggle variant="pill" checked={!isAbsent} onToggle={()=>toggle(a)} disabled={busyId===a.id} disabledCursor="wait" ariaLabel={tr(`Présence pour ${a.title}`,`Attendance for ${a.title}`,`Anwesenheit für ${a.title}`)} leftLabel={tr("Absent","Absent")} rightLabel={tr("Présent","Present")}/>:null}
        {(!showAttendance||!a.isFuture)?<>
        {a.isFuture&&a.isCompetition?<><span className={`${styles.status} ${styles.upcoming}`}>{tr("À venir","Upcoming")}</span><button type="button" className={styles.textButton} onClick={()=>setExpanded(open?null:a.key)}>{tr("Détails","Details")}<ArrowRight size={14}/></button></>:null}
        {a.needsEvaluation&&evalHref?<Link className={`${styles.activityIconAction} ${styles.evaluationIconAction}`} href={evalHref} aria-label={tr(`Évaluer ${a.title}`,`Evaluate ${a.title}`,`${a.title} bewerten`)} title={tr("À évaluer","To evaluate")}><ClipboardCheck size={17}/></Link>:null}
        {a.optionalEvaluation&&evalHref?<Link className={`${styles.activityIconAction} ${styles.optionalEvaluationIconAction}`} href={evalHref} aria-label={tr(`Évaluer facultativement ${a.title}`,`Optionally evaluate ${a.title}`,`${a.title} freiwillig bewerten`)} title={tr("Évaluation facultative","Optional evaluation")}><ClipboardCheck size={17}/></Link>:null}
        {!a.needsEvaluation&&!a.optionalEvaluation&&!a.isFuture&&consultHref?<Link className={styles.activityIconAction} href={consultHref} aria-label={tr(`Voir ${a.title}`,`View ${a.title}`,`${a.title} ansehen`)} title={tr("Voir l’activité","View activity")}><Eye size={15}/></Link>:null}
        {a.isFuture&&!a.event&&!a.isCompetition&&detailHref?<Link className={styles.textButton} href={detailHref}>{tr("Détails","Details")}<ArrowRight size={14}/></Link>:null}
        </>:null}</>}
      </div>
      {open?<div className={styles.inlineDetail}>{a.category?<span><strong>{tr("Catégorie","Category")}</strong>{a.category}</span>:null}<span><strong>{tr("Horaire","Schedule")}</strong>{schedule(a.startsAt,a.endsAt,dateLocale)}</span><span><strong>{tr("Lieu","Location")}</strong>{a.location}</span>{a.detail?<p>{a.detail}</p>:null}</div>:null}
    </article>;
  })}</>;
}
