"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";

export default function MarketplaceModerationAlert({ role }: { role: "admin" | "manager" }) {
  const { locale } = useI18n();
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
  }, []);
  if (!counts.pending && !counts.reports) return null;
  return <Link href={`/${role}/marketplace`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", margin: "16px auto", maxWidth: 1044, background: "#fff5df", color: "#584019", border: "1px solid #e1c987", borderRadius: 12, textDecoration: "none" }}>
    <ShieldCheck size={22} aria-hidden="true" />
    <span><strong>{marketplaceSafetyText(locale, "moderation")}</strong><br />
      {marketplaceSafetyText(locale, "pending")} : {counts.pending} · {marketplaceSafetyText(locale, "reports")} : {counts.reports}
    </span>
  </Link>;
}
