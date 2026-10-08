"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Handshake, Minus, Plus, RefreshCw, Search, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import ManagerClubSelect from "./ManagerClubSelect";
import { useManagerClubSelection } from "./useManagerClubSelection";
import { managerHeaders, useManagerResource } from "./useManagerResource";
import type { OrganizationStatus, OrganizationType } from "@/lib/organizationPolicy";
import styles from "./OrganizationRosterWorkspace.module.css";

type Identity = { id: string; first_name: string | null; last_name: string | null };
type Entry = { id: string; player_id: string; revision: number; status: OrganizationStatus; origin_type: string;
  source_approved_at?: string | null; player: Identity; origin?: { id: string; name: string } | null; external?: { id: string; name: string } | null; academy?: { id: string; name: string } };
type Partner = { id: string; target_organization_id: string; status: OrganizationStatus; player_discovery_enabled: boolean; player_request_enabled: boolean; club: { id: string; name: string }; academy: { id: string; name: string } };
type Group = { id: string; name: string; club_season_id: string | null; players: Array<{ player_user_id: string }> };
type Data = { groups: Group[]; seasons: Array<{id:string;name:string}>; organization: { id: string; name: string; org_type: OrganizationType }; roster: Entry[]; partners: Partner[]; requests: Entry[] };
const nameOf = (profile: Identity) => [profile.last_name,profile.first_name].filter(Boolean).join(" ");

export default function OrganizationRosterWorkspace() {
  const { t, locale } = useI18n(), scope = useManagerClubSelection();
  const orgId = scope.clubId;
  const resource = useManagerResource<Data>(orgId ? `/api/manager/organizations/${orgId}/roster` : null,"organization.operationFailed");
  const [query,setQuery] = useState(""), [origin,setOrigin] = useState("all"), [status,setStatus] = useState("all"), [group,setGroup] = useState("all"), [season,setSeason] = useState("all");
  const [dialog,setDialog] = useState<{ org: string; kind: "partner"|"external"|"guardian"; entry?:string }|null>(null);
  const [busy,setBusy] = useState(false), [feedback,setFeedback] = useState<{org:string;error?:string;success?:string}|null>(null);
  const [partnerId,setPartnerId] = useState(""), [search,setSearch] = useState(""), [candidates,setCandidates] = useState<Array<Identity & {player_id:string}>>([]);
  const [username,setUsername] = useState(""), [externalName,setExternalName] = useState("");
  const [country,setCountry] = useState("CH"), [region,setRegion] = useState("");
  const [searched,setSearched] = useState(false), [verifiedGuardian,setVerifiedGuardian] = useState("");
  const [externalId,setExternalId] = useState<string|null>(null), [newFamily,setNewFamily] = useState(false);
  const [family,setFamily] = useState({first_name:"",last_name:"",birth_date:"",parent_first_name:"",parent_last_name:"",email:"",relation:"father"});
  const currentOrg = useRef(orgId); currentOrg.current=orgId;
  const mutation = useRef(false), searchRevision = useRef(0);
  const isAcademy = (resource.data?.organization.org_type ?? scope.clubs.find(row=>row.id===orgId)?.org_type) === "academy";
  const currentDialog = dialog?.org === orgId ? dialog : null;
  const [identityKind,setIdentityKind]=useState("player");
  const identities = useManagerResource<{matches:Array<{id:string;status:string;subject_role:string;player_id?:string;player?:Identity}>}>(
    currentDialog?.kind === "external" || currentDialog?.kind === "guardian" ? `/api/manager/organizations/${orgId}/external` : null,"organization.operationFailed");
  const rows = useMemo(() => (resource.data?.roster ?? []).filter(row =>
    (group === "all" || resource.data?.groups.some(item => item.id === group && item.players.some(player => player.player_user_id === row.player_id)))
    && (season === "all" || resource.data?.groups.some(item => item.club_season_id === season && item.players.some(player => player.player_user_id === row.player_id)))
    && (origin === "all" || row.origin_type === origin) && (status === "all" || row.status === status)
    && `${nameOf(row.player)} ${row.origin?.name ?? row.external?.name ?? ""}`.toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))),[resource.data,origin,status,query,locale,group,season]);

  async function post(path:string,input:object) {
    if (mutation.current) return false;
    mutation.current=true; setBusy(true); const selectedOrg=orgId; setFeedback(null);
    try {
      const response=await fetch(path,{method:"POST",headers:{...await managerHeaders(),"Content-Type":"application/json"},body:JSON.stringify(input)});
      const result=await response.json(); if(!response.ok)throw new Error(result.error ?? "organization.operationFailed");
      if(currentOrg.current!==selectedOrg)return false;
      setFeedback({org:selectedOrg,success:"organization.saved"}); resource.reload(); identities.reload(); return result;
    } catch(error) { if(currentOrg.current===selectedOrg)setFeedback({org:selectedOrg,error:error instanceof Error ? error.message : "organization.operationFailed"}); return false; }
    finally {mutation.current=false;setBusy(false);}
  }
  function open(kind:"partner"|"external") {
    setDialog({org:orgId,kind}); setFeedback(null); setCandidates([]); setSearch(""); setUsername(""); setSearched(false); setVerifiedGuardian("");
    setExternalName("");setExternalId(null);setNewFamily(false);setIdentityKind("player");
    setPartnerId(resource.data?.partners.find(row=>row.status==='active'&&row.player_discovery_enabled)?.target_organization_id ?? "");
  }
  async function discover() {
    const selectedOrg=orgId, version=++searchRevision.current; setBusy(true);setFeedback(null);setCandidates([]);
    try {
      const response=await fetch(`/api/manager/organizations/${orgId}/discovery?club=${encodeURIComponent(partnerId)}&q=${encodeURIComponent(search.trim())}`,{headers:await managerHeaders(),cache:"no-store"});
      const result=await response.json(); if(!response.ok)throw new Error(result.error ?? "organization.operationFailed");
      if(currentOrg.current===selectedOrg&&version===searchRevision.current){ setCandidates(result.players ?? []); setSearched(true); }
    } catch {if(currentOrg.current===selectedOrg)setFeedback({org:selectedOrg,error:"organization.operationFailed"});}
    finally {setBusy(false);}
  }
  function close(){if(!busy){++searchRevision.current;setDialog(null);setCandidates([]);}}
  const activePartners=(resource.data?.partners ?? []).filter(row=>row.status==='active'&&row.player_discovery_enabled);
  const field=(label:string,value:string,change:(next:string)=>void,type="text") => <label className={styles.field}><span>{t(`organization.${label}`)}</span><input type={type} value={value} onChange={event=>change(event.target.value)} disabled={busy}/></label>;
  const orgText=(key:string)=>t(`organization.${key}`);
  const dialogTitle=orgText(currentDialog?.kind==='guardian'?"manageGuardians":currentDialog?.kind==='partner'?"addPartner":"addExternal");
  const dialogLead=orgText(currentDialog?.kind==='guardian'?"guardianDialogLead":currentDialog?.kind==='partner'?"partnerDialogLead":"externalDialogLead");
  const stateLabel=(value:string)=><span className={`${styles.state} ${value==='active'||value==='approved'?styles.stateActive:value==='pending'?styles.statePending:styles.stateMuted}`}>{orgText(value)}</span>;
  const person=(profile:Identity)=><div className={styles.person}><span className={styles.avatar} aria-hidden="true">{[profile.first_name,profile.last_name].map(value=>value?.trim().charAt(0)).join('').toUpperCase()||'—'}</span><strong>{nameOf(profile)}</strong></div>;
  const matchName=(match:{player?:Identity})=>match.player?nameOf(match.player):orgText("identity");
  return <div className={styles.page}>
    <header className={styles.topline}><div><h1>{orgText(isAcademy?"roster":"requests")}</h1><p className={styles.lead}>{orgText(isAcademy?"rosterLead":"partnersLead")}</p></div>
      <div className={styles.context}><ManagerClubSelect clubs={scope.clubs} clubId={orgId} onChange={scope.setClubId} disabled={busy}/></div>
    </header>
    {isAcademy&&<div className={styles.headerActions}>
      <button type="button" className={styles.primaryButton} disabled={busy||resource.loading||!activePartners.length} onClick={()=>open("partner")}><Plus size={16} aria-hidden="true"/>{orgText("addPartner")}</button>
      <button type="button" className={styles.secondaryButton} disabled={busy||resource.loading} onClick={()=>open("external")}><UserPlus size={16} aria-hidden="true"/>{orgText("addExternal")}</button>
    </div>}
    {resource.error||scope.error?<div className={styles.errorAlert} role="alert"><span>{orgText("operationFailed")}</span><button type="button" className={styles.secondaryButton} onClick={resource.reload}>{t("manager.refresh")}</button></div>:null}
    {feedback?.org===orgId&&feedback.error&&!currentDialog?<div className={styles.errorAlert} role="alert">{t(feedback.error)}</div>:null}
    {feedback?.org===orgId&&feedback.success?<div className={styles.successAlert} role="status"><Check size={16} aria-hidden="true"/>{t(feedback.success)}</div>:null}
    {scope.loading||resource.loading?<section className={styles.panel}><ListLoadingBlock label={t("common.loading")}/></section>:resource.data?<>
      {isAcademy?<section className={styles.panel} aria-labelledby="roster-title">
        <div className={styles.sectionHeading}><div><h2 id="roster-title">{orgText("roster")}</h2><span className={styles.resultCount}>{rows.length} / {resource.data.roster.length}</span></div><button type="button" className={styles.secondaryButton} onClick={resource.reload} disabled={busy}><RefreshCw size={15} aria-hidden="true"/>{t("manager.refresh")}</button></div>
        <div className={styles.filters}>
          <label className={`${styles.field} ${styles.searchField}`}><span>{t("manager.settings.search")}</span><div className={styles.searchInput}><Search size={15} aria-hidden="true"/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("manager.administration.nameSearch")}/></div></label>
          <label className={styles.field}><span>{orgText("origin")}</span><select value={origin} onChange={event=>setOrigin(event.target.value)}>{["all","activitee_club","external_club","no_declared_club"].map(value=><option key={value} value={value}>{orgText(value)}</option>)}</select></label>
          <label className={styles.field}><span>{orgText("status")}</span><select value={status} onChange={event=>setStatus(event.target.value)}>{["all","pending","active","suspended","ended"].map(value=><option key={value} value={value}>{orgText(value)}</option>)}</select></label>
          <label className={styles.field}><span>{orgText("group")}</span><select value={group} onChange={event=>setGroup(event.target.value)}><option value="all">{orgText("all")}</option>{resource.data.groups.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className={styles.field}><span>{orgText("season")}</span><select value={season} onChange={event=>setSeason(event.target.value)}><option value="all">{orgText("all")}</option>{resource.data.seasons.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        </div>
        <div className={styles.tableFrame}><table className={styles.table} aria-label={orgText("roster")}><thead><tr><th scope="col">{orgText("player")}</th><th scope="col">{orgText("origin")}</th><th scope="col">{orgText("status")}</th><th scope="col">{t("manager.content.actions")}</th></tr></thead>
          <tbody>{rows.length?rows.map(row=><tr key={row.id}>
            <td>{person(row.player)}</td>
            <td data-label={orgText("origin")}><div className={styles.cellDetails}><strong>{row.origin?.name??row.external?.name??orgText(row.origin_type)}</strong>{(row.origin||row.external)&&<small>{orgText(row.origin_type)}</small>}</div></td>
            <td data-label={orgText("status")}><div className={styles.cellDetails}>{stateLabel(row.status)}{row.origin_type==='activitee_club'&&<small>{orgText(row.source_approved_at?"sourceApproved":"sourceApproval")}</small>}</div></td>
            <td className={styles.actionCell}>{row.status!=='ended'&&<div className={styles.rowActions}>
              <button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>{open("external");setDialog({org:orgId,kind:"guardian",entry:row.id});}}><Users size={14} aria-hidden="true"/>{orgText("parent")}</button>
              {row.status!=='active'?<button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>post(`/api/manager/organizations/${orgId}/roster`,{action:"status",entry_id:row.id,status:"active",expected_revision:row.revision})}>{orgText("activate")}</button>:<button type="button" className={styles.secondaryButton} disabled={busy} onClick={()=>post(`/api/manager/organizations/${orgId}/roster`,{action:"status",entry_id:row.id,status:"suspended",expected_revision:row.revision})}>{orgText("suspend")}</button>}
              <button type="button" className={styles.dangerButton} disabled={busy} onClick={()=>{if(window.confirm(orgText("finish")))void post(`/api/manager/organizations/${orgId}/roster`,{action:"status",entry_id:row.id,status:"ended",expected_revision:row.revision});}}>{orgText("finish")}</button>
            </div>}</td>
          </tr>):<tr><td colSpan={4}><div className={styles.emptyState}><Users size={26} aria-hidden="true"/><p>{orgText("empty")}</p></div></td></tr>}</tbody>
        </table></div>
        <div className={styles.panelFooter}><p className={styles.scopeHint}><ShieldCheck size={17} aria-hidden="true"/>{orgText("activationHint")}</p><Link href={`/manager/access?club=${orgId}`} className={styles.secondaryButton}>{t("manager.nav.familyAccess")}<ArrowRight size={14} aria-hidden="true"/></Link></div>
      </section>:<section className={styles.panel} aria-labelledby="sharing-title"><div className={styles.sectionHeading}><h2 id="sharing-title">{orgText("requests")}</h2></div><p className={styles.hint}>{orgText("sharingScope")}</p>
        <div className={styles.itemList}>{resource.data.requests.length?resource.data.requests.map(row=><article className={styles.listRow} key={row.id}><div className={styles.cellDetails}>{person(row.player)}<small>{row.academy?.name}</small></div><div className={styles.rowActions}>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={()=>post(`/api/manager/organizations/${orgId}/roster`,{action:"approve_source",entry_id:row.id,expected_revision:row.revision,approve:true})}>{orgText("approve")}</button>
          <button type="button" className={styles.dangerButton} disabled={busy} onClick={()=>post(`/api/manager/organizations/${orgId}/roster`,{action:"approve_source",entry_id:row.id,expected_revision:row.revision,approve:false})}>{orgText("refuse")}</button>
        </div></article>):<div className={styles.emptyState}><Handshake size={26} aria-hidden="true"/><p>{orgText("noRequests")}</p></div>}</div>
      </section>}
      <section className={styles.panel} aria-labelledby="partners-title"><div className={styles.sectionHeading}><h2 id="partners-title">{orgText("partners")}</h2><span className={styles.resultCount}>{resource.data.partners.length}</span></div>
        <div className={styles.itemList}>{resource.data.partners.length?resource.data.partners.map(row=><article key={row.id} className={styles.partnerRow}>
          <div className={styles.partnerIdentity}><span className={styles.partnerIcon}><Handshake size={18} aria-hidden="true"/></span><div className={styles.cellDetails}><strong>{isAcademy?row.club?.name:row.academy?.name}</strong>{stateLabel(row.status)}</div></div>
          <div className={styles.permissions}>{([["discover",row.player_discovery_enabled],["allowRequests",row.player_request_enabled]] as const).map(([key,enabled])=><span key={String(key)} className={enabled?styles.permissionOn:styles.permissionOff}>{enabled?<Check size={14} aria-hidden="true"/>:<Minus size={14} aria-hidden="true"/>}{orgText(String(key))}<span className={styles.srOnly}> · {orgText(enabled?"permissionEnabled":"permissionDisabled")}</span></span>)}</div>
        </article>):<div className={styles.emptyState}><Handshake size={26} aria-hidden="true"/><p>{orgText("noPartners")}</p></div>}</div>
      </section>
    </>:null}
    {currentDialog&&<AccessibleDialog labelledBy="organization-roster-dialog-title" onClose={close} className={styles.dialog}>
      <header className={styles.dialogHeader}><span className={styles.dialogIcon}>{currentDialog.kind==='partner'?<Handshake size={21} aria-hidden="true"/>:currentDialog.kind==='guardian'?<Users size={21} aria-hidden="true"/>:<UserPlus size={21} aria-hidden="true"/>}</span><div><h2 id="organization-roster-dialog-title">{dialogTitle}</h2><p>{dialogLead}</p></div><button type="button" className={styles.closeButton} disabled={busy} onClick={close} aria-label={t("common.close")}><X size={19} aria-hidden="true"/></button></header>
      <div className={styles.dialogBody}>
        {currentDialog.kind==='guardian'?<>
          <section className={styles.dialogSection}><h3>{orgText("existingParent")}</h3>
            <form className={styles.dialogForm} onSubmit={event=>{event.preventDefault();void post(`/api/manager/organizations/${orgId}/external`,{action:"identity",username,subject_role:"parent"});}}>
              {field("exactIdentifier",username,setUsername)}<p className={styles.hint}>{orgText("identityHint")}</p><div className={styles.formActions}><button type="submit" className={styles.secondaryButton} disabled={busy||username.trim().length<3}>{orgText("reviewIdentity")}</button></div>
            </form>
            <label className={styles.field}><span>{orgText("relation")}</span><select disabled={busy} value={family.relation} onChange={event=>setFamily({...family,relation:event.target.value})}>{["father","mother","legal_guardian"].map(value=><option key={value} value={value}>{orgText(value)}</option>)}</select></label>
            <div className={styles.itemList}>{identities.data?.matches.filter(match=>['approved','used'].includes(match.status)&&match.subject_role==='parent').map(match=><article key={match.id} className={styles.listRow}><strong>{matchName(match)}</strong><button type="button" className={styles.secondaryButton} disabled={busy} onClick={async()=>{const result=await post(`/api/manager/organizations/${orgId}/external`,{action:"attach_guardian",entry_id:currentDialog.entry,guardian_id:match.player_id,relation:family.relation});if(result)close();}}>{orgText("attachParent")}</button></article>)}</div>
          </section>
          <details className={styles.disclosure}><summary>{orgText("newParent")}</summary><form className={styles.dialogForm} onSubmit={async event=>{event.preventDefault();const result=await post(`/api/manager/organizations/${orgId}/external`,{action:"provision_guardian",entry_id:currentDialog.entry,parent:{first_name:family.parent_first_name,last_name:family.parent_last_name,email:family.email},relation:family.relation});if(result)close();}}>
            <div className={styles.grid2}>{field("firstName",family.parent_first_name,value=>setFamily({...family,parent_first_name:value}))}{field("lastName",family.parent_last_name,value=>setFamily({...family,parent_last_name:value}))}</div>
            {field("email",family.email,value=>setFamily({...family,email:value}),"email")}<div className={styles.formActions}><button type="submit" className={styles.primaryButton} disabled={busy}>{orgText("provision")}</button></div>
          </form></details><p className={styles.hint}>{orgText("invitationHint")}</p>
        </>:currentDialog.kind==='partner'?<>
          <form className={styles.dialogForm} onSubmit={event=>{event.preventDefault();void discover();}}>
            <label className={styles.field}><span>{orgText("partners")}</span><select value={partnerId} disabled={busy} onChange={event=>{setPartnerId(event.target.value);setCandidates([]);}}>{activePartners.map(row=><option key={row.id} value={row.target_organization_id}>{row.club.name}</option>)}</select></label>
            <div className={styles.searchForm}><label className={styles.field}><span>{t("manager.settings.search")}</span><div className={styles.searchInput}><Search size={15} aria-hidden="true"/><input value={search} onChange={event=>setSearch(event.target.value)} disabled={busy} placeholder={t("manager.administration.nameSearch")}/></div></label><button type="submit" disabled={busy||search.trim().length<3} className={styles.primaryButton}><Search size={15} aria-hidden="true"/>{t("manager.settings.search")}</button></div>
            <p className={styles.hint}>{orgText("searchHint")}</p>
          </form>
          <div className={styles.itemList}>{candidates.map(player=><article key={player.player_id} className={styles.listRow}>{person(player)}<button type="button" disabled={busy||!activePartners.some(row=>row.target_organization_id===partnerId&&row.player_request_enabled)} className={styles.secondaryButton} onClick={async()=>{const result=await post(`/api/manager/organizations/${orgId}/roster`,{action:"request",player_id:player.player_id,origin_type:"activitee_club",origin_organization_id:partnerId});if(result)close();}}>{orgText("request")}<ArrowRight size={14} aria-hidden="true"/></button></article>)}</div>
          {searched&&!candidates.length&&<div className={styles.emptyState} role="status"><Search size={24} aria-hidden="true"/><p>{orgText("noMatches")}</p></div>}
        </>:<>
          <label className={styles.field}><span>{orgText("profileMode")}</span><select disabled={busy} value={newFamily?"new":"existing"} onChange={event=>setNewFamily(event.target.value==='new')}><option value="existing">{orgText("identity")}</option><option value="new">{orgText("newIdentity")}</option></select></label>
          <fieldset className={styles.dialogSection}><legend>{orgText("externalClubOptional")}</legend><div className={styles.dialogForm}>
            {field("externalName",externalName,value=>{setExternalName(value);setExternalId(null);})}<div className={styles.grid2}>{field("country",country,value=>{setCountry(value.toUpperCase());setExternalId(null);})}{field("region",region,value=>{setRegion(value.toUpperCase());setExternalId(null);})}</div>
            <div className={styles.formActions}><button type="button" className={styles.secondaryButton} disabled={busy||externalName.trim().length<2||Boolean(externalId)} onClick={async()=>{const result=await post(`/api/manager/organizations/${orgId}/external`,{action:"reference",name:externalName,country_code:country,region_code:region});if(result)setExternalId(result.id);}}>{externalId?<Check size={15} aria-hidden="true"/>:null}{orgText("createReference")}</button></div>
          </div></fieldset>
          {newFamily?<form className={styles.dialogForm} onSubmit={async event=>{event.preventDefault();const result=await post(`/api/manager/organizations/${orgId}/external`,{action:"provision",player:{first_name:family.first_name,last_name:family.last_name,birth_date:family.birth_date},guardian_id:verifiedGuardian||undefined,parent:{first_name:family.parent_first_name,last_name:family.parent_last_name,email:family.email},relation:family.relation,external_club_reference_id:externalId});if(result)close();}}>
            <fieldset className={styles.dialogSection}><legend>{orgText("player")}</legend><div className={styles.grid2}>
              {field("firstName",family.first_name,value=>setFamily({...family,first_name:value}))}{field("lastName",family.last_name,value=>setFamily({...family,last_name:value}))}{field("birthDate",family.birth_date,value=>setFamily({...family,birth_date:value}),"date")}
            </div></fieldset>
            <fieldset className={styles.dialogSection}><legend>{orgText("parent")}</legend><div className={styles.dialogForm}>
              <label className={styles.field}><span>{orgText("parent")}</span><select disabled={busy} value={verifiedGuardian} onChange={event=>setVerifiedGuardian(event.target.value)}><option value="">{orgText("newParent")}</option>{identities.data?.matches.filter(match=>['approved','used'].includes(match.status)&&match.subject_role==='parent'&&match.player_id).map(match=><option key={match.id} value={match.player_id}>{matchName(match)} · {orgText("existingParent")}</option>)}</select></label>
              {!verifiedGuardian&&<div className={styles.grid2}>{field("firstName",family.parent_first_name,value=>setFamily({...family,parent_first_name:value}))}{field("lastName",family.parent_last_name,value=>setFamily({...family,parent_last_name:value}))}{field("email",family.email,value=>setFamily({...family,email:value}),"email")}</div>}
              <label className={styles.field}><span>{orgText("relation")}</span><select disabled={busy} value={family.relation} onChange={event=>setFamily({...family,relation:event.target.value})}>{["father","mother","legal_guardian"].map(value=><option key={value} value={value}>{orgText(value)}</option>)}</select></label>
            </div></fieldset>
            <p className={styles.hint}>{orgText("invitationHint")}</p><div className={styles.formActions}><button type="submit" disabled={busy||(Boolean(externalName)&&!externalId)} className={styles.primaryButton}><UserPlus size={15} aria-hidden="true"/>{orgText("provision")}</button></div>
          </form>:<section className={styles.dialogSection}><h3>{orgText("identity")}</h3>
            <form className={styles.dialogForm} onSubmit={event=>{event.preventDefault();void post(`/api/manager/organizations/${orgId}/external`,{action:"identity",username,subject_role:identityKind});}}>
              <div className={styles.grid2}><label className={styles.field}><span>{orgText("identityKind")}</span><select disabled={busy} value={identityKind} onChange={event=>setIdentityKind(event.target.value)}><option value="player">{orgText("player")}</option><option value="parent">{orgText("parent")}</option></select></label>{field("exactIdentifier",username,setUsername)}</div>
              <p className={styles.hint}>{orgText("identityHint")}</p><div className={styles.formActions}><button type="submit" disabled={busy||username.trim().length<3} className={styles.primaryButton}>{orgText("reviewIdentity")}</button></div>
            </form>
            <div className={styles.itemList}>{identities.data?.matches.map(match=><article key={match.id} className={styles.listRow}><div className={styles.cellDetails}><strong>{matchName(match)}</strong>{stateLabel(match.status)}</div>{match.status==='approved'&&match.subject_role==='player'?<button type="button" className={styles.secondaryButton} disabled={busy||(Boolean(externalName)&&!externalId)} onClick={async()=>{const result=await post(`/api/manager/organizations/${orgId}/roster`,{action:"request",player_id:match.player_id,origin_type:externalId?"external_club":"no_declared_club",external_club_reference_id:externalId});if(result)close();}}>{orgText("request")}</button>:null}</article>)}</div>
          </section>}
        </>}
        {identities.loading&&currentDialog.kind!=='partner'&&<ListLoadingBlock label={t("common.loading")}/>}
        {identities.error&&currentDialog.kind!=='partner'&&<div className={styles.errorAlert} role="alert">{orgText("operationFailed")}</div>}
        {feedback?.org===orgId&&feedback.error&&<div role="alert" className={styles.errorAlert}>{t(feedback.error)}</div>}
      </div>
      <footer className={styles.dialogFooter}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={close}>{t("common.close")}</button></footer>
    </AccessibleDialog>}
  </div>;
}
