"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { marketplaceSafetyRequest } from "@/components/player/MarketplaceSafetyActions";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import { useI18n } from "@/components/i18n/AppI18nProvider";

export default function MarketplaceBlockedPage() {
  const { locale, t } = useI18n();
  const [blocks, setBlocks] = useState<Array<{ blocked_id: string; created_at: string; name: string }>>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError(false); setBusy(true);
    try {
      const context = await resolveEffectivePlayerContext();
      const { data } = await supabase.auth.getSession();
      const query = new URLSearchParams();
      if (context.role === "parent") query.set("child_id", context.effectiveUserId);
      const response = await fetch(`/api/player/marketplace/safety?${query}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" });
      if (!response.ok) throw new Error();
      setBlocks((await response.json()).blocks);
    } catch { setError(true); } finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function unblock(id: string) {
    if (busy) return;
    setBusy(true); setError(false);
    try { await marketplaceSafetyRequest({ action: "unblock", user_id: id }); await load(); }
    catch { setError(true); } finally { setBusy(false); }
  }
  return <div className="player-dashboard-bg"><div className="app-shell marketplace-page">
    <div className="glass-section"><h1 className="section-title">{marketplaceSafetyText(locale, "blockedUsers")}</h1>
      <Link className="btn" href="/player/marketplace">{t("common.back")}</Link></div>
    <div className="glass-section">
      {error && <p role="alert">{marketplaceSafetyText(locale, "error")}</p>}
      {busy && <p role="status">{t("common.loading")}</p>}
      {!busy && !blocks.length && <p>{marketplaceSafetyText(locale, "noBlocks")}</p>}
      {blocks.map((row, index) => <div className="glass-card" key={row.blocked_id} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <span>{row.name || `${t("common.defaultName")} ${index + 1}`} · {new Date(row.created_at).toLocaleDateString(locale)}</span>
        <button className="btn" onClick={() => void unblock(row.blocked_id)} disabled={busy}>{marketplaceSafetyText(locale, "unblock")}</button>
      </div>)}
    </div>
  </div></div>;
}
