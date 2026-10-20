"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Flag, Ban } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { resolveEffectivePlayerContext } from "@/lib/effectivePlayer";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import styles from "./MarketplaceSafety.module.css";

export async function marketplaceSafetyRequest(input: Record<string, unknown>) {
  const context = await resolveEffectivePlayerContext();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Session");
  const response = await fetch("/api/player/marketplace/safety", {
    method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, child_id: context.role === "parent" ? context.effectiveUserId : null }),
  });
  if (!response.ok) throw new Error("Action");
}

export default function MarketplaceSafetyActions({ itemId, messageId }: { itemId?: string; messageId?: string }) {
  const { locale } = useI18n();
  const text = (key: Parameters<typeof marketplaceSafetyText>[1]) => marketplaceSafetyText(locale, key);
  const router = useRouter();
  const [mode, setMode] = useState<"report" | "block" | null>(null);
  const [reason, setReason] = useState("inappropriate");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !mode) return;
    setBusy(true); setError(false);
    try {
      await marketplaceSafetyRequest({ action: mode, item_id: itemId, message_id: messageId, reason, details });
      if (mode === "block") { router.replace("/player/marketplace"); router.refresh(); }
      else { setSent(true); setMode(null); }
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <section className={styles.panel} aria-label={text("rules")}>
    <div className={styles.actions}>
      <button type="button" className="btn" onClick={() => { setMode("report"); setError(false); }} disabled={busy || sent}><Flag size={16} />{text(messageId ? "reportMessage" : "report")}</button>
      <button type="button" className="btn" onClick={() => { setMode("block"); setError(false); }} disabled={busy}><Ban size={16} />{text(messageId ? "blockSender" : "block")}</button>
    </div>
    {sent && <p role="status">{text("sent")}</p>}
    {mode && <form className={styles.form} onSubmit={submit}>
      {mode === "block" ? <p>{text("blockConfirm")}</p> : <>
        <label>{text("reason")}<select value={reason} onChange={event => setReason(event.target.value)} disabled={busy}>
          {(["inappropriate", "harassment", "fraud", "other"] as const).map(value => <option key={value} value={value}>{text(value)}</option>)}
        </select></label>
        <label>{text("details")}<textarea value={details} onChange={event => setDetails(event.target.value)} rows={4} maxLength={2000} disabled={busy} /></label>
      </>}
      {error && <p role="alert">{text("error")}</p>}
      <div className={styles.actions}>
        <button className="btn btn-primary" type="submit" disabled={busy}>{text(mode === "report" ? "send" : "confirm")}</button>
        <button className="btn" type="button" onClick={() => setMode(null)} disabled={busy}>{text("cancel")}</button>
      </div>
    </form>}
    <Link href="/legal/marketplace">{text("rules")}</Link>
  </section>;
}
