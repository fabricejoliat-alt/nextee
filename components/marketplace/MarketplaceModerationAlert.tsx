"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import styles from "@/components/admin/AdminHomeStats.module.css";

export function useMarketplaceModerationCounts(refreshNonce = 0) {
  const [counts, setCounts] = useState({ pending: 0, reports: 0 });
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        const response = await fetch("/api/marketplace/moderation?view=count", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
        if (response.ok && active) setCounts(await response.json());
      } catch { /* The moderation queue remains accessible from the menu. */ }
    }
    void load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [refreshNonce]);
  return counts;
}

export default function MarketplaceModerationAlert({ role }: { role: "admin" | "manager" }) {
  const { locale } = useI18n();
  const counts = useMarketplaceModerationCounts();
  if (!counts.pending && !counts.reports) return null;
  return <Link href={`/${role}/marketplace`} className={`${styles.quickLink} ${styles.attentionLink}`}>
    <span><ShieldCheck size={18} aria-hidden="true" /></span>
    <div><b>{marketplaceSafetyText(locale, "moderation")}</b><small>
      {marketplaceSafetyText(locale, "pending")} : {counts.pending} · {marketplaceSafetyText(locale, "reports")} : {counts.reports}
    </small></div><ChevronRight size={17} aria-hidden="true" />
  </Link>;
}
