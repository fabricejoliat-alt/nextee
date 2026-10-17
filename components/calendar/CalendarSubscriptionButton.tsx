"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarPlus, Copy, X } from "lucide-react";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import { calendarLocale, type CalendarScope } from "@/lib/calendarSubscription";
import { calendarText } from "@/lib/i18n/calendarSubscriptionMessages";
import styles from "./CalendarSubscriptionButton.module.css";

type Subscription = { httpsUrl: string; subscriptionUrl: string };
export default function CalendarSubscriptionButton({ kind, playerId, organizationId, disabled = false }: CalendarScope & { disabled?: boolean }) {
  const { locale: language } = useI18n();
  const locale = calendarLocale(language), titleId = useId();
  const tr = (key: Parameters<typeof calendarText>[1]) => calendarText(locale, key);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null), [confirmRevoke, setConfirmRevoke] = useState(false);
  const [message, setMessage] = useState<"copied" | "copyFailed" | "revoked" | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const requestVersion = useRef(0);
  const query = new URLSearchParams({ kind, locale, ...(playerId ? { player_id: playerId } : {}), ...(organizationId ? { organization_id: organizationId } : {}) }).toString();

  useEffect(() => { requestVersion.current++; setOpen(false); setSubscription(null); setError(false); setMessage(null); setConfirmRevoke(false); }, [query]);
  useEffect(() => () => { requestVersion.current++; }, []);

  async function request(method: "GET" | "POST" | "DELETE") {
    const version = ++requestVersion.current;
    setBusy(true); setError(false); setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error("Session unavailable");
      const response = await fetch(`/api/calendar/subscription?${query}`, { method, cache: "no-store", headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) throw new Error("Calendar unavailable");
      const payload = await response.json();
      if (version !== requestVersion.current) return;
      setSubscription(payload.subscription); setConfirmRevoke(false);
      if (method === "DELETE") setMessage("revoked");
    } catch { if (version === requestVersion.current) setError(true); }
    finally { if (version === requestVersion.current) setBusy(false); }
  }
  function show() { setOpen(true); void request("GET"); }
  function close() { requestVersion.current++; setOpen(false); setBusy(false); setConfirmRevoke(false); }
  async function copy() {
    if (!subscription) return;
    try { await navigator.clipboard.writeText(subscription.httpsUrl); setMessage("copied"); }
    catch { linkInput.current?.focus(); linkInput.current?.select(); setMessage("copyFailed"); }
  }
  return <>
    <button type="button" className={styles.trigger} disabled={disabled} onClick={show}><CalendarPlus size={17} aria-hidden="true" />{tr("title")}</button>
    {open && <AccessibleDialog labelledBy={titleId} onClose={close} className={styles.dialog}>
      <div className={styles.heading}><h2 id={titleId}>{tr("title")}</h2><button type="button" className={styles.close} aria-label={tr("close")} onClick={close}><X size={20} /></button></div>
      <p className={styles.intro}>{tr("intro")}</p><p>{tr(kind)}</p>
      <p className={styles.note}>{tr("updates")}</p>
      {busy && <p role="status">{tr("loading")}</p>}
      {error && <div role="alert" className={styles.error}><p>{tr("error")}</p><button type="button" className={styles.secondary} disabled={busy} onClick={() => void request("GET")}>{tr("retry")}</button></div>}
      {!subscription && !error && !busy && <button type="button" className={styles.primary} onClick={() => void request("POST")}>{tr("create")}</button>}
      {subscription && <div className={styles.subscription}>
        <a className={styles.primary} href={subscription.subscriptionUrl} referrerPolicy="no-referrer"><CalendarPlus size={18} aria-hidden="true" />{tr("open")}</a>
        <p>{tr("confirm")}</p>
        <label className={styles.label}>{tr("link")}<input ref={linkInput} readOnly value={subscription.httpsUrl} onFocus={event => event.target.select()} spellCheck={false} /></label>
        <button type="button" className={styles.secondary} onClick={() => void copy()} disabled={busy}><Copy size={16} aria-hidden="true" />{tr("copy")}</button>
        <p className={styles.note}>{tr("private")}</p>
        {confirmRevoke ? <div className={styles.revoke}><p>{tr("revokeHint")}</p><div className={styles.actions}><button type="button" className={styles.danger} disabled={busy} onClick={() => void request("DELETE")}>{tr("confirmRevoke")}</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirmRevoke(false)}>{tr("cancel")}</button></div></div>
          : <button type="button" className={styles.revokeButton} disabled={busy} onClick={() => setConfirmRevoke(true)}>{tr("revoke")}</button>}
      </div>}
      {message && <p role="status">{tr(message)}</p>}
    </AccessibleDialog>}
  </>;
}
