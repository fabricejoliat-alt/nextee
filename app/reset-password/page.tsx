"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Status = "loading" | "ready" | "invalid" | "success";

function translateAuthMessage(message: string) {
  if (message === "New password should be different from the old password.") {
    return "Le nouveau mot de passe doit être différent de l’ancien.";
  }
  return message;
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inviteToken = searchParams.get("invite_token");

  const canSubmit = useMemo(() => password.length >= 8 && confirmPassword.length >= 8 && !saving, [password, confirmPassword, saving]);

  useEffect(() => {
    let active = true;
    let timeoutId: number | null = null;

    async function checkSession() {
      if (inviteToken) {
        await supabase.auth.signOut({ scope: "local" });
        if (!active) return;
        const res = await fetch(`/api/auth/invitation-reset?token=${encodeURIComponent(inviteToken)}`, {
          cache: "no-store",
        });
        if (!active) return;
        setStatus(res.ok ? "ready" : "invalid");
        return;
      }

      const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
      const hashParams = new URLSearchParams(hash);
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      const hashAccessToken = hashParams.get("access_token");
      const hashRefreshToken = hashParams.get("refresh_token");
      const hashType = hashParams.get("type");

      if (hashAccessToken && hashRefreshToken) {
        const setSessionRes = await supabase.auth.setSession({
          access_token: hashAccessToken,
          refresh_token: hashRefreshToken,
        });
        if (!active) return;
        if (!setSessionRes.error && setSessionRes.data.session) {
          setStatus("ready");
          return;
        }
      }

      if (code) {
        const exchange = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (!exchange.error && exchange.data.session) {
          setStatus("ready");
          return;
        }
      }

      if (tokenHash && type) {
        const verify = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as any,
        });
        if (!active) return;
        if (!verify.error && verify.data.session) {
          setStatus("ready");
          return;
        }
      }

      if (tokenHash && !type) {
        const verify = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (!active) return;
        if (!verify.error && verify.data.session) {
          setStatus("ready");
          return;
        }
      }

      if (hashType === "recovery" && tokenHash) {
        const verify = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });
        if (!active) return;
        if (!verify.error && verify.data.session) {
          setStatus("ready");
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) {
        setStatus("ready");
        return;
      }

      timeoutId = window.setTimeout(async () => {
        const retry = await supabase.auth.getSession();
        if (!active) return;
        setStatus(retry.data.session ? "ready" : "invalid");
      }, 1200);
    }

    void checkSession();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session) {
        setStatus("ready");
      }
    });

    return () => {
      active = false;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      sub.subscription.unsubscribe();
    };
  }, [searchParams, inviteToken]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (password !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (inviteToken) {
        await supabase.auth.signOut({ scope: "local" });
        const resetRes = await fetch("/api/auth/invitation-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: inviteToken, password }),
        });
        const resetJson = await resetRes.json().catch(() => ({}));
        if (!resetRes.ok) {
          setError(String(resetJson?.error ?? "Impossible de définir le mot de passe."));
          return;
        }

        if (!resetJson?.email) {
          setStatus("success");
          router.replace("/");
          return;
        }

        const signInRes = await supabase.auth.signInWithPassword({
          email: String(resetJson.email),
          password,
        });
        if (signInRes.error || !signInRes.data.session) {
          setStatus("success");
          router.replace("/");
          return;
        }

        const accessToken = signInRes.data.session.access_token;
        const redirectRes = await fetch("/api/auth", {
          method: "POST",
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        const redirectJson = await redirectRes.json().catch(() => ({}));
        const destination = redirectRes.ok ? String(redirectJson?.redirectTo ?? "/player") : "/player";
        setStatus("success");
        router.replace(destination);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(translateAuthMessage(updateError.message));
        return;
      }

      const sessionRes = await supabase.auth.getSession();
      const accessToken = sessionRes.data.session?.access_token ?? "";
      if (!accessToken) {
        setStatus("success");
        router.replace("/");
        return;
      }

      const redirectRes = await fetch("/api/auth", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const redirectJson = await redirectRes.json().catch(() => ({}));
      const destination = redirectRes.ok ? String(redirectJson?.redirectTo ?? "/player") : "/player";
      setStatus("success");
      router.replace(destination);
    } catch {
      setError("Impossible de définir le mot de passe.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-shell">
        <div className="auth-card" style={{ display: "grid", gap: 14 }}>
          <div className="auth-brand-wrapper" style={{ marginBottom: 0 }}>
            <div className="auth-brand auth-brand--dark">
              <span className="auth-brand-nex">Activi</span>
              <span className="auth-brand-tee">Tee</span>
            </div>
            <div className="auth-tagline">Définition du mot de passe</div>
          </div>

          {status === "loading" ? (
            <div className="auth-footnote" style={{ fontSize: 13 }}>Validation du lien sécurisé…</div>
          ) : null}

          {status === "invalid" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div className="auth-error">Ce lien est invalide ou expiré.</div>
              <div className="auth-footnote" style={{ marginTop: 0 }}>
                Demande un nouvel e-mail d’accès depuis le manager ou reconnecte-toi avec un lien plus récent.
              </div>
              <Link href="/" className="cta-green auth-submit" style={{ textDecoration: "none", textAlign: "center", padding: "12px 14px" }}>
                Retour à la connexion
              </Link>
            </div>
          ) : null}

          {status === "ready" || status === "success" ? (
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="field auth-field">
                <label>Nouveau mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <div className="field auth-field">
                <label>Confirmer le mot de passe</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              {error ? <div className="auth-error">{error}</div> : null}

              <button className="cta-green auth-submit" type="submit" disabled={!canSubmit}>
                {saving ? "Enregistrement…" : "Définir mon mot de passe"}
              </button>

              <div className="auth-footnote">
                Utilise au minimum 8 caractères. Une fois validé, tu seras redirigé automatiquement vers ton espace.
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
