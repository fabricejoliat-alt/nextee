"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

  if (!visible) return null;

  return (
    <div className="glass-section" style={{ paddingTop: 0 }}>
      <div
        className="glass-card"
        style={{
          display: "grid",
          gap: 10,
          border: "1px solid rgba(32,99,62,0.20)",
          background: "rgba(255,255,255,0.92)",
        }}
      >
        <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950 }}>
              <BellRing size={16} />
              {tr("Activer les notifications push", "Enable push notifications")}
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.66)", lineHeight: 1.45 }}>
              {unsupported
                ? tr(
                    "Le push PWA n'est pas supporté sur cet appareil ou ce navigateur. Sur Android, installe et ouvre de préférence ActiviTee depuis Chrome.",
                    "PWA push is not supported on this device or browser. On Android, install and open ActiviTee from Chrome if possible."
                  )
                : denied
                ? tr(
                    "Les notifications sont activées sur ton compte, mais refusées sur cet appareil. Autorise-les dans Android / le navigateur, puis reviens ici.",
                    "Notifications are enabled on your account, but blocked on this device. Allow them in Android / the browser, then come back here."
                  )
                : tr(
                    "Les notifications push sont actives sur ton compte, mais pas encore sur cet appareil. Termine l'activation pour recevoir les alertes.",
                    "Push notifications are enabled on your account, but not yet on this device. Complete activation to receive alerts."
                  )}
            </div>
            {error ? <div className="marketplace-error" style={{ marginTop: 2 }}>{error}</div> : null}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!unsupported && !denied ? (
              <button type="button" className="btn btn-primary" onClick={() => void activate()} disabled={busy}>
                {busy ? tr("Activation…", "Activating...") : tr("Activer maintenant", "Activate now")}
              </button>
            ) : null}
            <Link className="btn" href={settingsHref}>
              {tr("Paramètres notifications", "Notification settings")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
