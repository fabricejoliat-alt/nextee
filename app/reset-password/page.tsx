"use client";

import { isValidPassword } from "@/lib/passwordPolicy";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { passwordRecoveryUrl, supabase } from "@/lib/supabaseClient";
import { createPasswordRecoveryClient } from "@/lib/passwordRecovery";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  const recoveryClient = useRef<SupabaseClient | null>(null);
  const preparation = useRef<Promise<Status> | null>(null);

  const canSubmit = useMemo(() => isValidPassword(password) && confirmPassword.length >= 6 && !saving, [password, confirmPassword, saving]);

  useEffect(() => {
    let active = true;

    async function prepare(): Promise<Status> {
      const url = new URL(passwordRecoveryUrl ?? window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash") ?? hash.get("token_hash");
      const type = url.searchParams.get("type") ?? hash.get("type") ?? "recovery";
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const hasCredentials = Boolean(inviteToken || code || tokenHash || accessToken || refreshToken);
      // Copy the PKCE verifier before clearing the application's cookies.
      const client = hasCredentials && !inviteToken ? await createPasswordRecoveryClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, document.cookie,
      ) : null;

      if (hasCredentials) {
        const signedOut = await supabase.auth.signOut({ scope: "local" });
        if (signedOut.error) throw signedOut.error;
      }
      if (inviteToken) {
        const res = await fetch(`/api/auth/invitation-reset?token=${encodeURIComponent(inviteToken)}`, { cache: "no-store" });
        return res.ok ? "ready" : "invalid";
      }
      if (!hasCredentials) {
        // Existing signed-in users may still choose a password directly.
        return (await supabase.auth.getSession()).data.session ? "ready" : "invalid";
      }
      recoveryClient.current = client;
      const result = accessToken && refreshToken
        ? await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        : code ? await client.auth.exchangeCodeForSession(code)
        : tokenHash && ["recovery", "invite"].includes(type)
          ? await client.auth.verifyOtp({ token_hash: tokenHash, type: type as "recovery" | "invite" })
          : null;
      return result && !result.error && result.data.session ? "ready" : "invalid";
    }

    // React Strict Mode must not consume a one-time recovery link twice.
    preparation.current ??= prepare();
    void preparation.current.then(status => {
      if (active) setStatus(status);
    }).catch(() => {
      if (active) setStatus("invalid");
    });
    return () => { active = false; };
  }, [inviteToken]);

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

      const passwordClient = recoveryClient.current ?? supabase;
      const current = (await passwordClient.auth.getSession()).data.session;
      if (current?.user.app_metadata?.initial_password_required === true) {
        const changed = await fetch("/api/auth/initial-password", { method: "POST",
          headers: { Authorization: `Bearer ${current.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ password, confirmPassword }), cache: "no-store" });
        if (!changed.ok) { setError("Choisissez un mot de passe d’au moins 6 caractères, avec une majuscule et un caractère spécial."); return; }
        const refreshed = await passwordClient.auth.refreshSession();
        if (refreshed.error) { setError(translateAuthMessage(refreshed.error.message)); return; }
      } else {
        const { error: updateError } = await passwordClient.auth.updateUser({ password });
        if (updateError) {
          setError(translateAuthMessage(updateError.message));
          return;
        }
      }

      // Publish the session to application cookies only after the password is saved.
      if (recoveryClient.current) {
        const session = (await passwordClient.auth.getSession()).data.session;
        if (!session) throw new Error("Recovery session expired");
        const promoted = await supabase.auth.setSession({
          access_token: session.access_token, refresh_token: session.refresh_token,
        });
        if (promoted.error) throw promoted.error;
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
                  minLength={6}
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
                  minLength={6}
                  required
                />
              </div>

              {error ? <div className="auth-error">{error}</div> : null}

              <button className="cta-green auth-submit" type="submit" disabled={!canSubmit}>
                {saving ? "Enregistrement…" : "Définir mon mot de passe"}
              </button>

              <div className="auth-footnote">
                Utilise au moins 6 caractères, une majuscule et un caractère spécial. Une fois validé, tu seras redirigé automatiquement vers ton espace.
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
