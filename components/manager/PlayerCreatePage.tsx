"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, Save } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";

type Club = { id: string; name: string };
type Season = { id: string; name: string; is_current: boolean };
type FieldType = "text" | "short_text" | "long_text" | "number" | "date" | "select" | "radio" | "checkbox" | "boolean";
type Field = {
  id: string;
  label: string;
  field_type: FieldType;
  options_json?: string[] | null;
  is_active: boolean;
  legacy_binding?: string | null;
  scope: "permanent" | "season";
  description?: string | null;
  is_required?: boolean;
  is_sensitive?: boolean;
};
type FieldValue = string | boolean | string[];

const initialProfile = {
  first_name: "",
  last_name: "",
  email: "",
  birth_date: "",
  phone: "",
  address: "",
  postal_code: "",
  city: "",
  avs_no: "",
  handedness: "",
  handicap: "",
  player_consent_status: "pending",
  is_performance: false,
};

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

function isEmpty(value: FieldValue | undefined) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

export default function PlayerCreatePage() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [clubId, setClubId] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [profile, setProfile] = useState(initialProfile);
  const [permanentValues, setPermanentValues] = useState<Record<string, FieldValue>>({});
  const [seasonValues, setSeasonValues] = useState<Record<string, FieldValue>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const permanentFields = useMemo(
    () => fields.filter((field) => field.scope === "permanent"),
    [fields]
  );
  const seasonFields = useMemo(
    () => fields.filter((field) => field.scope === "season"),
    [fields]
  );

  async function loadClub(id: string) {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const requestHeaders = await authHeaders();
      const [membersResponse, seasonsResponse] = await Promise.all([
        fetch(`/api/manager/clubs/${id}/members`, { headers: requestHeaders, cache: "no-store" }),
        fetch(`/api/manager/clubs/${id}/seasons`, { headers: requestHeaders, cache: "no-store" }),
      ]);
      const membersJson = await membersResponse.json();
      const seasonsJson = await seasonsResponse.json();
      if (!membersResponse.ok) throw new Error(membersJson.error ?? "Impossible de charger les champs.");
      if (!seasonsResponse.ok) throw new Error(seasonsJson.error ?? "Impossible de charger les saisons.");
      const nextSeasons = (seasonsJson.seasons ?? []) as Season[];
      setFields(((membersJson.playerFields ?? []) as Field[]).filter((field) => field.is_active && !field.legacy_binding));
      setSeasons(nextSeasons);
      setSeasonId("");
      setPermanentValues({});
      setSeasonValues({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de préparer le formulaire.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/manager/my-clubs", { headers: await authHeaders() });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? "Impossible de charger les clubs.");
        const nextClubs = (json.clubs ?? []) as Club[];
        const firstClubId = nextClubs[0]?.id ?? "";
        setClubs(nextClubs);
        setClubId(firstClubId);
        if (firstClubId) await loadClub(firstClubId);
        else setLoading(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Impossible de charger les clubs.");
        setLoading(false);
      }
    })();
  }, []);

  function validate() {
    const nextErrors: Record<string, string> = {};
    if (!profile.first_name.trim()) nextErrors.first_name = "Le prénom est obligatoire.";
    if (!profile.last_name.trim()) nextErrors.last_name = "Le nom est obligatoire.";
    if (!profile.birth_date) nextErrors.birth_date = "La date de naissance est obligatoire.";
    if (profile.email.trim() && !/^\S+@\S+\.\S+$/.test(profile.email.trim())) nextErrors.email = "Saisissez une adresse e-mail valide.";
    for (const field of permanentFields) {
      if (field.is_required && !field.is_sensitive && isEmpty(permanentValues[field.id])) {
        nextErrors[`permanent:${field.id}`] = "Ce champ est obligatoire.";
      }
    }
    if (seasonId) {
      for (const field of seasonFields) {
        if (field.is_required && !field.is_sensitive && isEmpty(seasonValues[field.id])) {
          nextErrors[`season:${field.id}`] = "Ce champ est obligatoire.";
        }
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate() || !clubId) return;
    setSaving(true);
    setError("");
    try {
      const safePermanentValues = Object.fromEntries(
        permanentFields
          .filter((field) => !field.is_sensitive && !isEmpty(permanentValues[field.id]))
          .map((field) => [field.id, permanentValues[field.id]])
      );
      const response = await fetch(`/api/admin/clubs/${clubId}/create-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          role: "player",
          ...profile,
          handicap: profile.handicap || null,
          player_field_values: safePermanentValues,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? "Impossible de créer le junior.");
      const memberId = String(json.member?.id ?? "");
      if (!memberId) throw new Error("Le dossier junior n’a pas été créé.");

      if (seasonId) {
        const safeSeasonValues = Object.fromEntries(
          seasonFields
            .filter((field) => !field.is_sensitive && !isEmpty(seasonValues[field.id]))
            .map((field) => [field.id, seasonValues[field.id]])
        );
        const seasonResponse = await fetch(`/api/manager/clubs/${clubId}/seasons/${seasonId}/records`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ member_ids: [memberId], custom_field_values: safeSeasonValues }),
        });
        const seasonJson = await seasonResponse.json();
        if (!seasonResponse.ok) {
          throw new Error(seasonJson.error ?? "Le junior est créé, mais ses paramètres de saison n’ont pas pu être enregistrés.");
        }
      }
      router.push(`/manager/user-management/players/${memberId}?club=${clubId}&season=${seasonId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de créer le junior.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <nav aria-label="Fil d’Ariane" style={{ minHeight: 22, color: "#35483b", fontSize: 11, fontWeight: 700 }}>
        <Link href="/manager/user-management/players">Juniors</Link> / Nouveau junior
      </nav>
      <div className={styles.topline}>
        <div><h1>Nouveau junior</h1><p className={styles.lead}>Ajoutez les informations connues. Le groupe et les parents pourront être renseignés ensuite.</p></div>
        <div className={actionStyles.topActions}>
          <Link className={actionStyles.backButton} href="/manager/user-management/players"><ArrowLeft size={16} />Retour à la liste</Link>
        </div>
      </div>
      {error ? <div className={styles.errorAlert} role="alert">{error}</div> : null}
      {loading ? (
        <section className={styles.overview}><ListLoadingBlock label="Préparation du formulaire…" /></section>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
          <section className={styles.overview}>
            <div className={styles.sectionHeading}>
              <div><h2>Profil permanent</h2><p>Les champs marqués d’un astérisque sont requis.</p></div>
              <label className="user-mgmt-field"><span className="user-mgmt-field-label">Club</span><select value={clubId} onChange={(event) => { setClubId(event.target.value); void loadClub(event.target.value); }}>{clubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}</select></label>
            </div>
            <div className="user-mgmt-form-grid">
              <FieldInput label="Prénom *" value={profile.first_name} onChange={(value) => setProfile({ ...profile, first_name: value })} error={errors.first_name} required />
              <FieldInput label="Nom *" value={profile.last_name} onChange={(value) => setProfile({ ...profile, last_name: value })} error={errors.last_name} required />
              <FieldInput label="Adresse e-mail du junior" type="email" value={profile.email} onChange={(value) => setProfile({ ...profile, email: value })} error={errors.email} />
              <FieldInput label="Date de naissance *" type="date" value={profile.birth_date} onChange={(value) => setProfile({ ...profile, birth_date: value })} error={errors.birth_date} required />
              <FieldInput label="Téléphone" value={profile.phone} onChange={(value) => setProfile({ ...profile, phone: value })} />
              <FieldInput label="Adresse" full value={profile.address} onChange={(value) => setProfile({ ...profile, address: value })} />
              <FieldInput label="Code postal" value={profile.postal_code} onChange={(value) => setProfile({ ...profile, postal_code: value })} />
              <FieldInput label="Ville" value={profile.city} onChange={(value) => setProfile({ ...profile, city: value })} />
              <FieldInput label="Numéro AVS" value={profile.avs_no} onChange={(value) => setProfile({ ...profile, avs_no: value })} />
              <label className="user-mgmt-field"><span className="user-mgmt-field-label">Latéralité</span><select value={profile.handedness} onChange={(event) => setProfile({ ...profile, handedness: event.target.value })}><option value="">Non définie</option><option value="right">Droitier</option><option value="left">Gaucher</option></select></label>
              <FieldInput label="Handicap" value={profile.handicap} onChange={(value) => setProfile({ ...profile, handicap: value })} />
            </div>
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}><div><h2>Informations complémentaires</h2><p>Champs permanents configurés pour ce club.</p></div></div>
            <FieldCollection fields={permanentFields} values={permanentValues} setValues={setPermanentValues} errors={errors} errorPrefix="permanent" />
          </section>

          <section className={styles.quickPanel}>
            <div className={styles.sectionHeading}>
              <h2>Paramètre de saison</h2>
              <label className="user-mgmt-field"><span className="user-mgmt-field-label">Saison</span><select value={seasonId} onChange={(event) => setSeasonId(event.target.value)}><option value="">Aucune saison</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.is_current ? " · En cours" : ""}</option>)}</select></label>
            </div>
            {!seasonId ? <div className="marketplace-empty">Sélectionnez une saison pour renseigner ses paramètres.</div> : <FieldCollection fields={seasonFields} values={seasonValues} setValues={setSeasonValues} errors={errors} errorPrefix="season" />}
          </section>

          <div className={actionStyles.stickySave}>
            <button type="submit" className={actionStyles.primaryButton} disabled={saving}>
              {saving ? <RefreshCw size={16} className={styles.spin} /> : <Save size={16} />}
              {saving ? "Création…" : "Créer le junior"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function FieldCollection({ fields, values, setValues, errors, errorPrefix }: { fields: Field[]; values: Record<string, FieldValue>; setValues: React.Dispatch<React.SetStateAction<Record<string, FieldValue>>>; errors: Record<string, string>; errorPrefix: string }) {
  if (fields.length === 0) return <div className="marketplace-empty">Aucun champ configuré pour cette zone.</div>;
  return <div className="user-mgmt-form-grid">{fields.map((field) => <DynamicField key={field.id} field={field} value={values[field.id]} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} error={errors[`${errorPrefix}:${field.id}`]} />)}</div>;
}

function DynamicField({ field, value, onChange, error }: { field: Field; value: FieldValue | undefined; onChange: (value: FieldValue) => void; error?: string }) {
  const options = field.options_json ?? [];
  if (field.is_sensitive) return <div className="user-mgmt-field"><span className="user-mgmt-field-label">{field.label}</span><div className="notice-card">Champ restreint à compléter depuis la fiche junior.</div></div>;
  let control: React.ReactNode;
  if (field.field_type === "long_text") control = <textarea rows={4} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  else if (field.field_type === "boolean") control = <select value={value === true ? "yes" : value === false ? "no" : ""} onChange={(event) => onChange(event.target.value === "" ? "" : event.target.value === "yes")}><option value="">Non défini</option><option value="yes">Oui</option><option value="no">Non</option></select>;
  else if (field.field_type === "select") control = <select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Choisir</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  else if (field.field_type === "radio") control = <div className="user-mgmt-chip-list">{options.map((option) => <label key={option} className="pill-soft"><input type="radio" name={field.id} checked={value === option} onChange={() => onChange(option)} />{option}</label>)}</div>;
  else if (field.field_type === "checkbox") { const selected = Array.isArray(value) ? value : []; control = <div className="user-mgmt-chip-list">{options.map((option) => <label key={option} className="pill-soft"><input type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>)}</div>; }
  else control = <input type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  return <label className="user-mgmt-field"><span className="user-mgmt-field-label">{field.label}{field.is_required ? " *" : ""}</span>{control}{field.description ? <small>{field.description}</small> : null}{error ? <small className="form-error">{error}</small> : null}</label>;
}

function FieldInput({ label, value, onChange, error, type = "text", required, full }: { label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; required?: boolean; full?: boolean }) {
  return <label className="user-mgmt-field" style={full ? { gridColumn: "1 / -1" } : undefined}><span className="user-mgmt-field-label">{label}</span><input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} />{error ? <small className="form-error">{error}</small> : null}</label>;
}
