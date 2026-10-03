"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { useManagerOmMutation } from "@/components/manager/useManagerOmMutation";
import { supabase } from "@/lib/supabaseClient";
import { omText, omDate, omError, omName, type OmContestData } from "@/lib/managerOrderOfMerit";
import styles from "../../OrderOfMerit.module.css";

type Draft = { player_id:string; rank:string; note:string };
export default function ManagerContestDetailPage() {
 const params=useParams<{contestId:string}>(),id=params.contestId;
 const {t,locale}=useI18n();const tr=(key:string,values?:Record<string,string|number>)=>omText(t,key,values);
 const [loaded,setLoaded]=useState<(OmContestData&{id:string})|null>(null),[rows,setRows]=useState<Draft[]>([]),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState("");
 const [validation,setValidation]=useState(""),[success,setSuccess]=useState(false),[dirty,setDirty]=useState(false);const generation=useRef(0);
 const load=useCallback(async()=>{
  const token=++generation.current;setLoading(true);setLoadError("");setLoaded(null);
  try{
   const {data,error}=await supabase.rpc("get_manager_om_contest_v1",{p_contest_id:id});if(error)throw error;
   if(data?.contest?.id!==id||!data.contest.organization_id||typeof data.version!=="string"||!Array.isArray(data.players)||!Array.isArray(data.results))throw new Error("invalid_response");
   if(token!==generation.current)return;
   setLoaded({...data,id});setRows(data.results.map((r:{player_id:string;rank:number;note:string|null})=>({player_id:r.player_id,rank:String(r.rank),note:r.note??""})));setDirty(false);
  }catch(cause){if(token===generation.current){const failure=omError(cause);setLoadError(failure.definite?failure.key:"load");}throw cause;}
  finally{if(token===generation.current)setLoading(false);}
 },[id]);
 useEffect(()=>{setRows([]);setValidation("");setSuccess(false);void load().catch(()=>{});const counter=generation;return()=>{counter.current++;};},[load]);
 const mutation=useManagerOmMutation(id,async()=>{setSuccess(true);setDirty(false);await load();});
 const data=loaded?.id===id?loaded:null,locked=mutation.locked||loading||!data;
 const update=(index:number,patch:Partial<Draft>)=>{setRows(current=>current.map((r,i)=>i===index?{...r,...patch}:r));setDirty(true);setSuccess(false);};
 async function publish(){
  if(locked||!data)return;
  if(rows.some(r=>!r.player_id||!/^\d+$/.test(r.rank)||Number(r.rank)<1||Number(r.rank)>10000)){setValidation("invalid_rankings");return;}
  if(new Set(rows.map(r=>r.player_id)).size!==rows.length){setValidation("duplicate_player");return;}
  if(!rows.length&&data.results.length&&!window.confirm(tr("clearConfirm")))return;
  setValidation("");setSuccess(false);
  await mutation.run({club:data.contest.organization_id,kind:"contest",action:"publish",id,expected:data.version,payload:{rankings:rows.map(r=>({...r,rank:Number(r.rank)})),allow_empty:!rows.length&&!!data.results.length}});
 }
 const reload=()=>{if(dirty&&!window.confirm(tr("reloadDraft")))return;setValidation("");mutation.clearError();void load().catch(()=>{});};
 const error=validation||mutation.error||loadError;
 return <main className={styles.page}>
  <nav className={styles.breadcrumb} aria-label={t("common.breadcrumb")}><Link href="/manager">Manager</Link><ChevronRight size={13}/><Link href="/manager/om">{tr("title")}</Link><ChevronRight size={13}/><Link href={`/manager/om/contests${data?`?club=${data.contest.organization_id}`:""}`}>{tr("contest.title")}</Link></nav>
  <div className={styles.topline}><div><h1>{data?.contest.title||tr("results")}</h1>{data?<p className={styles.lead}>{omDate(data.contest.contest_date,locale,tr("undated"))}{data.contest.description?` — ${data.contest.description}`:""}</p>:null}</div><button className={styles.secondary} type="button" disabled={mutation.locked||loading} onClick={reload}>{tr("retry")}</button></div>
  {error?<div className={styles.alertError} role="alert">{tr(`error.${error}`)}</div>:null}
  {success?<div className={styles.alertSuccess} role="status">{tr("saved")}</div>:null}
  {mutation.uncertain?<button className={styles.secondary} disabled={mutation.busy} type="button" onClick={()=>void mutation.retry()}>{tr(mutation.busy?"saving":"verify")}</button>:null}
  {loading?<ListLoadingBlock label={tr("loading")}/>:data?<section className={styles.panel}>
   <div className={styles.panelHeader}><div><h2>{tr("results")}</h2><p>{tr("resultsHelp")}</p></div></div>
   <fieldset className={styles.formFields} disabled={locked}><div className={styles.tableWrap}><table className={styles.table}>
    <thead><tr>{["player","rank","note","actions"].map(k=><th key={k} scope="col">{tr(k)}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={i}>
     <td data-label={tr("player")}><select className={styles.tableControl} aria-label={tr("rowLabel",{field:tr("player"),n:i+1})} value={r.player_id} onChange={e=>update(i,{player_id:e.target.value})}><option value="">{tr("choosePlayer")}</option>{data.players.map(p=><option key={p.id} value={p.id}>{omName(p,tr("unnamed"))}</option>)}</select></td>
     <td data-label={tr("rank")}><input className={styles.tableControl} aria-label={tr("rowLabel",{field:tr("rank"),n:i+1})} type="number" min={1} max={10000} step={1} value={r.rank} onChange={e=>update(i,{rank:e.target.value})}/></td>
     <td data-label={tr("note")}><input className={styles.tableControl} aria-label={tr("rowLabel",{field:tr("note"),n:i+1})} value={r.note} maxLength={10000} onChange={e=>update(i,{note:e.target.value})}/></td>
     <td data-label={tr("actions")}><button type="button" className={`${styles.iconButton} ${styles.dangerIcon}`} aria-label={tr("removeRow",{n:i+1})} onClick={()=>{setRows(current=>current.filter((_,n)=>n!==i));setDirty(true);setSuccess(false);}}><Trash2 size={15}/></button></td>
    </tr>)}</tbody>
   </table></div></fieldset>
   {!rows.length?<div className={styles.empty}>{tr("noResults")}</div>:null}
   <div className={styles.actions}><button className={styles.secondary} type="button" disabled={locked||rows.length>=2000} onClick={()=>{setRows(current=>[...current,{player_id:"",rank:String(current.length+1),note:""}]);setDirty(true);setSuccess(false);}}><Plus size={15}/>{tr("addPlayer")}</button><button className={styles.primary} type="button" disabled={locked} onClick={()=>void publish()}>{tr(mutation.busy?"saving":"publish")}</button></div>
  </section>:null}
 </main>;
}
