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

type Club = { id: string; name: string };

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

export default function ManagerCreatePage() {
  const { t } = useI18n();

  const router = useRouter();
  const requestedClubId = useSearchParams().get("club") ?? "";
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    if (!validate()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ role: "manager", ...form, email: form.email.trim().toLowerCase() }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? t("manager.administration.managers.createError"));
      router.push(`/manager/user-management/managers?club=${clubId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("manager.administration.managers.createError"));
    } finally {
      setSaving(false);
    }
  }

  const backUrl = `/manager/user-management/managers${clubId ? `?club=${clubId}` : ""}`;
  return <div className={styles.page}>
    <nav aria-label={t("manager.content.breadcrumb")} style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}><Link href={backUrl}>{t("manager.fields.manager")}</Link> / {t("manager.administration.managers.new")}</nav>
    <div className={styles.topline}><div><h1>{t("manager.administration.managers.new")}</h1><p className={styles.lead}>{t("manager.administration.managers.createLead")}</p></div><div className={actionStyles.topActions}><Link className={actionStyles.backButton} href={backUrl}><ArrowLeft size={16} />{t("manager.administration.backToList")}</Link></div></div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{managerAdministrationFeedback(t, error)}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label={t("manager.content.preparingForm")} /></section> : <form onSubmit={submit} noValidate><section className={styles.overview}><div className={`${styles.sectionHeading} ${styles.staffFormHeading}`}><div><h2>{t("manager.administration.managers.information")}</h2><p>{t("manager.administration.requiredHelp")}</p></div><label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("manager.settings.club")}</span><select value={clubId} aria-invalid={Boolean(errors.club)} onChange={(event) => setClubId(event.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select>{errors.club ? <small className="form-error" role="alert">{managerAdministrationFeedback(t, errors.club)}</small> : null}</label></div><div className="user-mgmt-form-grid"><Field label={t("manager.profile.firstName")} required value={form.first_name} error={managerAdministrationFeedback(t, errors.first_name)} onChange={(value) => setForm({ ...form, first_name: value })} /><Field label={t("manager.content.name")} required value={form.last_name} error={managerAdministrationFeedback(t, errors.last_name)} onChange={(value) => setForm({ ...form, last_name: value })} /><Field label={t("manager.profile.function")} required value={form.staff_function} error={managerAdministrationFeedback(t, errors.staff_function)} onChange={(value) => setForm({ ...form, staff_function: value })} /><Field label={t("manager.administration.email")} required type="email" value={form.email} error={managerAdministrationFeedback(t, errors.email)} onChange={(value) => setForm({ ...form, email: value })} /><Field label={t("manager.profile.phone")} value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} /><Field label={t("manager.profile.address")} full value={form.address} onChange={(value) => setForm({ ...form, address: value })} /><Field label={t("manager.profile.postalCode")} value={form.postal_code} onChange={(value) => setForm({ ...form, postal_code: value })} /><Field label={t("manager.profile.city")} value={form.city} onChange={(value) => setForm({ ...form, city: value })} /></div><div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: "auto" }}><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? t("manager.settings.seasons.creating") : t("manager.administration.managers.create")}</button></div></section></form>}
  </div>;
}

function Field({ label, value, onChange, error, type = "text", required, full }: { label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; required?: boolean; full?: boolean }) {
  return <label className="user-mgmt-field" style={full ? { gridColumn: "1 / -1" } : undefined}><span className="user-mgmt-field-label">{label}{required ? " *" : ""}</span><input required={required} aria-required={required || undefined} aria-invalid={Boolean(error)} type={type} value={value} onChange={(event) => onChange(event.target.value)} />{error ? <small className="form-error" role="alert">{error}</small> : null}</label>;
}
