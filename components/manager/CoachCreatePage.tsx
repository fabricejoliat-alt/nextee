"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Save } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerAdministrationFeedback } from "@/lib/managerAdministrationPresentation";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import credentialStyles from "./CoachCreatePage.module.css";

type Club = { id: string; name: string };
type CreatedCoach = { email: string; username: string; password: string | null };

const initialForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  staff_function: "",
  address: "",
  postal_code: "",
  city: "",
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

export default function CoachCreatePage() {
  const { t } = useI18n();

  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedClubId = searchParams.get("club");
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createdCoach, setCreatedCoach] = useState<CreatedCoach | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders(), cache: "no-store" });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? t("manager.administration.clubsError"));
        const nextClubs = (json.clubs ?? []) as Club[];
        setClubs(nextClubs);
        setClubId(nextClubs.find((club) => club.id === requestedClubId)?.id ?? nextClubs[0]?.id ?? "");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t("manager.administration.clubsError"));
      } finally {
        setLoading(false);
      }
    })();
    // Resolve context once; changing language must preserve the current draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validate() {
    const next: Record<string, string> = {};
    if (!form.first_name.trim()) next.first_name = t("manager.administration.firstNameRequired");
    if (!form.last_name.trim()) next.last_name = t("manager.administration.lastNameRequired");
    if (!form.staff_function.trim()) next.staff_function = t("manager.administration.functionRequired");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = t("manager.administration.validEmail");
    if (!clubId) next.club = t("manager.administration.chooseClub");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || createdCoach || !validate()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ role: "coach", ...form, email: form.email.trim().toLowerCase() }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t("manager.administration.coaches.createError"));
      setCreatedCoach({
        email: String(json.user?.email ?? form.email.trim().toLowerCase()),
        username: String(json.username ?? ""),
        password: typeof json.tempPassword === "string" ? json.tempPassword : null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("manager.administration.coaches.createError"));
    } finally {
      setSaving(false);
    }
  }

  const backUrl = clubId ? `/manager/user-management/coaches?club=${encodeURIComponent(clubId)}` : "/manager/user-management/coaches";

  return <div className={styles.page}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}><Link href={backUrl}>{t("manager.fields.coach")}</Link> / {t("manager.administration.coaches.new")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.administration.coaches.new")}</h1><p className={styles.lead}>{t("manager.administration.coaches.createLead")}</p></div><div className={actionStyles.topActions}><Link className={actionStyles.backButton} href={backUrl}><ArrowLeft size={16} />{t("manager.administration.backToList")}</Link></div></div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{managerAdministrationFeedback(t, error)}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label={t("manager.content.preparingForm")} /></section> : createdCoach ? <section className={styles.overview} role="status" aria-live="polite"><div className={styles.sectionHeading}><div><h2>{t("manager.administration.coaches.created")}</h2><p>{createdCoach.password ? t("manager.administration.coaches.credentialsOnce") : t("manager.administration.coaches.existingAccount")}</p></div></div><dl className={credentialStyles.details}><div><dt>{t("manager.administration.email")}</dt><dd>{createdCoach.email}</dd></div>{createdCoach.username ? <div><dt>{t("manager.administration.coaches.loginIdentifier")}</dt><dd>{createdCoach.username}</dd></div> : null}{createdCoach.password ? <div><dt>{t("manager.administration.coaches.initialPassword")}</dt><dd><code className={credentialStyles.password}>{createdCoach.password}</code></dd></div> : null}</dl>{createdCoach.password ? <p className={credentialStyles.help}>{t("manager.administration.coaches.changeFirstLogin")}</p> : null}<div className={actionStyles.topActions}><button type="button" className={actionStyles.primaryButton} onClick={() => { setCreatedCoach(null); router.push(backUrl); }}>{t("manager.administration.coaches.hideAndReturn")}</button></div></section> : <form onSubmit={submit} noValidate><section className={styles.overview}><div className={`${styles.sectionHeading} ${styles.staffFormHeading}`}><div><h2>{t("manager.administration.coaches.information")}</h2><p>{t("manager.administration.requiredHelp")}</p></div><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.settings.club")}</span><select value={clubId} aria-invalid={Boolean(errors.club)} onChange={(event) => setClubId(event.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select>{errors.club ? <small className="form-error" role="alert">{managerAdministrationFeedback(t, errors.club)}</small> : null}</label></div><div className="user-mgmt-form-grid"><Field label={t("manager.profile.firstName")} required value={form.first_name} error={managerAdministrationFeedback(t, errors.first_name)} onChange={(value) => setForm({ ...form, first_name: value })} /><Field label={t("manager.content.name")} required value={form.last_name} error={managerAdministrationFeedback(t, errors.last_name)} onChange={(value) => setForm({ ...form, last_name: value })} /><Field label={t("manager.profile.function")} required value={form.staff_function} error={managerAdministrationFeedback(t, errors.staff_function)} onChange={(value) => setForm({ ...form, staff_function: value })} /><Field label={t("manager.administration.email")} required type="email" value={form.email} error={managerAdministrationFeedback(t, errors.email)} onChange={(value) => setForm({ ...form, email: value })} /><Field label={t("manager.profile.phone")} value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} /><Field label={t("manager.profile.address")} full value={form.address} onChange={(value) => setForm({ ...form, address: value })} /><Field label={t("manager.profile.postalCode")} value={form.postal_code} onChange={(value) => setForm({ ...form, postal_code: value })} /><Field label={t("manager.profile.city")} value={form.city} onChange={(value) => setForm({ ...form, city: value })} /></div><div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: "auto" }}><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? t("manager.settings.seasons.creating") : t("manager.administration.coaches.create")}</button></div></section></form>}
  </div>;
}

function Field({ label, value, onChange, error, type = "text", required, full }: { label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; required?: boolean; full?: boolean }) {
  return <label className="user-mgmt-field" style={full ? { gridColumn: "1 / -1" } : undefined}><span className="user-mgmt-field-label">{label}{required ? " *" : ""}</span><input required={required} aria-required={required || undefined} aria-invalid={Boolean(error)} type={type} value={value} onChange={(event) => onChange(event.target.value)} />{error ? <small className="form-error" role="alert">{error}</small> : null}</label>;
}
