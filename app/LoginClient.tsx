"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import styles from "./LoginClient.module.css";

export default function LoginPage() {
  const router = useRouter();

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
      const resolveRes = await fetch("/api/auth/resolve-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const resolveJson = await resolveRes.json().catch(() => ({}));

      if (!resolveRes.ok || !resolveJson.email) {
        setError("Identifiant ou mot de passe invalide.");
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: resolveJson.email,
        password,
      });

      if (error || !data.session) {
        setError("Identifiant ou mot de passe invalide.");
        return;
      }

      const accessToken = data.session.access_token;
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error ?? `Erreur serveur auth (${res.status})`);
        return;
      }

      redirected = true;
      router.push(json?.redirectTo || "/player");
    } catch {
      setError("Erreur de connexion.");
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
      setRecoverMessage(
        "Si un accès récupérable existe, un e-mail contenant l’identifiant et le lien de réinitialisation a été envoyé."
      );
    } catch {
      setRecoverMessage(
        "Si un accès récupérable existe, un e-mail contenant l’identifiant et le lien de réinitialisation a été envoyé."
      );
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
        setContactMessage(String(json?.error ?? "Envoi impossible."));
        return;
      }
      setContactMessage("Ta demande a bien été envoyée.");
      setContactFirstName("");
      setContactLastName("");
      setContactBirthDate("");
      setContactClub("");
    } catch {
      setContactMessage("Envoi impossible.");
    } finally {
      setContactLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.image} aria-hidden="true" />
      <div className={styles.shell}>
        <section className={styles.intro} aria-labelledby="welcome-title">
          <div className={`brand ${styles.brand}`} aria-label="ActiviTee"><span className="brand-nex">Activi</span><span className="brand-tee">Tee</span></div>
          <p className={styles.eyebrow}>La plateforme de gestion des sections juniors de golf</p>
          <h1 id="welcome-title">Faire grandir les jeunes golfeurs, ensemble.</h1>
          <p className={styles.introText}>ActiviTee réunit clubs, coachs, juniors et familles pour organiser la section junior et accompagner la progression des jeunes.</p>
        </section>

        <section className={styles.loginColumn} aria-labelledby="login-title">
          <div className={styles.loginCard}>
            <div className={styles.cardHeading}>
              <h2 id="login-title">Accéder à ActiviTee</h2>
              <p>Connectez-vous avec votre identifiant ou votre adresse e-mail.</p>
            </div>
            <form onSubmit={handleLogin} className={styles.form}>
              <div className={styles.field}>
                <label htmlFor="login-identifier">E-mail ou identifiant</label>
                <input id="login-identifier" required value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
              </div>
              <div className={styles.field}>
                <label htmlFor="login-password">Mot de passe</label>
                <input id="login-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              {error ? <div className={styles.error} role="alert">{error}</div> : null}
              <button className={styles.submit} type="submit" disabled={loading}>{loading ? "Connexion…" : "Se connecter"}</button>
              <button type="button" className={`${styles.secondary} ${styles.forgot}`} onClick={() => { setRecoverOpen((current) => !current); setRecoverMessage(null); setContactOpen(false); setContactMessage(null); }}>Identifiant ou mot de passe oublié ?</button>

              {recoverOpen ? (
                <div className={styles.recovery}>
                  <div className={styles.recoveryCopy}>Saisis ton e-mail ou ton username. Si tu es junior et que tu n’as pas d&apos;adresse e-mail, le lien de récupération sera envoyé à tes parents. Si tu ne te souviens pas de ton username, <button type="button" className={styles.textAction} onClick={() => { setContactOpen((current) => !current); setContactMessage(null); }}>clique ici</button>.</div>
                  <div className={styles.recoveryForm}>
                    <input required value={recoverIdentifier} onChange={(e) => setRecoverIdentifier(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleRecoverAccess(); } }} placeholder="E-mail ou identifiant" autoComplete="username" aria-label="E-mail ou identifiant à récupérer" />
                    <button className={styles.secondary} type="button" onClick={() => void handleRecoverAccess()} disabled={recoverLoading || !recoverIdentifier.trim()}>{recoverLoading ? "Envoi…" : "Récupérer mes accès"}</button>
                  </div>
                  {recoverMessage ? <div className={styles.message} role="status">{recoverMessage}</div> : null}
                  {contactOpen ? (
                    <div className={styles.contactBlock}>
                      <div className={styles.contactIntro}>Remplis ce formulaire. La demande sera envoyée à ActiviTee.</div>
                      <div className={styles.contactGrid}>
                        <input value={contactFirstName} onChange={(e) => setContactFirstName(e.target.value)} placeholder="Prénom" aria-label="Prénom" />
                        <input value={contactLastName} onChange={(e) => setContactLastName(e.target.value)} placeholder="Nom" aria-label="Nom" />
                      </div>
                      <div className={styles.contactGrid}>
                        <input type="date" value={contactBirthDate} onChange={(e) => setContactBirthDate(e.target.value)} aria-label="Date de naissance" />
                        <input value={contactClub} onChange={(e) => setContactClub(e.target.value)} placeholder="Club" aria-label="Club" />
                      </div>
                      <button className={styles.secondary} type="button" onClick={() => void handleRecoverUsernameContact()} disabled={contactLoading || !contactFirstName.trim() || !contactLastName.trim() || !contactBirthDate.trim() || !contactClub.trim()}>{contactLoading ? "Envoi…" : "Envoyer la demande"}</button>
                      {contactMessage ? <div className={styles.message} role="status">{contactMessage}</div> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {isLocalDev ? <div className={styles.devLink}><Link href="/dev/impersonate">Mode dev : se connecter en tant qu’un autre utilisateur</Link></div> : null}
            </form>
          </div>
          <p className={styles.support}>Contact et support : info@activitee.golf</p>
        </section>
      </div>
    </main>
  );
}
