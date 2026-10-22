"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ScanFace } from "lucide-react";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import { initialPasswordRequired } from "@/lib/adminSecurity";
import { claimBiometricInvitation } from "@/lib/biometricInvitation";
import { biometricMessages } from "@/lib/i18n/biometricMessages";
import { biometricErrorKey, configureBiometricLock, getBiometricLockStatus, supportsNativeBiometricLock, syncBiometricSession, type BiometricLockStatus } from "@/lib/nativeBiometricLock";
import styles from "./BiometricLockInvitation.module.css";

/** Mounted inside each role guard, after authentication and required access checks. */
export default function BiometricLockInvitation() {
  const { locale } = useI18n();
  const copy = biometricMessages[locale];
  const titleId = useId();
  const [offer, setOffer] = useState<{ userID: string; biometryType: BiometricLockStatus["biometryType"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<"cancelled" | "unavailable" | "error" | null>(null);
  const busyRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!supportsNativeBiometricLock()) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentUserID: string | null = null;
    const invalidateRequests = () => ++generation.current;
    const check = async (version: number) => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!active || version !== generation.current || error || !data.user || initialPasswordRequired(data.user)) return;
        currentUserID = data.user.id;
        const status = await getBiometricLockStatus();
        if (!active || version !== generation.current || document.visibilityState !== "visible") return;
        if (claimBiometricInvitation(data.user.id, status, window.localStorage)) {
          setOffer({ userID: data.user.id, biometryType: status!.biometryType });
        }
      } catch { /* An optional invitation must never prevent access to the app. */ }
    };
    const schedule = () => {
      const version = invalidateRequests();
      clearTimeout(timer);
      // Leave the Supabase auth callback before asking it for the verified user.
      timer = setTimeout(() => void check(version), 0);
    };
    schedule();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (session?.user.id && session.user.id !== currentUserID)) {
        invalidateRequests();
        clearTimeout(timer);
        currentUserID = session?.user.id ?? null;
        setOffer(null); setBusy(false); setFeedback(null); busyRef.current = false;
        if (event !== "SIGNED_OUT" && currentUserID) schedule();
      }
    });
    return () => { active = false; invalidateRequests(); clearTimeout(timer); subscription.unsubscribe(); };
  }, []);

  async function enable() {
    if (!offer || busyRef.current) return;
    const version = generation.current;
    busyRef.current = true; setBusy(true); setFeedback(null);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (version !== generation.current) return;
      if (error || data.user?.id !== offer.userID) throw new Error("Session changed");
      await syncBiometricSession(offer.userID, locale);
      if (version !== generation.current) return;
      const result = await configureBiometricLock(offer.userID, true, locale);
      if (version !== generation.current) return;
      if (!result.enabled) throw new Error("Not enabled");
      setOffer(null);
    } catch (error) {
      if (version === generation.current) setFeedback(biometricErrorKey(error));
    } finally {
      if (version === generation.current) { busyRef.current = false; setBusy(false); }
    }
  }

  if (!offer) return null;
  const method = offer.biometryType === "faceID" ? "Face ID" : offer.biometryType === "touchID" ? "Touch ID" : copy.biometricMethod;
  return <AccessibleDialog labelledBy={titleId} onClose={() => { if (!busyRef.current) setOffer(null); }} className={styles.dialog}>
    <ScanFace className={styles.icon} size={32} aria-hidden="true" />
    <h2 id={titleId}>{copy.invitationTitle.replace("{method}", method)}</h2>
    <p>{copy.invitationDescription.replace("{method}", method)}</p>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={busy} onClick={() => void enable()}>{busy ? copy.checking : copy.enable.replace("{method}", method)}</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => setOffer(null)}>{copy.later}</button>
    </div>
    {feedback ? <p role={feedback === "cancelled" ? "status" : "alert"}>{copy[feedback]}</p> : null}
  </AccessibleDialog>;
}
