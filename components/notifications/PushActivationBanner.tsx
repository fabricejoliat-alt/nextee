"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { loadMyNotificationPreferences, upsertMyNotificationPreferences } from "@/lib/notificationPreferences";
import { ensurePushSubscription, hasLocalPushSubscription, supportsPush, pushFailureMessage, pushPermission, isNativeApp } from "@/lib/pushClient";
import { readPushDecision, rememberPushDecision } from "@/lib/pushOnboarding";
import { useI18n } from "@/components/i18n/AppI18nProvider";

export default function PushActivationBanner({ settingsHref }: { settingsHref: string }) {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = useRef<string | null>(null);
  const activating = useRef(false);
  const isSettingsPage = pathname === settingsHref;

  useEffect(() => {
    let active = true;
    let revision = 0;
    setVisible(false);

    async function loadState() {
      if (activating.current || isSettingsPage) return;
      const current = ++revision;
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;
        if (!active || current !== revision) return;
        account.current = userId ?? null;
        if (!userId || !supportsPush()) { setVisible(false); return; }
        const isIOSBrowser = /iPad|iPhone|iPod/.test(navigator.userAgent) && !isNativeApp();
        const standalone = window.matchMedia?.("(display-mode: standalone)").matches ||
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
        if (isIOSBrowser && !standalone) { setVisible(false); return; }
        const prefs = await loadMyNotificationPreferences(userId);
        if (!active || current !== revision) return;
        const decision = readPushDecision(userId);
        if (!prefs.receiveInApp || decision === "declined" || (decision === "accepted" && !prefs.receivePush)) {
          setVisible(false); return;
        }
        const permission = await pushPermission();
        if (!active || current !== revision) return;
        if (permission === "denied") { setVisible(false); return; }
        if (prefs.receivePush && permission === "granted") {
          const subscribed = await hasLocalPushSubscription().catch(() => false);
          if (!active || current !== revision) return;
          if (subscribed) { setVisible(false); return; }
        }
        if (active && current === revision && readPushDecision(userId) !== "declined") setVisible(true);
      } catch { if (active && current === revision) setVisible(false); }
    }

    void loadState();
    const onVisibility = () => { if (document.visibilityState === "visible") void loadState(); };
    const { data: auth } = supabase.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { revision++; account.current = null; setVisible(false); }
      else if (event === "SIGNED_IN") setTimeout(() => { if (active) void loadState(); }, 0);
    });
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; auth.subscription.unsubscribe(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [locale, isSettingsPage]);

  function decline() {
    if (activating.current) return;
    if (account.current) rememberPushDecision(account.current, "declined");
    setVisible(false);
  }

  async function activate() {
    const userId = account.current;
    if (!userId || activating.current) return;
    activating.current = true;
    setBusy(true); setError(null);
    try {
      const result = await ensurePushSubscription({ prompt: true });
      if (!result.ok) throw new Error(t(pushFailureMessage(result.reason)));
      const { data } = await supabase.auth.getUser();
      if (data.user?.id !== userId) throw new Error(t("notifications.settings.pushSessionExpired"));
      await upsertMyNotificationPreferences(userId, { receivePush: true });
      rememberPushDecision(userId, "accepted");
      setVisible(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("notifications.settings.pushError"));
    } finally { activating.current = false; setBusy(false); }
  }

  if (!visible || isSettingsPage) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1400, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 18, background: "rgba(8,12,10,0.28)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="push-activation-title" style={{ width: "min(100%,520px)", borderRadius: 20,
        padding: 18, background: "#ffffff", color: "#111827", border: "1px solid rgba(32,99,62,0.18)",
        boxShadow: "0 22px 60px rgba(0,0,0,0.28)", display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div id="push-activation-title" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
            <BellRing size={16} />{t("notifications.onboarding.title")}
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "rgba(0,0,0,0.70)", lineHeight: 1.5 }}>{t("notifications.onboarding.body")}</p>
          {error ? <div className="marketplace-error" role="alert" style={{ marginTop: 0 }}>{error}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="btn" disabled={busy} onClick={decline}>{t("notifications.onboarding.no")}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void activate()}>
            {t(busy ? "notifications.onboarding.activating" : "notifications.onboarding.yes")}
          </button>
        </div>
      </div>
    </div>
  );
}
