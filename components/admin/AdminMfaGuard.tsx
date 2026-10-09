"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { normalizeMfaQrDataUrl } from "@/lib/mfaQr";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import styles from "./AdminMfaGuard.module.css";

export default function AdminMfaGuard({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [challenge, setChallenge] = useState(false);
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const verifying = useRef(false);
  const gateOpen = useRef(true);
  const reauthChecking = useRef(false);
  const verificationVersion = useRef(0);
  const invalidateVerification = useCallback(() => ++verificationVersion.current, []);
  const input = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const check = useCallback(async (verifiedToken?: string) => {
    const token = verifiedToken ?? (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error("Session unavailable");
    const response = await fetch("/api/admin/security", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("Verification unavailable");
    return response.json() as Promise<{ mfa: boolean; recent: boolean }>;
  }, []);

  const loadFactors = useCallback(async () => {
    const result = await supabase.auth.mfa.listFactors();
    if (result.error) throw result.error;
    setFactorId(result.data.totp.find(factor => factor.status === "verified")?.id ?? "");
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await check();
        if (!active) return;
        gateOpen.current = !status.mfa;
        setAllowed(status.mfa);
        if (!status.mfa) await loadFactors();
      } catch { if (active) setError("security.unavailable"); }
      finally { if (active) setChecking(false); }
    })();
    const reauth = (event: Event) => {
      // Responses to requests using the old token can arrive after MFA succeeds.
      // Coalesce them and check the current session before opening another dialog.
      if (gateOpen.current || verifying.current || reauthChecking.current) return;
      reauthChecking.current = true;
      const version = verificationVersion.current;
      const reason = (event as CustomEvent<{ code?: string }>).detail?.code;
      void (async () => {
        try {
          const status = await check();
          if (!active || version !== verificationVersion.current || gateOpen.current) return;
          if (status.mfa && (reason === "ADMIN_MFA_REQUIRED" || status.recent)) return;
          gateOpen.current = true;
          setChallenge(true); setCode(""); setError("");
          await loadFactors();
        } catch {
          if (active && version === verificationVersion.current && !gateOpen.current) {
            gateOpen.current = true;
            setChallenge(true); setError("security.unavailable");
          }
        } finally { reauthChecking.current = false; }
      })();
    };
    window.addEventListener("admin:reauth-required", reauth);
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") {
        invalidateVerification(); gateOpen.current = true;
        setAllowed(false); setChallenge(false); setCode(""); setQr(""); setSecret(""); setBusy(false);
      }
    });
    return () => { active = false; invalidateVerification(); subscription.unsubscribe(); window.removeEventListener("admin:reauth-required", reauth); };
  }, [check, loadFactors, invalidateVerification]);

  useEffect(() => { if (!checking && (challenge || !allowed)) input.current?.focus(); }, [checking, challenge, allowed, factorId]);
  useEffect(() => {
    if (!challenge) return;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", trapFocus);
    return () => window.removeEventListener("keydown", trapFocus);
  }, [challenge]);

  async function enroll() {
    setBusy(true); setError("");
    try {
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      // Abandoned setup factors cannot expose their original secret again.
      for (const factor of factors.data.all.filter(f => f.factor_type === "totp" && f.status === "unverified" && f.friendly_name === "ActiviTee Admin")) {
        const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (removed.error) throw removed.error;
      }
      const result = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ActiviTee Admin", issuer: "ActiviTee" });
      if (result.error) throw result.error;
      setFactorId(result.data.id); setQr(normalizeMfaQrDataUrl(result.data.totp.qr_code)); setSecret(result.data.totp.secret);
    } catch { setError("security.setupFailed"); }
    finally { setBusy(false); }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (verifying.current) return;
    verifying.current = true;
    const version = invalidateVerification();
    setBusy(true); setError("");
    try {
      const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (version !== verificationVersion.current) return;
      if (verified.error) { setError("security.invalidCode"); return; }
      // Keep the same panel visible until the server confirms the newly issued token.
      const status = await check(verified.data.access_token);
      if (version !== verificationVersion.current) return;
      if (!status.mfa || !status.recent) throw new Error("Assurance unavailable");
      gateOpen.current = false;
      setAllowed(true); setChallenge(false); setCode(""); setQr(""); setSecret("");
    } catch { if (version === verificationVersion.current) setError("security.unavailable"); }
    finally {
      verifying.current = false;
      if (version === verificationVersion.current) setBusy(false);
    }
  }

  const panel = <section ref={panelRef} className={styles.card} aria-labelledby="admin-mfa-title">
    <div className={styles.heading}><ShieldCheck size={26} aria-hidden="true" /><h1 id="admin-mfa-title">{t("security.title")}</h1></div>
    <p>{t(challenge ? "security.reauthHelp" : "security.help")}</p>
    {checking ? <p role="status">{t("common.loading")}</p> : factorId ? <>
      {/* Supabase generates this data URL locally; the secret never goes to a third-party QR service. */}
      {qr ? <><Image unoptimized className={styles.qr} src={qr} width={200} height={200} alt={t("security.qrAlt")} /><p>{t("security.scanHelp")}</p><code className={styles.secret}>{secret}</code></> : null}
      <form className={styles.form} onSubmit={verify} aria-busy={busy}>
        <label className={styles.field}><span>{t("security.code")}</span><input ref={input} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy} /></label>
        <button className="cta-green" disabled={busy || code.length !== 6}>{t(busy ? "security.verifying" : "security.verify")}</button>
        {busy ? <p role="status">{t("security.verifyingHelp")}</p> : null}
      </form>
    </> : !error ? <button className="cta-green" onClick={enroll} disabled={busy}>{t(busy ? "common.loading" : "security.setup")}</button> : null}
    {error ? <div className={styles.error} role="alert">{t(error)}</div> : null}
    <div className={styles.actions}>
      {error ? <button className="btn" disabled={busy} onClick={() => window.location.reload()}>{t("security.retry")}</button> : null}
      <button className="btn" disabled={busy} onClick={() => void supabase.auth.signOut()}>{t("common.logout")}</button>
    </div>
    <p>{t("security.recovery")}</p>
  </section>;
  // Keep pending edits mounted during step-up, but make them inaccessible behind the modal.
  if (checking) return <main className={styles.gate} aria-busy="true"><p role="status">{t("common.loading")}</p></main>;
  if (allowed) return <><div inert={challenge} aria-hidden={challenge || undefined}>{children}</div>{challenge ? <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="admin-mfa-title">{panel}</div> : null}</>;
  return <main className={styles.gate}>{panel}</main>;
}
