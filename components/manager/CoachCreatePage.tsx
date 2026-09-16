"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, Save } from "lucide-react";
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

export default function CoachCreatePage() {
  const router = useRouter();
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
        if (!response.ok) throw new Error(json.error ?? "Impossible de charger les clubs.");
        const nextClubs = (json.clubs ?? []) as Club[];
        setClubs(nextClubs);
        setClubId(nextClubs[0]?.id ?? "");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Impossible de charger les clubs.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function validate() {
    const next: Record<string, string> = {};
    if (!form.first_name.trim()) next.first_name = "Le prénom est obligatoire.";
    if (!form.last_name.trim()) next.last_name = "Le nom est obligatoire.";
    if (!form.staff_function.trim()) next.staff_function = "La fonction est obligatoire.";
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = "Saisissez une adresse e-mail valide.";
    if (!clubId) next.club = "Sélectionnez un club.";
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
        body: JSON.stringify({ role: "coach", ...form, email: form.email.trim().toLowerCase() }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Impossible de créer le coach.");
      router.push("/manager/user-management/coaches");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de créer le coach.");
    } finally {
      setSaving(false);
    }
  }

  return <div className={styles.page}>
    <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}><Link href="/manager/user-management/coaches">Coachs</Link> / Nouveau coach</nav>
    <div className={styles.topline}><div><h1>Nouveau coach</h1><p className={styles.lead}>Créez un accès coach et renseignez ses coordonnées professionnelles.</p></div><div className={actionStyles.topActions}><Link className={actionStyles.backButton} href="/manager/user-management/coaches"><ArrowLeft size={16} />Retour à la liste</Link></div></div>
    {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}
    {loading ? <section className={styles.overview}><ListLoadingBlock label="Préparation du formulaire…" /></section> : <form onSubmit={submit} noValidate><section className={styles.overview}><div className={styles.sectionHeading}><div><h2>Informations du coach</h2><p>Les champs marqués d’un astérisque sont requis.</p></div><label className="user-mgmt-field"><span className="user-mgmt-field-label">Club</span><select value={clubId} aria-invalid={Boolean(errors.club)} onChange={(event) => setClubId(event.target.value)}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select>{errors.club ? <small className="form-error" role="alert">{errors.club}</small> : null}</label></div><div className="user-mgmt-form-grid"><Field label="Prénom" required value={form.first_name} error={errors.first_name} onChange={(value) => setForm({ ...form, first_name: value })} /><Field label="Nom" required value={form.last_name} error={errors.last_name} onChange={(value) => setForm({ ...form, last_name: value })} /><Field label="Fonction" required value={form.staff_function} error={errors.staff_function} onChange={(value) => setForm({ ...form, staff_function: value })} /><Field label="Adresse e-mail" required type="email" value={form.email} error={errors.email} onChange={(value) => setForm({ ...form, email: value })} /><Field label="Téléphone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} /><Field label="Adresse" full value={form.address} onChange={(value) => setForm({ ...form, address: value })} /><Field label="Code postal" value={form.postal_code} onChange={(value) => setForm({ ...form, postal_code: value })} /><Field label="Ville" value={form.city} onChange={(value) => setForm({ ...form, city: value })} /></div><div className={actionStyles.topActions} style={{ justifyContent: "flex-end", marginTop: "auto" }}><button type="submit" className={actionStyles.primaryButton} disabled={saving}>{saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}{saving ? "Création…" : "Créer le coach"}</button></div></section></form>}
  </div>;
}

function Field({ label, value, onChange, error, type = "text", required, full }: { label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; required?: boolean; full?: boolean }) {
  return <label className="user-mgmt-field" style={full ? { gridColumn: "1 / -1" } : undefined}><span className="user-mgmt-field-label">{label}{required ? " *" : ""}</span><input required={required} aria-required={required || undefined} aria-invalid={Boolean(error)} type={type} value={value} onChange={(event) => onChange(event.target.value)} />{error ? <small className="form-error" role="alert">{error}</small> : null}</label>;
}
