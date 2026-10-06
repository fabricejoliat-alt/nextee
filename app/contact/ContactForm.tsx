"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { ArrowRight, Send } from "lucide-react";
import styles from "../legal/LegalPublic.module.css";

type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string; action: string; theme: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global { interface Window { turnstile?: TurnstileApi } }

export default function ContactForm({ siteKey, contactEmail }: { siteKey: string; contactEmail: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [token, setToken] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const [captchaError, setCaptchaError] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [success, setSuccess] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!scriptReady || !siteKey || !container.current || !window.turnstile || widgetId.current) return;
    try {
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: siteKey, action: "contact", theme: "light",
        callback: (value) => { setToken(value); setCaptchaError(false); },
        "expired-callback": () => setToken(""),
        "error-callback": () => { setToken(""); setCaptchaError(true); },
      });
    } catch { setCaptchaError(true); }
    return () => { if (widgetId.current) { window.turnstile?.remove(widgetId.current); widgetId.current = null; } };
  }, [scriptReady, siteKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token || sending) return;
    setSending(true); setStatus(""); setSuccess(false);
    try {
      const response = await fetch("/api/contact", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message, website, turnstile_token: token }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.error ?? "Envoi impossible. Réessayez plus tard."));
      setName(""); setEmail(""); setSubject(""); setMessage(""); setWebsite("");
      setSuccess(true); setStatus(result.mode === "mock"
        ? "Test local réussi : aucun e-mail n’a été envoyé."
        : "Votre message a été envoyé. Merci de nous avoir contactés.");
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Envoi impossible. Réessayez plus tard."); }
    finally { setToken(""); if (widgetId.current) window.turnstile?.reset(widgetId.current); setSending(false); }
  }

  return <section className={styles.section} aria-labelledby="contact-title">
    <h2 id="contact-title">Envoyer un message</h2>
    <p>Décrivez votre demande. Nous vous répondrons à l’adresse e-mail indiquée.</p>
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.field}>Votre nom<input required maxLength={120} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className={styles.field}>Votre adresse e-mail<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className={styles.field}>Objet<input required maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
      <label className={styles.field}>Message<textarea required minLength={10} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
      <div className={styles.honeypot} aria-hidden="true"><label>Site web<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label></div>
      {siteKey ? <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => setCaptchaError(true)} />
        <div className={styles.captchaArea} ref={container} aria-label="Vérification anti-spam" />
        {captchaError && <p className={`${styles.status} ${styles.error}`} role="alert">La vérification anti-spam ne s’est pas chargée. Actualisez la page ou utilisez l’adresse e-mail ci-dessous.</p>}
      </> : <p className={`${styles.status} ${styles.error}`} role="alert">Le formulaire est temporairement indisponible. Utilisez l’adresse e-mail ci-dessous.</p>}
      <button className={styles.primary} type="submit" disabled={!siteKey || !token || sending}>{sending ? "Envoi…" : "Envoyer le message"} <Send size={16} aria-hidden="true" /></button>
      {status && <p className={`${styles.status} ${success ? "" : styles.error}`} role="status">{status}</p>}
    </form>
    <div className={styles.contactAlternative}><p>Vous préférez votre messagerie ?</p><a href={`mailto:${contactEmail}?subject=Contact%20ActiviTee`}>{contactEmail} <ArrowRight size={15} aria-hidden="true" /></a></div>
  </section>;
}
