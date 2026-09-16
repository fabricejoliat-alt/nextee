"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, BellRing, ChevronRight, Settings, Smartphone } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import campsStyles from "@/app/manager/camps/Camps.module.css";
import styles from "@/components/notifications/NotificationSettings.module.css";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_KIND_OPTIONS,
  loadMyNotificationPreferences,
  upsertMyNotificationPreferences,
} from "@/lib/notificationPreferences";
import { disablePushSubscription, ensurePushSubscription, supportsWebPush } from "@/lib/pushClient";

type Props = {
  homeHref: string;
  notificationsHref: string;
  /** Lets Coach use the Manager page chrome without inheriting Manager-only data rules. */
  designVariant?: "management" | "player";
  titleFr: string;
  titleEn: string;
  titleDe: string;
  titleIt: string;
};

export default function NotificationSettings({ homeHref, notificationsHref, designVariant, titleFr, titleEn, titleDe, titleIt }: Props) {
  const { locale, t } = useI18n();
  const managerDesign = designVariant === "management" || homeHref === "/manager";
  const managerScope = homeHref === "/manager";
  const hideThreadNotifications = managerScope || homeHref === "/player";
  const areaLabel = managerScope ? "Manager" : homeHref === "/coach" ? "Coach" : "Player";
  const tr = (fr: string, en: string, de?: string, it?: string) => {
    if (locale === "fr") return fr;
    if (locale === "de") return de ?? en;
    if (locale === "it") return it ?? en;
    return en;
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");

  const [receiveInApp, setReceiveInApp] = useState(DEFAULT_NOTIFICATION_PREFERENCES.receiveInApp);
  const [receivePush, setReceivePush] = useState(DEFAULT_NOTIFICATION_PREFERENCES.receivePush);
  const [enabledKinds, setEnabledKinds] = useState<string[]>([]);

  const pushSupported = useMemo(() => supportsWebPush(), []);
  const notificationKindOptions = useMemo(
    () => hideThreadNotifications ? NOTIFICATION_KIND_OPTIONS.filter((option) => option.kind !== "thread_message") : NOTIFICATION_KIND_OPTIONS,
    [hideThreadNotifications]
  );
  const selectedKindsSet = useMemo(() => new Set(enabledKinds), [enabledKinds]);
  const allKindIds = useMemo(() => notificationKindOptions.map((option) => option.kind), [notificationKindOptions]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const uRes = await supabase.auth.getUser();
        if (uRes.error || !uRes.data.user) throw new Error(tr("Session invalide.", "Invalid session.", "Ungültige Sitzung.", "Sessione non valida."));

        const uid = uRes.data.user.id;
        setUserId(uid);

        const prefs = await loadMyNotificationPreferences(uid);
        setReceiveInApp(prefs.receiveInApp);
        setReceivePush(prefs.receivePush);
        setEnabledKinds(prefs.enabledKinds);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : tr("Erreur de chargement.", "Loading error.", "Ladefehler.", "Errore di caricamento.");
        setError(message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(next: { receiveInApp?: boolean; receivePush?: boolean; enabledKinds?: string[] }) {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await upsertMyNotificationPreferences(userId, next);
      setReceiveInApp(updated.receiveInApp);
      setReceivePush(updated.receivePush);
      setEnabledKinds(updated.enabledKinds);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : tr("Erreur de sauvegarde.", "Save error.", "Speicherfehler.", "Errore di salvataggio.");
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function onToggleInApp(value: boolean) {
    setReceiveInApp(value);
    await persist({ receiveInApp: value });
  }

  async function onTogglePush(value: boolean) {
    if (!pushSupported) return;

    if (value) {
      const res = await ensurePushSubscription({ prompt: true });
      if (!res.ok) {
        if (res.reason === "denied") {
          setError(tr("Permission notifications refusée par le navigateur.", "Notification permission denied by browser.", "Benachrichtigungsberechtigung vom Browser abgelehnt.", "Permesso notifiche rifiutato dal browser."));
        } else {
          setError(tr("Impossible d’activer le push.", "Could not enable push.", "Push konnte nicht aktiviert werden.", "Impossibile attivare il push."));
        }
        return;
      }
      setReceivePush(true);
      await persist({ receivePush: true });
      return;
    }

    await disablePushSubscription();
    setReceivePush(false);
    await persist({ receivePush: false });
  }

  async function onToggleKind(kind: string, enabled: boolean) {
    let next: string[] = [];

    // Empty array means "all kinds enabled" by default.
    if (enabledKinds.length === 0) {
      if (enabled) return;
      next = allKindIds.filter((k) => k !== kind);
    } else {
      next = enabled ? Array.from(new Set([...enabledKinds, kind])) : enabledKinds.filter((k) => k !== kind);
      if (next.length === allKindIds.length) next = [];
    }

    setEnabledKinds(next);
    await persist({ enabledKinds: next });
  }

  if (managerDesign) {
    return (
      <main className={campsStyles.page}>
        <nav className={campsStyles.breadcrumb} aria-label="Fil d’Ariane">
          <Link href={homeHref}>{areaLabel}</Link><ChevronRight size={13} /><Link href={notificationsHref}>Notifications</Link><ChevronRight size={13} /><span>Paramètres</span>
        </nav>

        <div className={campsStyles.topline}>
          <div><h1>Paramètres de notifications</h1><p className={campsStyles.lead}>Choisissez comment recevoir les notifications et les activités qui vous intéressent.</p></div>
          <div className={`${campsStyles.actions} ${styles.headerActions}`}><Link className={campsStyles.secondary} href={notificationsHref}><ArrowLeft size={15} />Retour aux notifications</Link></div>
        </div>

        {error ? <div className={campsStyles.alertError} role="alert">{error}</div> : null}
        {saving ? <div className={styles.savingState} role="status">Enregistrement des préférences…</div> : null}

        {loading ? <section className={campsStyles.panel}><ListLoadingBlock label="Chargement des préférences…" /></section> : <>
          <section className={campsStyles.panel}>
            <div className={campsStyles.panelHeader}>
              <div className={styles.panelTitle}><span className={styles.panelIcon}><BellRing size={16} /></span><div><h2>Canaux de réception</h2><p>Activez les notifications dans ActiviTee et, si votre appareil le permet, les notifications push.</p></div></div>
            </div>
            <div className={styles.settingsList}>
              <div className={styles.settingRow}>
                <span className={styles.settingIcon}><Bell size={16} /></span>
                <div className={styles.settingText}><strong>Notifications dans ActiviTee</strong><span>Affiche les nouvelles activités dans votre centre de notifications.</span></div>
                <Toggle checked={receiveInApp} disabled={saving} label="Notifications dans ActiviTee" onToggle={(checked) => void onToggleInApp(checked)} />
              </div>
              <div className={`${styles.settingRow} ${!pushSupported ? styles.settingDisabled : ""}`}>
                <span className={styles.settingIcon}><Smartphone size={16} /></span>
                <div className={styles.settingText}><strong>Notifications push</strong><span>{pushSupported ? "Recevez les notifications dans l’application et votre navigateur mobile ou ordinateur." : "Les notifications push ne sont pas prises en charge sur cet appareil."}</span></div>
                <Toggle checked={receivePush} disabled={saving || !pushSupported || !receiveInApp} label="Notifications push" onToggle={(checked) => void onTogglePush(checked)} />
              </div>
            </div>
          </section>

          <section className={`${campsStyles.panel} ${!receiveInApp ? styles.sectionDisabled : ""}`}>
            <div className={campsStyles.panelHeader}>
              <div className={styles.panelTitle}><span className={styles.panelIcon}><Settings size={16} /></span><div><h2>Types de notifications</h2><p>Sélectionnez les catégories d’activité que vous souhaitez recevoir.</p></div></div>
            </div>
            <div className={styles.kindGrid}>
              {notificationKindOptions.map((option) => {
                const checked = enabledKinds.length === 0 || selectedKindsSet.has(option.kind);
                const label = locale === "fr" ? option.labelFr : option.labelEn;
                return <div className={styles.kindRow} key={option.kind}><span>{label}</span><Toggle checked={checked} disabled={saving || !receiveInApp} label={label} onToggle={(nextChecked) => void onToggleKind(option.kind, nextChecked)} /></div>;
              })}
            </div>
          </section>
        </>}
      </main>
    );
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <div className="glass-section">
          <div className="marketplace-header">
            <div style={{ display: "grid", gap: 4 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                {locale === "fr" ? titleFr : locale === "de" ? titleDe : locale === "it" ? titleIt : titleEn}
              </div>
            </div>
            <div className="marketplace-actions" style={{ marginTop: 2 }}>
              <Link className="cta-green cta-green-inline" href={notificationsHref}>
                {tr("Retour notifications", "Back to notifications", "Zurück zu Benachrichtigungen", "Torna alle notifiche")}
              </Link>
              <Link className="cta-green cta-green-inline" href={homeHref}>{t("common.back")}</Link>
            </div>
          </div>
          {error ? <div className="marketplace-error">{error}</div> : null}
        </div>

        <div className="glass-section">
          <div className="glass-card" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 950, fontSize: 14 }}>
              <Settings size={16} />
              {tr("Paramètres notifications", "Notification settings", "Benachrichtigungseinstellungen", "Impostazioni notifiche")}
            </div>

            {loading ? (
              <div style={{ opacity: 0.8, fontWeight: 800, fontSize: 13 }}>{t("common.loading")}</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <label className="glass-card" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 12 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{tr("Activer les notifications", "Enable notifications", "Benachrichtigungen aktivieren", "Attiva notifiche")}</div>
                  </div>
                  <span
                    role="switch"
                    aria-checked={receiveInApp}
                    tabIndex={0}
                    onClick={() => {
                      if (saving) return;
                      void onToggleInApp(!receiveInApp);
                    }}
                    onKeyDown={(e) => {
                      if (saving) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void onToggleInApp(!receiveInApp);
                      }
                    }}
                    style={{
                      width: 48,
                      height: 28,
                      borderRadius: 999,
                      border: "1px solid rgba(0,0,0,0.14)",
                      background: receiveInApp ? "rgba(53,72,59,0.85)" : "rgba(0,0,0,0.18)",
                      display: "inline-flex",
                      alignItems: "center",
                      padding: 3,
                      cursor: saving ? "not-allowed" : "pointer",
                      opacity: saving ? 0.65 : 1,
                      transition: "all .18s ease",
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: "white",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                        transform: receiveInApp ? "translateX(20px)" : "translateX(0)",
                        transition: "transform .18s ease",
                      }}
                    />
                  </span>
                </label>

                <label className="glass-card" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: 12, opacity: pushSupported ? 1 : 0.6 }}>
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{tr("Push PWA", "PWA push", "PWA-Push", "Push PWA")}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(0,0,0,0.62)", lineHeight: 1.4 }}>
                      {pushSupported
                        ? tr(
                            "Notification sur l'application et le navigateur mobile/desktop",
                            "Notification on app and mobile/desktop browser",
                            "Benachrichtigung in der App und im mobilen/desktop Browser",
                            "Notifica sull'app e nel browser mobile/desktop"
                          )
                        : tr("Non supporté sur cet appareil.", "Not supported on this device.", "Auf diesem Gerät nicht unterstützt.", "Non supportato su questo dispositivo.")}
                    </div>
                  </div>
                  <span
                    role="switch"
                    aria-checked={receivePush}
                    tabIndex={0}
                    onClick={() => {
                      if (saving || !pushSupported || !receiveInApp) return;
                      void onTogglePush(!receivePush);
                    }}
                    onKeyDown={(e) => {
                      if (saving || !pushSupported || !receiveInApp) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void onTogglePush(!receivePush);
                      }
                    }}
                    style={{
                      width: 48,
                      height: 28,
                      borderRadius: 999,
                      border: "1px solid rgba(0,0,0,0.14)",
                      background: receivePush ? "rgba(53,72,59,0.85)" : "rgba(0,0,0,0.18)",
                      display: "inline-flex",
                      alignItems: "center",
                      padding: 3,
                      cursor: saving || !pushSupported || !receiveInApp ? "not-allowed" : "pointer",
                      opacity: saving || !pushSupported || !receiveInApp ? 0.65 : 1,
                      transition: "all .18s ease",
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        background: "white",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                        transform: receivePush ? "translateX(20px)" : "translateX(0)",
                        transition: "transform .18s ease",
                      }}
                    />
                  </span>
                </label>

                <div className="glass-card" style={{ display: "grid", gap: 8, padding: 12, opacity: receiveInApp ? 1 : 0.6 }}>
                  <div style={{ fontWeight: 900, fontSize: 13 }}>{tr("Types de notifications", "Notification types", "Benachrichtigungstypen", "Tipi di notifiche")}</div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {NOTIFICATION_KIND_OPTIONS.map((opt) => {
                      const checked = enabledKinds.length === 0 || selectedKindsSet.has(opt.kind);
                      return (
                        <label
                          key={opt.kind}
                          className="glass-card"
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            padding: 10,
                            width: "100%",
                          }}
                        >
                          <span style={{ fontWeight: 700, fontSize: 12, color: "rgba(0,0,0,0.72)", lineHeight: 1.35 }}>
                            {locale === "fr" ? opt.labelFr : opt.labelEn}
                          </span>
                          <span
                            role="switch"
                            aria-checked={checked}
                            tabIndex={0}
                            onClick={() => {
                              if (saving || !receiveInApp) return;
                              void onToggleKind(opt.kind, !checked);
                            }}
                            onKeyDown={(e) => {
                              if (saving || !receiveInApp) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                void onToggleKind(opt.kind, !checked);
                              }
                            }}
                            style={{
                              width: 48,
                              height: 28,
                              borderRadius: 999,
                              border: "1px solid rgba(0,0,0,0.14)",
                              background: checked ? "rgba(53,72,59,0.85)" : "rgba(0,0,0,0.18)",
                              display: "inline-flex",
                              alignItems: "center",
                              padding: 3,
                              cursor: saving || !receiveInApp ? "not-allowed" : "pointer",
                              opacity: saving || !receiveInApp ? 0.65 : 1,
                              transition: "all .18s ease",
                            }}
                          >
                            <span
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 999,
                                background: "white",
                                boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                                transform: checked ? "translateX(20px)" : "translateX(0)",
                                transition: "transform .18s ease",
                              }}
                            />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, disabled, label, onToggle }: { checked: boolean; disabled: boolean; label: string; onToggle: (checked: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`${styles.toggle} ${checked ? styles.toggleChecked : ""}`} onClick={() => onToggle(!checked)}><span /></button>;
}
