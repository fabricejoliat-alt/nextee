"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

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
    <div className="auth-bg">
      <div className="auth-shell">
        <div style={{ width: "100%", maxWidth: 420, display: "grid", gap: 14 }}>
          <div className="auth-card">
            <div className="auth-brand-wrapper">
              <div className="auth-brand auth-brand--dark">
                <span className="auth-brand-nex">Activi</span>
                <span className="auth-brand-tee">Tee</span>
              </div>
              <div className="auth-tagline">Organize. Track. Develop.</div>
            </div>

            <form onSubmit={handleLogin} className="auth-form">
              <div className="field auth-field">
                <label>Email ou username</label>
                <input
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                />
              </div>

              <div className="field auth-field">
                <label>Mot de passe</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>

            {error && <div className="auth-error">{error}</div>}

            <button className="cta-green auth-submit" type="submit" disabled={loading}>
              {loading ? "Connexion…" : "Se connecter"}
            </button>

            <button
              type="button"
              className="btn"
              onClick={() => {
                setRecoverOpen((current) => !current);
                setRecoverMessage(null);
                setContactOpen(false);
                setContactMessage(null);
              }}
            >
              Identifiant ou mot de passe oublié ?
            </button>

            {recoverOpen ? (
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(0,0,0,0.08)",
                  background: "rgba(255,255,255,0.72)",
                }}
              >
                <div style={{ fontSize: 13, color: "rgba(0,0,0,0.66)", fontWeight: 700 }}>
                  Saisis ton e-mail ou ton username. Si tu es junior et que tu n’as pas d'adresse e-mail, le lien de récupération sera envoyé à tes parents. Si tu ne te souviens pas de ton username,{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setContactOpen((current) => !current);
                      setContactMessage(null);
                    }}
                    style={{
                      border: 0,
                      background: "transparent",
                      padding: 0,
                      margin: 0,
                      color: "rgba(15,118,110,1)",
                      fontWeight: 900,
                      textDecoration: "underline",
                      cursor: "pointer",
                    }}
                  >
                    clique ici
                  </button>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  <input
                    required
                    className="input"
                    value={recoverIdentifier}
                    onChange={(e) => setRecoverIdentifier(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleRecoverAccess();
                      }
                    }}
                    placeholder="Email ou username"
                    autoComplete="username"
                  />
                  <button className="btn" type="button" onClick={() => void handleRecoverAccess()} disabled={recoverLoading || !recoverIdentifier.trim()}>
                    {recoverLoading ? "Envoi…" : "Récupérer mes accès"}
                  </button>
                </div>
                {recoverMessage ? <div className="auth-footnote" style={{ marginTop: 0 }}>{recoverMessage}</div> : null}

                {contactOpen ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      paddingTop: 10,
                      borderTop: "1px solid rgba(0,0,0,0.08)",
                    }}
                  >
                    <div style={{ fontSize: 13, color: "rgba(0,0,0,0.66)", fontWeight: 700 }}>
                      Remplis ce formulaire. La demande sera envoyée à ActiviTee.
                    </div>
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                      <input
                        className="input"
                        value={contactFirstName}
                        onChange={(e) => setContactFirstName(e.target.value)}
                        placeholder="Prénom"
                      />
                      <input
                        className="input"
                        value={contactLastName}
                        onChange={(e) => setContactLastName(e.target.value)}
                        placeholder="Nom"
                      />
                    </div>
                    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                      <input
                        type="date"
                        className="input"
                        value={contactBirthDate}
                        onChange={(e) => setContactBirthDate(e.target.value)}
                      />
                      <input
                        className="input"
                        value={contactClub}
                        onChange={(e) => setContactClub(e.target.value)}
                        placeholder="Club"
                      />
                    </div>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => void handleRecoverUsernameContact()}
                      disabled={
                        contactLoading ||
                        !contactFirstName.trim() ||
                        !contactLastName.trim() ||
                        !contactBirthDate.trim() ||
                        !contactClub.trim()
                      }
                    >
                      {contactLoading ? "Envoi…" : "Envoyer la demande"}
                    </button>
                    {contactMessage ? <div className="auth-footnote" style={{ marginTop: 0 }}>{contactMessage}</div> : null}
                  </div>
                ) : null}
              </div>
            ) : null}

              {isLocalDev ? (
                <div className="auth-footnote">
                  <Link href="/dev/impersonate">Mode dev: se connecter en tant qu’un autre utilisateur</Link>
                </div>
              ) : null}
            </form>
          </div>
          <div className="auth-footnote" style={{ color: "rgba(255,255,255,0.88)", textAlign: "center", marginTop: 0 }}>
          Contact et support: info@activitee.golf
          </div>
        </div>
      </div>
    </div>
  );
}
