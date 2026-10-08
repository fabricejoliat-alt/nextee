"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, History, LoaderCircle, Minus, Save, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import { managerHeaders, useManagerResource } from "@/components/manager/useManagerResource";
import styles from "./OrganizationSettingsAdmin.module.css";
import table from "./OrganizationsAdmin.module.css";
import partners from "./OrganizationPartnersAdmin.module.css";
type Partner={id:string;target_organization_id:string;revision:number;status:string;player_discovery_enabled:boolean;player_request_enabled:boolean};
type Data={readiness:{required:number;prepared:number;published:number;active:number};partners:Partner[];clubs:Array<{id:string;name:string;is_active:boolean}>;history:Array<{id:number;created_at:string;next_state:Record<string,unknown>}>;documents:Array<{id:string;active:boolean}>};
export default function OrganizationPartnersAdmin({organizationId,isAcademy}:{organizationId:string;isAcademy:boolean}){
  const {t,locale}=useI18n(),resource=useManagerResource<Data>(`/api/admin/organizations/${organizationId}/partners`,"organization.operationFailed");
  const [club,setClub]=useState(""),[discovery,setDiscovery]=useState(false),[requests,setRequests]=useState(false),[status,setStatus]=useState("pending"),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState("");const mutation=useRef(false);
  const selected=resource.data?.partners.find(row=>row.target_organization_id===club),text=(key:string)=>t(`organization.${key}`);
  function select(id:string){setClub(id);const row=resource.data?.partners.find(item=>item.target_organization_id===id);setDiscovery(row?.player_discovery_enabled??false);setRequests(row?.player_request_enabled??false);setStatus(row?.status??"pending");}
  async function save(event:React.FormEvent){event.preventDefault();if(mutation.current)return;mutation.current=true;setBusy(true);setFeedback("");
    try{const response=await fetch(`/api/admin/organizations/${organizationId}/partners`,{method:"POST",headers:{...await managerHeaders(),"Content-Type":"application/json"},body:JSON.stringify({club_id:club,status,discovery,requests,expected_revision:selected?.revision??0})});if(!response.ok)throw new Error();resource.reload();setFeedback("organization.saved");}
    catch{setFeedback("organization.operationFailed");}finally{setBusy(false);mutation.current=false;}}
  const readiness=resource.data?.readiness;
  const required=readiness?.required??3;
  function permission(enabled:boolean){
    return <span className={enabled?partners.permissionEnabled:partners.permissionDisabled}>
      {enabled?<Check size={15} aria-hidden="true"/>:<Minus size={15} aria-hidden="true"/>}
      <span className={partners.srOnly}>{text(enabled?"permissionEnabled":"permissionDisabled")}</span>
    </span>;
  }
  return <section className={`${styles.section} ${partners.panel}`} aria-label={text(isAcademy?"partners":"legalReady")}>
    <div className={styles.sectionHeading}><h2>{text(isAcademy?"partners":"legalReady")}</h2><p>{text("partnersLead")}</p></div>
    {resource.loading?<ListLoadingBlock label={t("common.loading")}/>:resource.error?
      <div role="alert" className={styles.errorAlert}>{text("operationFailed")}<button type="button" className={styles.secondaryButton} onClick={resource.reload}>{t("manager.refresh")}</button></div>:<>
      <div className={partners.readiness}>
        <div className={partners.readinessSummary}>
          <span className={partners.readinessIcon}><ShieldCheck size={19} aria-hidden="true"/></span>
          <div><strong className={partners.readinessTitle}>{text("legalReady")}</strong>
            <dl className={partners.metrics}>
              {([["legalPrepared",readiness?.prepared],["legalPublished",readiness?.published],["legalActive",readiness?.active]] as const).map(([label,count])=>
                <div key={label}><dt>{text(label)}</dt><dd>{count??0}<span>/{required}</span></dd></div>)}
            </dl>
          </div>
        </div>
        <Link className={styles.secondaryButton} href="/admin/legal">{text("documents")}<ArrowUpRight size={15} aria-hidden="true"/></Link>
      </div>
      {isAcademy?<>
        <form onSubmit={save} className={partners.form}>
          <div className={styles.grid2}>
            <label className={styles.field}><span>{text("club")}</span><select disabled={busy} value={club} onChange={event=>select(event.target.value)}><option value="">{t("common.choose")}</option>{resource.data?.clubs.filter(row=>row.is_active).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label className={styles.field}><span>{text("status")}</span><select value={status} disabled={busy} onChange={event=>setStatus(event.target.value)}>{["pending","active","suspended","ended"].map(value=><option key={value} value={value}>{text(value)}</option>)}</select></label>
          </div>
          <div className={partners.permissions}>
            {([["discover","discoverPermissionHint",discovery,setDiscovery],["allowRequests","requestPermissionHint",requests,setRequests]] as const).map(([key,hint,value,update])=>
              <label key={key} className={`${styles.toggle} ${partners.permissionToggle}`}><span><b>{text(key)}</b><small>{text(hint)}</small></span><input type="checkbox" aria-label={text(key)} checked={value} disabled={busy} onChange={event=>update(event.target.checked)}/><i aria-hidden="true"/></label>)}
          </div>
          <div className={partners.formActions}><button className={styles.primaryButton} type="submit" disabled={busy||!club||selected?.status==='ended'}>
            {busy?<LoaderCircle size={15} className={partners.spinner} aria-hidden="true"/>:<Save size={15} aria-hidden="true"/>}{busy?t("common.loading"):t("common.save")}
          </button></div>
        </form>
        <div className={`${table.tableFrame} ${partners.tableFrame}`}><table className={`${table.table} ${partners.table}`} aria-label={text("partners")}>
          <thead><tr><th scope="col">{text("club")}</th><th scope="col">{text("status")}</th><th scope="col">{text("discover")}</th><th scope="col">{text("allowRequests")}</th></tr></thead>
          <tbody>{resource.data?.partners.length?resource.data.partners.map(row=><tr key={row.id}>
            <td><strong>{resource.data?.clubs.find(item=>item.id===row.target_organization_id)?.name??text("club")}</strong></td>
            <td data-label={text("status")}><span className={`${partners.status} ${row.status==='active'?partners.statusActive:row.status==='suspended'?partners.statusSuspended:partners.statusNeutral}`}>{text(row.status)}</span></td>
            <td data-label={text("discover")}>{permission(row.player_discovery_enabled)}</td>
            <td data-label={text("allowRequests")}>{permission(row.player_request_enabled)}</td>
          </tr>):<tr><td colSpan={4} className={partners.emptyState}>{text("noPartners")}</td></tr>}</tbody>
        </table></div>
        <details className={partners.history}><summary><History size={16} aria-hidden="true"/><span>{text("history")}</span><ChevronDown size={16} className={partners.chevron} aria-hidden="true"/></summary>
          {resource.data?.history.length?<ul className={partners.historyList}>{resource.data.history.map(row=><li key={row.id}>
            <div className={partners.historyIdentity}><strong>{resource.data?.clubs.find(club=>club.id===row.next_state.target_organization_id)?.name??text("club")}</strong><time dateTime={row.created_at}>{new Intl.DateTimeFormat(locale,{dateStyle:"short",timeStyle:"short"}).format(new Date(row.created_at))}</time></div>
            <div className={partners.historyState}><span className={partners.status}>{text(String(row.next_state.status??"pending"))}</span><span>{text("discover")}{permission(row.next_state.player_discovery_enabled===true)}</span><span>{text("allowRequests")}{permission(row.next_state.player_request_enabled===true)}</span></div>
          </li>)}</ul>:<p className={partners.emptyHistory}>{text("noPartnerHistory")}</p>}
        </details>
      </>:null}
    </>}
    {feedback?<div className={feedback==='organization.saved'?styles.successAlert:styles.errorAlert} role="status">{t(feedback)}</div>:null}
  </section>;
}
