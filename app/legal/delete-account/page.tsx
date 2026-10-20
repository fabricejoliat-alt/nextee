"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { accountDeletionMessages } from "@/lib/i18n/accountDeletionMessages";
import styles from "../LegalPublic.module.css";

type Deletion = { id: string; status: "requested" | "processing" | "completed" | "cancelled"; due_at: string; completed_at: string | null };
export default function DeleteAccountPage() {
  const { locale } = useI18n(), copy = accountDeletionMessages[locale];
  const [signedIn, setSignedIn] = useState(false), [ready, setReady] = useState(false);
  const [isParent, setIsParent] = useState(false);
  const [password, setPassword] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [request, setRequest] = useState<Deletion | null>(null), [receipt, setReceipt] = useState("");
  const [ownRequestId, setOwnRequestId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      setSignedIn(Boolean(token));
      setIsParent(false);
      let ownRequest: Deletion | null = null;
      if (token) {
        const options = { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" as const };
        const [ownResponse, actor] = await Promise.all([
          fetch("/api/legal/account-deletion", options),
          fetch("/api/auth/me", options).then(async (response) => response.ok ? response.json() : null).catch(() => null),
        ]);
        setIsParent(actor?.membership?.role === "parent" || actor?.roles?.includes("parent") === true);
        if (ownResponse.ok) {
          ownRequest = (await ownResponse.json()).request;
          setOwnRequestId(ownRequest?.id ?? "");
        } else if (ownResponse.status === 401) {
          setSignedIn(false);
          setIsParent(false);
          setOwnRequestId("");
        } else if (!window.location.hash) throw new Error(copy.error);
      }
      const secret = window.location.hash.slice(1);
      if (/^[a-f0-9]{64}$/.test(secret)) {
        setReceipt(secret);
        const response = await fetch("/api/legal/account-deletion/status", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt: secret }), cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok) throw new Error(response.status === 404 ? copy.noReceipt : copy.error);
        setRequest(data.request);
      } else setRequest(ownRequest);
    } catch (e) { setError(e instanceof Error ? e.message : copy.error); }
    finally { setReady(true); }
  }, [copy]);
  useEffect(() => { void load(); }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error(copy.login);
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      const response = await fetch("/api/legal/account-deletion", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm: confirmed, receipt: secret, locale }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === "WRONG_PASSWORD" ? copy.wrongPassword : data.error === "RATE_LIMITED" ? copy.rateLimited : copy.error);
      setPassword(""); setRequest(data.request); setOwnRequestId(data.request.id); setReceipt(secret);
      // Fragment is never transmitted to the web server.
      window.history.replaceState(null, "", `${window.location.pathname}#${secret}`);
    } catch (e) { setError(e instanceof Error ? e.message : copy.error); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setError("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await fetch("/api/legal/account-deletion", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { await load(); throw new Error(copy.error); }
      setRequest((r) => r ? { ...r, status: "cancelled" } : null);
    } catch (e) { setError(e instanceof Error ? e.message : copy.error); }
    finally { setBusy(false); }
  }
  const showForm = signedIn && (!request || request.status === "cancelled" || (request.status === "requested" && !receipt));
  return <main className={styles.page}>
    <span className={styles.eyebrow}><Trash2 size={17} aria-hidden="true" /> ActiviTee</span>
    <h1 className={styles.heading}>{copy.title}</h1><p className={styles.lead}>{copy.lead}</p>
    <section className={styles.section}><p>{copy.consequences}</p>{isParent && <p>{copy.parentConsequences}</p>}<p>{copy.timing}</p><p>{copy.retention}</p></section>
    {request && <section className={styles.section} aria-live="polite">
      <h2>{request.status === "completed" ? copy.completed : request.status === "processing" ? copy.processing : request.status === "cancelled" ? copy.cancelled : copy.pending}</h2>
      {["requested", "processing"].includes(request.status) && <p>{copy.deadline} {new Date(request.due_at).toLocaleDateString(locale)}.</p>}
      {request.status === "completed" && <p>{copy.completedInfo}</p>}
      {receipt && <><p>{copy.receipt}</p><div className={styles.contactActions}>
        <button type="button" className={styles.secondary} onClick={async () => {
          try { await navigator.clipboard.writeText(`${window.location.origin}/legal/delete-account#${receipt}`); setCopied(true); }
          catch { setError(copy.error); }
        }}>{copied ? copy.copied : copy.copy}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load()}>{copy.refresh}</button>
      </div></>}
      {request.status === "requested" && signedIn && ownRequestId === request.id && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void cancel()}>{copy.cancel}</button>}
    </section>}
    {!ready && <p role="status">{copy.busy}</p>}
    {ready && !signedIn && !request && <section className={styles.section}><p>{copy.login}</p><Link className={styles.primary} href="/login">{copy.loginButton}</Link></section>}
    {showForm && <section className={styles.section}>
      {request?.status === "requested" && <p>{copy.newReceipt}</p>}
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>{copy.password}<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <label className={styles.deletionConfirmation}><input type="checkbox" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>{copy.checkbox}</span></label>
        <button type="submit" className={`${styles.primary} ${styles.danger}`} disabled={busy || !confirmed || !password}>{busy ? copy.busy : copy.submit}</button>
      </form>
    </section>}
    {error && <p role="alert" className={`${styles.status} ${styles.error}`}>{error}</p>}
    <footer className={styles.footer}><Link href="/legal">{copy.privacy}</Link><Link href="/legal/request">{copy.data}</Link></footer>
  </main>;
}
