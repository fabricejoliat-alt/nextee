"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import type { OrganizationAccessSummary } from "@/lib/organizationPolicy";
export default function OrganizationContextSelect() {
  const {t}=useI18n(),pathname=usePathname(),params=useSearchParams(),router=useRouter();
  const [rows,setRows]=useState<OrganizationAccessSummary[]>([]),[failed,setFailed]=useState(false);
  const child=params.get("child_id");
  useEffect(()=>{let active=true;
    void (async()=>{try{const session=await supabase.auth.getSession();const token=session.data.session?.access_token;if(!token)return;
      const response=await fetch("/api/legal/status",{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
      if(!response.ok)throw new Error();const result=await response.json();
      if(active){setRows((result.organizations??[]).filter((row:OrganizationAccessSummary)=>!child||row.player_id===child));setFailed(false);}
    }catch{if(active)setFailed(true);}})();return()=>{active=false;};},[child,pathname]);
  if(failed)return <p role="status">{t("organization.contextUnavailable")}</p>;
  const organizations=[...new Map(rows.map(row=>[row.organization_id,row])).values()];
  if(!organizations.length)return null;
  return <div className="user-mgmt-toolbar"><label className="user-mgmt-field"><span>{t("organization.context")}</span>
    <select value={params.get("organization_id")??"all"} onChange={event=>{const next=new URLSearchParams(params.toString());
      if(event.target.value==='all')next.delete('organization_id');else next.set('organization_id',event.target.value);
      router.push(`${pathname}${next.size?`?${next}`:''}`);}}>
      <option value="all">{t("organization.allOrganizations")}</option>
      {organizations.map(row=><option key={row.organization_id} value={row.organization_id} disabled={!row.accessible}>
        {row.name} · {t(`organization.${row.org_type}`)}{!row.accessible?` · ${t('organization.authorizationPending')}`:''}</option>)}
    </select></label>{organizations.some(row=>!row.accessible)?<Link className="btn" href="/legal/my">{t("organization.documents")}</Link>:null}</div>;
}
