"use client";

import { useEffect, useState } from "react";
import { Mail, RefreshCcw, RefreshCw, Save } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import emailStyles from "@/components/manager/FamilyEmailConfigurationPage.module.css";
import {
  defaultFamilyMailConfig,
  FAMILY_MAIL_TEMPLATE_DEFINITIONS,
  renderFamilyTemplate,
  type FamilyMailConfig,
} from "@/lib/familyAccess";

type Club = { id: string; name: string };

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

const examples: Record<string, string> = {
  club_name: "Golf Club de Lausanne",
  parent_name: "Sophie Martin",
  parent_username: "sophie.martin",
  parent_username_or_existing: "sophie.martin",
  junior_name: "Léa Martin",
  junior_username: "lea.martin",
  temp_password: "Golf-2026!",
  reset_url: "https://www.activitee.golf/reset-password?invite_token=exemple",
  consent_url: "https://www.activitee.golf/parent/consent",
  app_url: "https://www.activitee.golf/",
  player_guide_url: "https://www.activitee.golf/guide-junior.pdf",
  period_label: "septembre 2026",
  junior_names: "Léa Martin",
  summary: "Léa a participé régulièrement aux activités du club et poursuit son objectif d’entraînement.",
  report_url: "https://www.activitee.golf/parent/reports/exemple",
};

export default function FamilyEmailConfigurationPage() {
  const [clubId, setClubId] = useState("");
  const [config, setConfig] = useState<FamilyMailConfig>(defaultFamilyMailConfig());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(id: string) {
    if (!id) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/manager/clubs/${id}/access-invitations`, { headers: await authHeaders(), cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Impossible de charger les modèles.");
      setConfig(json.mail_config ?? defaultFamilyMailConfig());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders(), cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? "Impossible de charger les clubs.");
        const next = (json.clubs ?? []) as Club[];
        setClubId(next[0]?.id ?? "");
        if (next[0]?.id) await load(next[0].id); else setLoading(false);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); setLoading(false); }
    })();
  }, []);

  async function save(key: string, nextConfig = config) {
    if (!clubId) return;
    setBusy(key); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/access-invitations`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(nextConfig),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Enregistrement impossible.");
      setConfig(json.mail_config);
      setMessage("Le modèle a été enregistré.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setBusy(null); }
  }

  return <div className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>Paramètres / E-mails</nav>
    <div className={styles.topline}>
      <div><h1>E-mails</h1><p className={styles.lead}>Modèles utilisés pour les accès familles et les rappels de consentement.</p></div>
    </div>
    {error ? <div className={styles.errorAlert} role="alert">{error}</div> : null}
    {message ? <div className={actionStyles.successAlert} role="status">{message}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label="Chargement des modèles…" /></section> : <div style={{ display: "grid", gap: 18 }}>
      {FAMILY_MAIL_TEMPLATE_DEFINITIONS.map((template) => {
        const defaults = defaultFamilyMailConfig();
        const subject = renderFamilyTemplate(config[template.subjectKey], examples);
        const body = renderFamilyTemplate(config[template.bodyKey], examples);
        return <section className={styles.quickPanel} key={template.key}>
          <div className={styles.sectionHeading}><div><h2>{template.title}</h2><p className={emailStyles.recipient}><Mail size={14} aria-hidden="true" /><span>Destinataire : {template.recipient}</span></p></div></div>
          <div className="user-mgmt-form-grid">
            <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}><span className="user-mgmt-field-label">Objet</span><input value={config[template.subjectKey]} onChange={(event) => setConfig((current) => ({ ...current, [template.subjectKey]: event.target.value }))} /></label>
            <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}><span className="user-mgmt-field-label">Corps du message</span><textarea rows={9} value={config[template.bodyKey]} onChange={(event) => setConfig((current) => ({ ...current, [template.bodyKey]: event.target.value }))} /></label>
          </div>
          <div style={{ marginTop: 12 }}><b style={{ fontSize: 12 }}>Variables disponibles</b><div className="user-mgmt-chip-list" style={{ marginTop: 6 }}>{template.variables.map((variable) => <code className="pill-soft" key={variable}>{`{{${variable}}}`}</code>)}</div></div>
          <div className={emailStyles.previewSection}><small className={emailStyles.previewLabel}>Aperçu</small><div className={emailStyles.preview} aria-label={`Aperçu du modèle ${template.title}`}><strong className={emailStyles.previewSubject}>{subject}</strong><div className={emailStyles.previewBody}>{body}</div></div></div>
          <div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className={actionStyles.secondaryButton} disabled={Boolean(busy)} onClick={() => { const next = { ...config, [template.subjectKey]: defaults[template.subjectKey], [template.bodyKey]: defaults[template.bodyKey] }; setConfig(next); void save(`restore:${template.key}`, next); }}><RefreshCcw size={15} />Restaurer le modèle par défaut</button>
            <button type="button" className={actionStyles.primaryButton} disabled={Boolean(busy)} onClick={() => void save(template.key)}>{busy === template.key ? <RefreshCw size={15} className={styles.spin} /> : <Save size={15} />}Enregistrer</button>
          </div>
        </section>;
      })}
    </div>}
  </div>;
}
