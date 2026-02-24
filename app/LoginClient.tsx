"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      setError(error?.message ?? "Erreur de connexion.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/auth", { method: "POST" });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(json?.error ?? `Erreur serveur auth (${res.status})`);
      setLoading(false);
      return;
    }

    router.push(json?.redirectTo || "/player");
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
            <div className="auth-tagline">Junior Golf Platform</div>
          </div>

          <form onSubmit={handleLogin} className="auth-form">
            <div className="field auth-field">
              <label>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
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
