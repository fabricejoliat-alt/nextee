"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import MarketplaceSafetyActions from "@/components/player/MarketplaceSafetyActions";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import { useI18n } from "@/components/i18n/AppI18nProvider";

function Inbox() {
  const { locale, t } = useI18n();
  const params = useSearchParams(), messageId = params.get("message");
  const [messages, setMessages] = useState<Array<{ id: string; subject: string; message: string; reply_email: string; created_at: string }>>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    setError(false); setBusy(true);
    try {
      const context = await resolveEffectivePlayerContext();
      const { data } = await supabase.auth.getSession();
      const query = new URLSearchParams();
      if (context.role === "parent") query.set("child_id", context.effectiveUserId);
      if (messageId) query.set("message", messageId);
      const response = await fetch(`/api/player/marketplace/messages?${query}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` }, cache: "no-store" });
      if (!response.ok) throw new Error();
      setMessages((await response.json()).messages);
    } catch { setError(true); } finally { setBusy(false); }
  }, [messageId]);
  useEffect(() => { void load(); }, [load]);
  return <div className="player-dashboard-bg"><div className="app-shell marketplace-page">
    <div className="glass-section"><h1 className="section-title">{marketplaceSafetyText(locale, "messages")}</h1>
      <Link className="btn" href="/player/marketplace">{t("common.back")}</Link></div>
    <div className="glass-section">
      {error && <p role="alert">{marketplaceSafetyText(locale, "error")}</p>}
      {busy && <p role="status">{t("common.loading")}</p>}
      {!busy && !messages.length && <p>{marketplaceSafetyText(locale, "noMessages")}</p>}
      {messages.map(row => <article className="glass-card" key={row.id} style={{ display: "grid", gap: 12, marginBottom: 16, overflowWrap: "anywhere" }}>
        <h2>{row.subject}</h2><p>{row.reply_email} · {new Date(row.created_at).toLocaleDateString(locale)}</p>
        <p style={{ whiteSpace: "pre-wrap" }}>{row.message}</p>
        <MarketplaceSafetyActions messageId={row.id} />
      </article>)}
    </div>
  </div></div>;
}
export default function Page() { return <Suspense><Inbox /></Suspense>; }
