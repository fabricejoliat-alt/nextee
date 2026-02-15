"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/utils/supabase/client";

export default function AuthTest() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  const canSubmit = useMemo(() => {
    return email.trim().length > 3 && password.length >= 6;
  }, [email, password]);

  const signUp = async () => {
    setMsg("Création du compte...");
    const { error } = await supabase.auth.signUp({ email, password });
    setMsg(error ? `❌ ${error.message}` : "✅ Compte créé. Tu peux maintenant te connecter.");
  };

  const signIn = async () => {
    setMsg("Connexion...");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? `❌ ${error.message}` : "✅ Connecté");
  };

  const whoAmI = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) return setMsg(`❌ ${error.message}`);
    setMsg(data.user ? `✅ UID: ${data.user.id}` : "❌ Pas connecté");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setMsg("✅ Déconnecté");
  };

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.header}>
          <div style={styles.title}>Golf App Junior</div>
          <div style={styles.subtitle}>Connexion / Création de compte (test)</div>
        </div>

        <div style={styles.form}>
          <label style={styles.label}>
            Email
            <input
              style={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ex: fabrice@email.com"
              autoComplete="email"
            />
          </label>

          <label style={styles.label}>
            Mot de passe
            <input
              style={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min. 6 caractères"
              type="password"
              autoComplete="current-password"
            />
          </label>

          <div style={styles.row}>
            <button style={styles.btn} disabled={!canSubmit} onClick={signUp}>
              Créer compte
            </button>
            <button style={styles.btnPrimary} disabled={!canSubmit} onClick={signIn}>
              Se connecter
            </button>
          </div>

          <div style={styles.row}>
            <button style={styles.btnGhost} onClick={whoAmI}>
              Afficher UID
            </button>
            <button style={styles.btnGhost} onClick={signOut}>
              Se déconnecter
            </button>
          </div>

          <div style={styles.hint}>
            Astuce: utilise un mot de passe d’au moins 6 caractères.
          </div>

          {msg ? <div style={styles.message}>{msg}</div> : null}
        </div>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#f6f7f9",
    color: "#111827",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
  },
  card: {
    width: "100%",
    maxWidth: 440,
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
    overflow: "hidden",
  },
  header: {
    padding: "18px 18px 0 18px",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: "#6b7280",
  },
  form: {
    padding: 18,
    display: "grid",
    gap: 12,
  },
  label: {
    display: "grid",
    gap: 6,
    fontSize: 13,
    color: "#374151",
    fontWeight: 600,
  },
  input: {
    height: 42,
    padding: "0 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    outline: "none",
  },
  row: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  btn: {
    height: 42,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#111827",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnPrimary: {
    height: 42,
    padding: "0 14px",
    borderRadius: 10,
    border: "1px solid #111827",
    background: "#111827",
    color: "#ffffff",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnGhost: {
    height: 40,
    padding: "0 12px",
    borderRadius: 10,
    border: "1px solid transparent",
    background: "transparent",
    color: "#111827",
    fontWeight: 700,
    cursor: "pointer",
  },
  hint: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  message: {
    marginTop: 6,
    padding: 12,
    borderRadius: 10,
    background: "#f3f4f6",
    border: "1px solid #e5e7eb",
    fontSize: 13,
    whiteSpace: "pre-wrap",
  },
};
