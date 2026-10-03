"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, CirclePower, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { supabase } from "@/lib/supabaseClient";
import { omText, omDate, omError, omStandardGroup, type OmGroup, type OmKind, type OmRecord } from "@/lib/managerOrderOfMerit";
import ManagerClubSelect from "./ManagerClubSelect";
import { useManagerClubSelection } from "./useManagerClubSelection";
import { useManagerOmMutation } from "./useManagerOmMutation";
import styles from "@/app/manager/om/OrderOfMerit.module.css";

type Catalog = { scope: string; rows: OmRecord[]; groups: OmGroup[] };
export default function ManagerOmCatalog({ kind }: { kind: OmKind }) {
 const { t,locale }=useI18n(),club=useManagerClubSelection();
 const tr=(key:string,params?:Record<string,string|number>)=>omText(t,key,params);
 const scope=`${kind}:${club.clubId}`,contest=kind==="contest";
 const [catalog,setCatalog]=useState<Catalog|null>(null),[loading,setLoading]=useState(false),[loadError,setLoadError]=useState("");
 const [formOpen,setFormOpen]=useState(false),[name,setName]=useState(""),[description,setDescription]=useState(""),[date,setDate]=useState(""),[end,setEnd]=useState(""),[group,setGroup]=useState("");
 const [success,setSuccess]=useState(false),[validation,setValidation]=useState("");
 const generation=useRef(0);
 const reset=useCallback(()=>{setName("");setDescription("");setDate(contest?new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Zurich"}).format(new Date()):"");setEnd("");setGroup("");setFormOpen(false);setValidation("");},[contest]);
 const load=useCallback(async()=>{
  const token=++generation.current;setCatalog(null);setLoadError("");
  if(!club.clubId){setLoading(false);return;}
  setLoading(true);
  try{
   const {data,error}=await supabase.rpc("get_manager_om_data_v1",{p_club_id:club.clubId,p_kind:kind});
   if(error)throw error;
   if(data?.club_id!==club.clubId||!Array.isArray(data.rows)||!Array.isArray(data.groups)||data.rows.some((r:OmRecord)=>r.organization_id!==club.clubId||!r.id||!r.version))throw new Error("invalid_response");
   if(token===generation.current)setCatalog({scope,rows:data.rows,groups:data.groups});
  }catch(cause){if(token===generation.current){const failure=omError(cause);setLoadError(failure.definite?failure.key:"load");}throw cause;}
  finally{if(token===generation.current)setLoading(false);}
 },[club.clubId,kind,scope]);
 useEffect(()=>{reset();setSuccess(false);void load().catch(()=>{});const counter=generation;return()=>{counter.current++;};},[load,reset]);
 const mutation=useManagerOmMutation(scope,async receipt=>{setSuccess(true);if(receipt.action==="create")reset();await load();});
 const ready=catalog?.scope===scope&&!club.loading&&!club.error;
 const rows=ready?catalog.rows:[],groups=ready?catalog.groups:[],standard=groups.filter(omStandardGroup);
 const locked=mutation.locked||!ready||loading;
 const message=validation||mutation.error||loadError;
 const run=async(action:"create"|"delete"|"toggle",row?:OmRecord)=>{
  if(locked)return;
  if(action==="delete"&&!window.confirm(tr(`${kind}.confirmDelete`,{name:row?.title||row?.name||tr("unnamed")})))return;
  if(action==="create"&&(!name.trim()||(contest&&!date))){setValidation("invalid_fields");return;}
  if(action==="create"&&!contest&&date&&end&&date>end){setValidation("invalid_dates");return;}
  setSuccess(false);setValidation("");
  await mutation.run({club:club.clubId,kind,action,id:row?.id,expected:row?.version,payload:action==="create"?{name:name.trim(),description:description.trim(),...(contest?{date,group_id:group||null}:{starts_on:date||null,ends_on:end||null})}:action==="toggle"?{is_active:!row?.is_active}:{}});
 };
 const count=contest?rows.filter(r=>Array.isArray(r.full_ranking)&&r.full_ranking.length).length:rows.filter(r=>r.is_active).length;
 const stats:[string,number][]=[["total",rows.length],[contest?"publishedCount":"active",count],[contest?"pending":"inactive",rows.length-count],[contest?"groups":"dated",contest?standard.length:rows.filter(r=>r.starts_on||r.ends_on).length]];
 const reload=()=>{setValidation("");mutation.clearError();void load().catch(()=>{});};
 return <main className={styles.page}>
  <nav className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/manager">Manager</Link><ChevronRight size={13}/><Link href="/manager/om">{tr("title")}</Link><ChevronRight size={13}/><span>{tr(`${kind}.title`)}</span></nav>
  <div className={styles.topline}><div><h1>{tr(`${kind}.title`)}</h1><p className={styles.lead}>{tr(`${kind}.lead`)}</p></div><button type="button" className={styles.primary} disabled={locked} onClick={()=>setFormOpen(!formOpen)}><Plus size={16}/>{tr(`${kind}.new`)}</button></div>
  <ManagerClubSelect clubs={club.clubs} clubId={club.clubId} onChange={club.setClubId} disabled={mutation.locked}/>
  {club.error?<div role="alert" className={styles.alertError}>{club.error}</div>:null}
  {message?<div role="alert" className={styles.alertError}>{tr(`error.${message}`)}</div>:null}
  {success?<div role="status" className={styles.alertSuccess}>{tr("saved")}</div>:null}
  {mutation.uncertain?<button type="button" className={styles.secondary} disabled={mutation.busy} onClick={()=>void mutation.retry()}>{tr(mutation.busy?"saving":"verify")}</button>:null}
  <section className={styles.stats}>{stats.map(([key,value])=><div className={styles.stat} key={key}><span>{tr(key)}</span><b>{ready?value:"—"}</b></div>)}</section>
  {formOpen?<form className={styles.panel} onSubmit={event=>{event.preventDefault();void run("create");}}>
   <div className={styles.panelHeader}><div><h2>{tr(`${kind}.new`)}</h2><p>{tr(`${kind}.help`)}</p></div></div>
   <fieldset className={styles.formFields} disabled={locked}><div className={styles.grid2}>
    <label className={styles.field}><span>{tr("name")}</span><input required maxLength={500} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className={styles.field}><span>{tr("description")}</span><textarea maxLength={10000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <label className={styles.field}><span>{tr(contest?"date":"start")}</span><input type="date" required={contest} value={date} onChange={e=>setDate(e.target.value)}/></label>
    {contest?<label className={styles.field}><span>{tr("group")}</span><select value={group} onChange={e=>setGroup(e.target.value)}><option value="">{tr("allPlayers")}</option>{standard.map(g=><option key={g.id} value={g.id}>{g.name||tr("unnamed")}</option>)}</select></label>:<label className={styles.field}><span>{tr("end")}</span><input type="date" min={date||undefined} value={end} onChange={e=>setEnd(e.target.value)}/></label>}
   </div></fieldset>
   <div className={styles.actions}><button type="button" className={styles.secondary} disabled={mutation.locked} onClick={()=>setFormOpen(false)}>{tr("cancel")}</button><button type="submit" className={styles.primary} disabled={locked||!name.trim()||(contest&&!date)}>{tr(mutation.busy?"saving":`${kind}.create`)}</button></div>
  </form>:null}
  <section className={styles.panel}><div className={styles.panelHeader}><h2>{tr(`${kind}.title`)}</h2><button className={styles.secondary} type="button" disabled={mutation.locked||loading||!club.clubId} onClick={reload}>{tr("retry")}</button></div>
   {loading||club.loading?<ListLoadingBlock label={tr("loading")}/>:!ready?null:!rows.length?<div className={styles.empty}>{tr(`${kind}.empty`)}</div>:<div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr>{[contest?"date":"dates","name",...(contest?["group"]:[]),"status","actions"].map(k=><th key={k} scope="col">{tr(k)}</th>)}</tr></thead>
    <tbody>{rows.map(row=>{
     const title=row.title||row.name||tr("unnamed"),published=Array.isArray(row.full_ranking)&&row.full_ranking.length>0;
     const status=contest?(published?"published":"pending"):(row.is_active?"enabled":"disabled");
     const dates=contest?omDate(row.contest_date,locale,tr("undated")):row.ends_on&&row.ends_on!==row.starts_on?`${omDate(row.starts_on,locale,tr("undated"))} – ${omDate(row.ends_on,locale,tr("undated"))}`:omDate(row.starts_on||row.ends_on,locale,tr("undated"));
     return <tr key={row.id}><td data-label={tr(contest?"date":"dates")}>{dates}</td><td data-label={tr("name")}><div className={styles.titleCell}><b>{title}</b>{row.description?<span className={styles.muted}>{row.description}</span>:null}</div></td>{contest?<td data-label={tr("group")}>{row.group_id?groups.find(g=>g.id===row.group_id)?.name||tr("unnamed"):tr("allPlayers")}</td>:null}<td data-label={tr("status")}><span className={`${styles.badge} ${status==="pending"||status==="disabled"?styles.badgeMuted:""}`}>{tr(status)}</span></td><td data-label={tr("actions")}><div className={styles.actions}>
      {contest?<Link className={styles.iconButton} aria-label={tr("manage",{name:title})} href={`/manager/om/contests/${row.id}`}><Pencil size={15}/></Link>:<button type="button" className={styles.iconButton} disabled={locked} aria-label={tr(row.is_active?"deactivate":"activate",{name:title})} onClick={()=>void run("toggle",row)}><CirclePower size={15}/></button>}
      <button type="button" className={`${styles.iconButton} ${styles.dangerIcon}`} disabled={locked} aria-label={tr("delete",{name:title})} onClick={()=>void run("delete",row)}><Trash2 size={15}/></button>
     </div></td></tr>;
    })}</tbody>
   </table></div>}
  </section>
 </main>;
}
