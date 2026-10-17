"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ScanFace, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import { biometricMessages } from "@/lib/i18n/biometricMessages";
import { biometricErrorKey, configureBiometricLock, getBiometricLockStatus, supportsNativeBiometricLock, syncBiometricSession, type BiometricLockStatus } from "@/lib/nativeBiometricLock";
import styles from "./BiometricLockSettings.module.css";

export default function BiometricLockSettings() {
  const { locale } = useI18n();
  const copy = biometricMessages[locale];
  const headingId = useId();
  const [status, setStatus] = useState<BiometricLockStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<"cancelled" | "unavailable" | "error" | null>(null);

  useEffect(() => {
    if (!supportsNativeBiometricLock()) return;
    let active = true;
    const refresh = async () => {
      try {
        const next = await getBiometricLockStatus();
        if (active) { setStatus(next); setFailed(false); }
      } catch { if (active) setFailed(true); }
    };
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  async function toggle() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      // Always bind the device preference to the signed-in adult/player, never to a selected child.
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw new Error("Authentication required");
      await syncBiometricSession(data.user.id, locale);
      const current = await getBiometricLockStatus();
      if (!current) throw new Error("Unavailable");
      const next = await configureBiometricLock(data.user.id, !current.enabled, locale);
      setStatus(next);
      setFailed(false);
    } catch (error) { setFeedback(biometricErrorKey(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (!status && !failed) return null;
  const method = status?.biometryType === "touchID" ? "Touch ID" : "Face ID";
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId}><ScanFace size={21} aria-hidden="true" />{copy.title}</h3>
      <p>{copy.description.replace("{method}", method)}</p>
      {status ? <p className={styles.status} role="status"><ShieldCheck size={16} aria-hidden="true" />{status.enabled ? copy.enabled : copy.disabled}</p> : null}
      {status && !status.available && !status.enabled ? <p>{copy.unavailable}</p> : null}
      {failed ? <p role="alert">{copy.error}</p> : null}
      <button className="btn" type="button" disabled={busy} onClick={() => void toggle()}>
        {busy ? copy.checking : status?.enabled ? copy.disable : copy.enable.replace("{method}", method)}
      </button>
      {feedback ? <p role={feedback === "cancelled" ? "status" : "alert"}>{copy[feedback]}</p> : null}
      <p className={styles.help}>{copy.privacy}</p>
    </section>
  );
}
