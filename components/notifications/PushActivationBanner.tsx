"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { loadMyNotificationPreferences } from "@/lib/notificationPreferences";
import { ensurePushSubscription, hasLocalPushSubscription, supportsWebPush } from "@/lib/pushClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type Props = {
  settingsHref: string;
};

export default function PushActivationBanner({ settingsHref }: Props) {
  const { locale } = useI18n();
  const pathname = usePathname();
  const tr = (fr: string, en: string, de?: string, it?: string) => {
    if (locale === "fr") return fr;
    if (locale === "de") return de ?? en;
    if (locale === "it") return it ?? en;
    return en;
  };

  const [visible, setVisible] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches ||
      window.matchMedia?.("(display-mode: fullscreen)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const isSettingsPage = pathname === settingsHref;
  const shouldHideOnIOSBrowser = isIOS && !isStandalone;

  useEffect(() => {
    if (isSettingsPage) setVisible(false);
  }, [isSettingsPage]);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const authRes = await supabase.auth.getUser();
        const userId = authRes.data.user?.id;
        if (!userId || cancelled) return;

        const prefs = await loadMyNotificationPreferences(userId);
        if (cancelled) return;
        if (!prefs.receiveInApp || !prefs.receivePush) {
          setVisible(false);
          return;
        }

        if (!supportsWebPush()) {
          setUnsupported(true);
          setVisible(true);
          return;
        }

        const permission = typeof Notification !== "undefined" ? Notification.permission : "default";
        setDenied(permission === "denied");

        const hasSubscription = await hasLocalPushSubscription().catch(() => false);
        if (cancelled) return;
        setVisible(permission !== "granted" || !hasSubscription);
      } catch {
        if (!cancelled) setVisible(false);
      }
    }

    void loadState();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadState();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const res = await ensurePushSubscription({ prompt: true });
      if (!res.ok) {
        if (res.reason === "denied") {
          setDenied(true);
          throw new Error(
            tr(
              "Autorise les notifications dans Android et dans le navigateur, puis réessaie.",
              "Allow notifications in Android and in the browser, then try again."
            )
          );
        }
        throw new Error(
          tr(
            "Impossible d'activer le push sur cet appareil.",
            "Could not enable push on this device."
          )
        );
      }
      setVisible(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : tr("Activation impossible.", "Activation failed."));
    } finally {
      setBusy(false);
    }
  }

  if (!visible || isSettingsPage || shouldHideOnIOSBrowser) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        background: "rgba(8, 12, 10, 0.28)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          width: "min(100%, 520px)",
          borderRadius: 20,
          padding: 18,
          background: "#ffffff",
          color: "#111827",
          border: "1px solid rgba(32,99,62,0.18)",
          boxShadow: "0 22px 60px rgba(0,0,0,0.28)",
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
            <BellRing size={16} />
            {tr("Activer les notifications push", "Enable push notifications")}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "rgba(0,0,0,0.70)", lineHeight: 1.5 }}>
            {unsupported
              ? tr(
                  isIOS
                    ? "Les notifications push ne sont pas encore actives sur cet appareil. Sur iPhone/iPad, utilise de préférence ActiviTee depuis l’app installée sur l’écran d’accueil, puis vérifie les autorisations de notifications."
                    : "Le push PWA n'est pas supporté sur cet appareil ou ce navigateur. Sur Android, installe et ouvre de préférence ActiviTee depuis Chrome.",
                  isIOS
                    ? "Push notifications are not active yet on this device. On iPhone/iPad, use ActiviTee from the app installed on the home screen, then check notification permissions."
                    : "PWA push is not supported on this device or browser. On Android, install and open ActiviTee from Chrome if possible."
                )
              : denied
              ? tr(
                  isIOS
                    ? "Les notifications sont activées sur ton compte, mais refusées sur cet appareil. Autorise-les dans Réglages iPhone / navigateur, puis reviens ici."
                    : "Les notifications sont activées sur ton compte, mais refusées sur cet appareil. Autorise-les dans Android / le navigateur, puis reviens ici.",
                  isIOS
                    ? "Notifications are enabled on your account, but blocked on this device. Allow them in iPhone Settings / browser, then come back here."
                    : "Notifications are enabled on your account, but blocked on this device. Allow them in Android / the browser, then come back here."
                )
              : tr(
                  "Les notifications push sont actives sur ton compte, mais pas encore sur cet appareil. Termine l'activation pour recevoir les alertes.",
                  "Push notifications are enabled on your account, but not yet on this device. Complete activation to receive alerts."
                )}
          </div>
          {error ? <div className="marketplace-error" style={{ marginTop: 0 }}>{error}</div> : null}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {!unsupported && !denied ? (
            <button type="button" className="btn btn-primary" onClick={() => void activate()} disabled={busy}>
              {busy ? tr("Activation…", "Activating...") : tr("Activer maintenant", "Activate now")}
            </button>
          ) : null}
          <Link className="btn" href={settingsHref} onClick={() => setVisible(false)}>
            {tr("Paramètres notifications", "Notification settings")}
          </Link>
        </div>
      </div>
    </div>
  );
}
