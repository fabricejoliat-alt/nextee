"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import AppI18nProvider, { useI18n } from "@/components/i18n/AppI18nProvider";

function InitialPasswordForm() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) { window.location.assign("/login"); return; }
      const response = await fetch("/api/auth/initial-password", { method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword: confirmation }), cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "security.unavailable"); return; }
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) throw refreshed.error;
      setPassword(""); setConfirmation(""); window.location.assign("/");
    } catch { setError("security.unavailable"); }
    finally { setBusy(false); }
  }
  return <div className="auth-bg"><main className="auth-shell"><section className="auth-card">
    <div className="auth-brand-wrapper"><div className="auth-brand auth-brand--dark"><span className="auth-brand-nex">Activi</span><span className="auth-brand-tee">Tee</span></div></div>
    <h1>{t("security.passwordTitle")}</h1><p className="auth-footnote">{t("security.passwordHelp")}</p>
    <form className="auth-form" onSubmit={submit}>
      <div className="field auth-field"><label htmlFor="initial-password">{t("security.newPassword")}</label><input id="initial-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy}/></div>
      <div className="field auth-field"><label htmlFor="initial-password-confirmation">{t("security.confirmPassword")}</label><input id="initial-password-confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy}/></div>
      {error ? <p className="auth-error" role="alert">{t(error)}</p> : null}
      <button className="cta-green auth-submit" disabled={busy || password.length < 12 || password !== confirmation}>{t(busy ? "common.loading" : "security.savePassword")}</button>
      <button className="btn" type="button" disabled={busy} onClick={() => void supabase.auth.signOut().then(() => window.location.assign("/login"))}>{t("common.logout")}</button>
    </form>
  </section></main></div>;
}

export default function InitialPasswordPage() { return <AppI18nProvider><InitialPasswordForm/></AppI18nProvider>; }
