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

    if (error || !data.session?.access_token) {
      setError(error?.message ?? "Erreur de connexion.");
      setLoading(false);
      return;
    }

    // ✅ Demande au serveur (service role) où rediriger
    const res = await fetch("/api/auth", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${data.session.access_token}`, // <- A majuscule (plus robuste)
  },
});

const json = await res.json().catch(() => ({}));

if (!res.ok) {
  setError(json?.error ?? `Erreur serveur auth (${res.status})`);
  setLoading(false);
  return;
}

router.push(json?.redirectTo || "/player");

  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand-wrapper">
          <div className="login-brand">
            <span className="brand-nex">Nex</span>
            <span className="brand-tee">Tee</span>
          </div>
          <div className="login-tagline">Junior Golf Platform</div>
        </div>

        <form onSubmit={handleLogin} className="login-form">
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Mot de passe</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
