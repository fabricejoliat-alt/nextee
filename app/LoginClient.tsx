"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import styles from "./LoginClient.module.css";
import { loginMessages } from "./loginMessages";
import type { AppLocale } from "@/lib/i18n/messages";

async function withLoginTimeout<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Login timed out")), 15000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default function LoginPage() {

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isLocalDev, setIsLocalDev] = useState(false);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverIdentifier, setRecoverIdentifier] = useState("");
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactMessage, setContactMessage] = useState<string | null>(null);
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactBirthDate, setContactBirthDate] = useState("");
  const [contactClub, setContactClub] = useState("");
  const [locale, setLocale] = useState<AppLocale>("fr");
  const [localeReady, setLocaleReady] = useState(false);
  const copy = loginMessages[locale];

  useEffect(() => {
    const saved = window.localStorage.getItem("app_locale");
    if (saved === "fr" || saved === "en" || saved === "de" || saved === "it") setLocale(saved);
    setLocaleReady(true);
  }, []);

  useEffect(() => {
    if (!localeReady) return;
    window.localStorage.setItem("app_locale", locale);
    document.documentElement.lang = locale;
  }, [locale, localeReady]);

  useEffect(() => {
    const hostname = window.location.hostname;
    setIsLocalDev(hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1");
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    let redirected = false;

    try {
      const resolveRes = await withLoginTimeout(fetch("/api/auth/resolve-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      }));
      const resolveJson = await resolveRes.json().catch(() => ({}));

      if (!resolveRes.ok || !resolveJson.email) {
        setError(copy.invalid);
        return;
      }

      const { data, error } = await withLoginTimeout(supabase.auth.signInWithPassword({
        email: resolveJson.email,
        password,
      }));

      if (error || !data.session) {
        setError(copy.invalid);
        return;
      }

      const accessToken = data.session.access_token;
      const res = await withLoginTimeout(fetch("/api/auth", {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      }));
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error ?? `Erreur serveur auth (${res.status})`);
        return;
      }

      const destination = typeof json?.redirectTo === "string" && json.redirectTo.startsWith("/") && !json.redirectTo.startsWith("//")
        ? json.redirectTo : "/player";
      window.location.replace(destination);
      redirected = true;
      setTimeout(() => {
        if (window.location.pathname === "/" || window.location.pathname === "/login") {
          setLoading(false);
          setError(copy.connectionError);
        }
      }, 15000);
    } catch {
      setError(copy.connectionError);
    } finally {
      if (!redirected) setLoading(false);
    }
  }

  async function handleRecoverAccess() {
    if (recoverLoading) return;
    setRecoverLoading(true);
    setRecoverMessage(null);
    try {
      const res = await fetch("/api/auth/recover-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: recoverIdentifier }),
      });
      await res.json().catch(() => ({}));
      setRecoverMessage(copy.recoverySent);
    } catch {
      setRecoverMessage(copy.recoverySent);
    } finally {
      setRecoverLoading(false);
    }
  }

  async function handleRecoverUsernameContact() {
    if (contactLoading) return;
    setContactLoading(true);
    setContactMessage(null);
    try {
      const res = await fetch("/api/auth/recover-username-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: contactFirstName,
          last_name: contactLastName,
          birth_date: contactBirthDate,
          club: contactClub,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setContactMessage(String(json?.error ?? copy.sendError));
        return;
      }
      setContactMessage(copy.requestSent);
      setContactFirstName("");
      setContactLastName("");
      setContactBirthDate("");
      setContactClub("");
    } catch {
      setContactMessage(copy.sendError);
    } finally {
      setContactLoading(false);
    }
  }

  return (
    <main className={styles.page} data-login-page>
      <div className={styles.image} aria-hidden="true" />
      <div className={styles.shell}>
        <div className={styles.contentStack}>
        <section className={styles.intro} aria-labelledby="welcome-title">
          <div className={`brand ${styles.brand}`} aria-label="ActiviTee"><span className="brand-nex">Activi</span><span className="brand-tee">Tee</span></div>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 id="welcome-title">{copy.title}</h1>
          <p className={styles.introText}>{copy.intro}</p>
        </section>

        <section className={styles.loginColumn} aria-labelledby="login-title">
          <div className={styles.loginCard}>
            <div className={styles.cardHeading}>
              <h2 id="login-title">{copy.access}</h2>
            </div>
            <form onSubmit={handleLogin} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="login-identifier">{copy.identifier}</label>
                <input id="login-identifier" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
              </div>
              <div className={styles.field}>
                <label htmlFor="login-password">{copy.password}</label>
                <input id="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              {error ? <div className={styles.error} role="alert">{error}</div> : null}
              <button className={styles.submit} type="submit" disabled={loading}>{loading ? copy.loggingIn : copy.login}</button>
              <button type="button" className={`${styles.secondary} ${styles.forgot}`} onClick={() => { setRecoverOpen((current) => !current); setRecoverMessage(null); setContactOpen(false); setContactMessage(null); }}>{copy.forgot}</button>

              {recoverOpen ? (
                <div className={styles.recovery}>
                  <div className={styles.recoveryCopy}>{copy.recoveryCopy} <button type="button" className={styles.textAction} onClick={() => { setContactOpen((current) => !current); setContactMessage(null); }}>{copy.clickHere}</button>.</div>
                  <div className={styles.recoveryForm}>
                    <input required value={recoverIdentifier} onChange={(e) => setRecoverIdentifier(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleRecoverAccess(); } }} placeholder={copy.identifier} autoComplete="username" aria-label={copy.recoverIdentifier} />
                    <button className={styles.secondary} type="button" onClick={() => void handleRecoverAccess()} disabled={recoverLoading || !recoverIdentifier.trim()}>{recoverLoading ? copy.sending : copy.recover}</button>
                  </div>
                  {recoverMessage ? <div className={styles.message} role="status">{recoverMessage}</div> : null}
                  {contactOpen ? (
                    <div className={styles.contactBlock}>
                      <div className={styles.contactIntro}>{copy.contactIntro}</div>
                      <div className={styles.contactGrid}>
                        <input value={contactFirstName} onChange={(e) => setContactFirstName(e.target.value)} placeholder={copy.firstName} aria-label={copy.firstName} />
                        <input value={contactLastName} onChange={(e) => setContactLastName(e.target.value)} placeholder={copy.lastName} aria-label={copy.lastName} />
                      </div>
                      <div className={styles.contactGrid}>
                        <input type="date" value={contactBirthDate} onChange={(e) => setContactBirthDate(e.target.value)} aria-label={copy.birthDate} />
                        <input value={contactClub} onChange={(e) => setContactClub(e.target.value)} placeholder={copy.club} aria-label={copy.club} />
                      </div>
                      <button className={styles.secondary} type="button" onClick={() => void handleRecoverUsernameContact()} disabled={contactLoading || !contactFirstName.trim() || !contactLastName.trim() || !contactBirthDate.trim() || !contactClub.trim()}>{contactLoading ? copy.sending : copy.sendRequest}</button>
                      {contactMessage ? <div className={styles.message} role="status">{contactMessage}</div> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {isLocalDev ? <div className={styles.devLink}><Link href="/dev/impersonate">{copy.devLink}</Link></div> : null}
            </form>
          </div>
        </section>
        </div>
        <footer className={styles.footer}>
          <nav aria-label={copy.information}><Link href="/legal">{copy.legal}</Link><span aria-hidden="true">·</span><Link href="/legal/request">{copy.myData}</Link><span aria-hidden="true">·</span><Link href="/contact">{copy.contact}</Link></nav>
          <nav className={styles.languages} aria-label={copy.language}>
            {(["fr", "en", "de", "it"] as const).map((language, index) => (
              <span className={styles.languageItem} key={language}>
                {index > 0 ? <span className={styles.languageSeparator} aria-hidden="true">·</span> : null}
                <button type="button" lang={language} aria-pressed={locale === language} className={locale === language ? styles.activeLanguage : undefined} onClick={() => setLocale(language)}>{language.toUpperCase()}</button>
              </span>
            ))}
          </nav>
        </footer>
      </div>
    </main>
  );
}
