"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerJuniorFeedback, managerJuniorFormat } from "@/lib/managerJuniorPresentation";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, RefreshCcw, RefreshCw, Save } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import emailStyles from "@/components/manager/FamilyEmailConfigurationPage.module.css";
import { useManagerResource } from "@/components/manager/useManagerResource";
import ManagerClubSelect from "@/components/manager/ManagerClubSelect";
import { useManagerClubChangeGuard } from "@/components/manager/useManagerClubChangeGuard";
import {
  defaultFamilyMailConfig,
  FAMILY_MAIL_TEMPLATE_DEFINITIONS,
  renderFamilyTemplate,
  renderAccessInvitationBody,
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
  consent_url: "https://www.activitee.golf/parent/consent",
  app_url: "https://www.activitee.golf/",
  player_guide_url: "https://www.activitee.golf/guide-junior.pdf",
  period_label: "septembre 2026",
  junior_names: "Léa Martin",
  summary: "Léa a participé régulièrement aux activités du club et poursuit son objectif d’entraînement.",
  report_url: "https://www.activitee.golf/parent/reports/exemple",
};

export default function FamilyEmailConfigurationPage() {
  const { t } = useI18n();
  const params = useSearchParams();
  const router = useRouter();
  const clubsResource = useManagerResource<{ clubs: Club[] }>("/api/manager/my-clubs", "clubs_load_failed");
  const clubs = clubsResource.data?.clubs ?? [];
  const requestedClubId = params.get("club") ?? "";
  const clubId = requestedClubId ? clubs.find((club) => club.id === requestedClubId)?.id ?? "" : clubs[0]?.id ?? "";
  const configResource = useManagerResource<{ mail_config: FamilyMailConfig }>(clubId ? `/api/manager/clubs/${clubId}/access-invitations` : null, "mail_config_load_failed");
  const [config, setConfig] = useState<FamilyMailConfig>(defaultFamilyMailConfig());
  const [savedConfig, setSavedConfig] = useState<FamilyMailConfig>(defaultFamilyMailConfig());
  const [draftClubId, setDraftClubId] = useState("");
  const activeClubRef = useRef(clubId);
  activeClubRef.current = clubId;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const ready = Boolean(clubId && draftClubId === clubId && !configResource.loading && !configResource.error && configResource.data);
  const dirty = ready && JSON.stringify(config) !== JSON.stringify(savedConfig);
  useManagerClubChangeGuard(dirty, t("manager.junior.emails.discardDraft"), Boolean(busy));
  const previewExamples = { ...examples, club_name: clubs.find((club) => club.id === clubId)?.name || examples.club_name };
  useEffect(() => {
    if (!clubId || !configResource.data || configResource.loading || draftClubId === clubId) return;
    const next = configResource.data.mail_config ?? defaultFamilyMailConfig();
    setConfig(next); setSavedConfig(next); setDraftClubId(clubId); setError(""); setMessage("");
  }, [clubId, configResource.data, configResource.loading, draftClubId]);

  function selectClub(id: string) {
    if (!clubs.some((club) => club.id === id) || id === clubId || busy) return;
    if (dirty && !window.confirm(t("manager.junior.emails.discardDraft"))) return;
    setError(""); setMessage("");
    const next = new URLSearchParams(params.toString()); next.set("club", id);
    router.replace(`/manager/user-management/email-configuration?${next}`, { scroll: false });
  }

  async function save(key: string, nextConfig = config) {
    if (!ready || busy) return;
    setBusy(key); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/manager/clubs/${clubId}/access-invitations`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(nextConfig),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t("manager.saveError"));
      if (activeClubRef.current === clubId) {
        setConfig(json.mail_config); setSavedConfig(json.mail_config);
        setMessage(t("manager.junior.emails.saved"));
      }
    } catch (cause) { if (activeClubRef.current === clubId) setError(cause instanceof Error ? cause.message : t("manager.saveError")); }
    finally { setBusy(null); }
  }

  return <div className={styles.page}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>{t("manager.junior.emails.breadcrumb")}</nav>
    <div className={styles.topline}>
      <div><h1>{t("manager.nav.emails")}</h1><p className={styles.lead}>{t("manager.junior.emails.lead")}</p></div>
      <div className={actionStyles.topActions}><ManagerClubSelect clubs={clubs} clubId={clubId} onChange={selectClub} disabled={clubsResource.loading || Boolean(busy)} /></div>
    </div>
    {clubsResource.error || requestedClubId && clubsResource.data && !clubId || configResource.error || error ? <div className={styles.errorAlert} role="alert">{managerJuniorFeedback(t, error || (clubsResource.error ? t("manager.administration.clubsError") : requestedClubId && clubsResource.data && !clubId ? t("manager.clubUnavailable") : t("manager.junior.emails.loadError")))}</div> : null}
    {message ? <div className={actionStyles.successAlert} role="status">{managerJuniorFeedback(t, message)}</div> : null}
    {clubsResource.loading || configResource.loading || clubId && !ready && !configResource.error ? <section className={styles.overview}><ListLoadingBlock label={t("manager.junior.emails.loading")} /></section> : ready ? <div style={{ display: "grid", gap: 18 }}>
      {FAMILY_MAIL_TEMPLATE_DEFINITIONS.map((template) => {
        const defaults = defaultFamilyMailConfig();
        const subject = renderFamilyTemplate(config[template.subjectKey], previewExamples);
        const body = ["parent", "junior_direct", "junior_parent"].includes(template.key) ? renderAccessInvitationBody(config[template.bodyKey], previewExamples) : renderFamilyTemplate(config[template.bodyKey], previewExamples);
        return <section className={styles.quickPanel} key={template.key}>
          <div className={styles.sectionHeading}><div><h2>{t(`manager.junior.emails.${template.key}.title`)}</h2><p className={emailStyles.recipient}><Mail size={14} aria-hidden="true" /><span>{managerJuniorFormat(t, "emails.recipient", { recipient: t(`manager.junior.emails.${template.key}.recipient`) })}</span></p></div></div>
          <div className="user-mgmt-form-grid">
            <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}><span className="user-mgmt-field-label">{t("manager.junior.emails.subject")}</span><input value={config[template.subjectKey]} onChange={(event) => setConfig((current) => ({ ...current, [template.subjectKey]: event.target.value }))} /></label>
            <label className="user-mgmt-field" style={{ gridColumn: "1 / -1" }}><span className="user-mgmt-field-label">{t("manager.junior.emails.body")}</span><textarea rows={9} value={config[template.bodyKey]} onChange={(event) => setConfig((current) => ({ ...current, [template.bodyKey]: event.target.value }))} /></label>
          </div>
          <div style={{ marginTop: 12 }}><b style={{ fontSize: 12 }}>{t("manager.junior.emails.variables")}</b><div className="user-mgmt-chip-list" style={{ marginTop: 6 }}>{template.variables.map((variable) => <code className="pill-soft" key={variable}>{`{{${variable}}}`}</code>)}</div></div>
          <div className={emailStyles.previewSection}><small className={emailStyles.previewLabel}>{t("manager.administration.criteria.previewName")}</small><div className={emailStyles.preview} aria-label={managerJuniorFormat(t, "emails.preview", { title: t(`manager.junior.emails.${template.key}.title`) })}><strong className={emailStyles.previewSubject}>{subject}</strong><div className={emailStyles.previewBody}>{body}</div></div></div>
          <div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button type="button" className={actionStyles.secondaryButton} disabled={Boolean(busy)} onClick={() => { const next = { ...config, [template.subjectKey]: defaults[template.subjectKey], [template.bodyKey]: defaults[template.bodyKey] }; setConfig(next); void save(`restore:${template.key}`, next); }}><RefreshCcw size={15} />{t("manager.junior.emails.restore")}</button>
            <button type="button" className={actionStyles.primaryButton} disabled={Boolean(busy)} onClick={() => void save(template.key)}>{busy === template.key ? <RefreshCw size={15} className={styles.spin} /> : <Save size={15} />}{t("manager.save")}</button>
          </div>
        </section>;
      })}
    </div> : clubsResource.data && !clubs.length ? <section className={styles.overview}>{t("manager.noClub")}</section> : null}
  </div>;
}
