"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

      const res = await fetch("/api/auth", { method: "POST" });
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

  return (
    <div className="auth-bg">
      <div className="auth-shell">
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

            <div className="auth-footnote">
              En cas de souci, contacte ton coach/club pour réinitialiser l’accès.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
