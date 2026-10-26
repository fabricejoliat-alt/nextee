"use client";

import { adminFetch } from "@/lib/adminFetch";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ChevronRight, ImagePlus, Save, Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import styles from "./OrganizationSettingsAdmin.module.css";
import OrganizationPartnersAdmin from "./OrganizationPartnersAdmin";
import DemoModeToggle from "./DemoModeToggle";

type Organization = { id: string; name: string; slug: string | null; org_type: "club" | "academy" | "federation"; is_active: boolean; is_demo: boolean; country_code: string | null; region_code: string | null };
type Settings = Record<string, unknown>;

const initialSettings: Settings = {
  logoUrl: "", description: "",
  language: "fr", timezone: "Europe/Zurich", currency: "CHF", dateFormat: "DD/MM/YYYY", timeFormat: "24h", weekStartsOn: "monday",
  contactEmail: "", phone: "", address: "", postalCode: "", city: "", region: "", billingAddress: "",
  billingCurrency: "CHF", billingStart: "", legalName: "", invoiceAddress: "", taxNumber: "", invoiceReference: "", paymentMethods: "card, transfer", paymentTerms: "30", taxes: "",
};

function value(settings: Settings, key: string) { return String(settings[key] ?? initialSettings[key] ?? ""); }

type SettingsControlProps = { settings: Settings; onChange: (name: string, next: string) => void };

// Keep component identities stable so editing does not remount focused controls.
const Field = ({ label, name, type = "text", hint, children, settings, onChange }: SettingsControlProps & { label: string; name: string; type?: string; hint?: string; children?: React.ReactNode }) => <label className={styles.field}><span>{label}</span>{children ?? <input type={type} value={value(settings, name)} onChange={(event) => onChange(name, event.target.value)} />}<small className={!hint ? styles.emptyHelp : undefined}>{hint || " "}</small></label>;
const Select = ({ label, name, options, settings, onChange }: SettingsControlProps & { label: string; name: string; options: Array<[string, string]> }) => <Field settings={settings} onChange={onChange} label={label} name={name}><select value={value(settings, name)} onChange={(event) => onChange(name, event.target.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></Field>;
const Textarea = ({ label, name, hint, settings, onChange }: SettingsControlProps & { label: string; name: string; hint?: string }) => <Field settings={settings} onChange={onChange} label={label} name={name} hint={hint}><textarea value={value(settings, name)} onChange={(event) => onChange(name, event.target.value)} /></Field>;
const Section = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => <section className={styles.section}><div className={styles.sectionHeading}><h2>{title}</h2><p>{description}</p></div>{children}</section>;

export default function OrganizationSettingsAdmin() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const router = useRouter();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token; }
  async function load() {
    setLoading(true); setError(null);
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Pas de session. Reconnecte-toi.");
      const response = await adminFetch(`/api/admin/organizations/${organizationId}/settings`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erreur de chargement");
      setOrganization(data.organization); setSettings({ ...initialSettings, ...(data.settings ?? {}) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de chargement"); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (organizationId) void load();
    // load is intentionally triggered when the route id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);
  const updateOrg = (key: keyof Organization, next: string | boolean) => setOrganization((current) => current ? { ...current, [key]: next } : current);
  const update = (key: string, next: unknown) => setSettings((current) => ({ ...current, [key]: next }));

  async function save() {
    if (!organization || saving) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Pas de session. Reconnecte-toi.");
      const response = await adminFetch(`/api/admin/organizations/${organizationId}/settings`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ organization, settings }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Erreur de sauvegarde");
      setNotice("Paramètres enregistrés.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de sauvegarde"); }
    finally { setSaving(false); }
  }
  function chooseLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setError("Le logo ne doit pas dépasser 2 Mo."); return; }
    const reader = new FileReader();
    reader.onload = () => update("logoUrl", String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }
  async function deleteOrganization() {
    if (!organization || saving) return;
    const confirmed = window.confirm(`Supprimer définitivement l’organisation « ${organization.name} » ?\n\nCette action est irréversible.`);
    if (!confirmed) return;
    setSaving(true); setError(null);
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("Pas de session. Reconnecte-toi.");
      const response = await adminFetch(`/api/admin/organizations/${organizationId}/settings`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Erreur lors de la suppression");
      router.push("/admin/organizations"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur lors de la suppression"); setSaving(false); }
  }
  if (loading) return null;
  if (!organization) return <div className={styles.errorAlert} role="alert">{error ?? "Organisation introuvable."}</div>;

  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">Administration</Link><ChevronRight size={14}/><Link href="/admin/organizations">Organisations</Link><ChevronRight size={14}/><Link href={`/admin/organizations/${organizationId}`}>{organization.name}</Link><ChevronRight size={14}/><span>Paramètres</span></nav>
    <div className={styles.topline}><div><p className={styles.eyebrow}>Organisation</p><h1>Paramètres</h1><p className={styles.lead}>Configurez l’identité, les accès et le fonctionnement de {organization.name}.</p></div><div className={styles.topActions}><Link href={`/admin/organizations/${organizationId}`} className={styles.backButton}><Users size={16}/>Gérer les managers</Link><Link href="/admin/organizations" className={styles.backButton}>Retour aux organisations</Link><button type="button" className={styles.primaryButton} onClick={save} disabled={saving}><Save size={16}/>{saving ? "Enregistrement…" : "Enregistrer"}</button></div></div>
    {error ? <div className={styles.errorAlert} role="alert">{error}</div> : null}{notice ? <div className={styles.successAlert} role="status">{notice}</div> : null}
    <Section title="Général" description="Identité et informations visibles dans l’application."><div className={styles.grid3}><label className={styles.field}><span>Nom de l’organisation</span><input value={organization.name} onChange={(event) => updateOrg("name", event.target.value)} required /></label><label className={styles.field}><span>Nom d’utilisateur / URL courte</span><input value={organization.slug ?? ""} onChange={(event) => updateOrg("slug", event.target.value)} required /></label><label className={styles.field}><span>Type d’organisation</span><select value={organization.org_type} onChange={(event) => updateOrg("org_type", event.target.value)}><option value="club">Club</option><option value="academy">Académie</option><option value="federation">Fédération</option></select></label><label className={styles.field}><span>Statut</span><select value={organization.is_active ? "active" : "suspended"} onChange={(event) => updateOrg("is_active", event.target.value === "active")}><option value="active">Actif</option><option value="suspended">Suspendu</option><option value="archived">Archivé</option></select></label><div className={styles.logoField}><span>Logo</span><label className={styles.logoUpload}><input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={chooseLogo}/><span className={styles.logoPreview}>{value(settings, "logoUrl") ? <Image src={value(settings, "logoUrl")} alt="Aperçu du logo" width={48} height={48} unoptimized /> : <ImagePlus size={19}/>}</span><span className={styles.logoCopy}><b>{value(settings, "logoUrl") ? "Logo sélectionné" : "Ajouter un logo"}</b><small>PNG, JPG ou SVG · 2 Mo max.</small></span><span className={styles.logoAction}>{value(settings, "logoUrl") ? "Remplacer" : "Choisir un fichier"}</span></label></div></div><Textarea settings={settings} onChange={update} label="Remarque" name="description" hint="Note interne ou présentation courte de l’organisation."/><DemoModeToggle checked={organization.is_demo} onChange={(checked) => updateOrg("is_demo", checked)} disabled={saving}/></Section>
    <Section title="Localisation et préférences régionales" description="Formats utilisés pour les horaires, dates et communications."><div className={styles.grid3}><label className={styles.field}><span>Pays</span><select value={organization.country_code ?? "CH"} onChange={(event) => updateOrg("country_code", event.target.value)}><option value="CH">Suisse</option><option value="FR">France</option><option value="BE">Belgique</option><option value="CA">Canada</option></select></label><Select settings={settings} onChange={update} label="Langue par défaut" name="language" options={[["fr","Français"],["de","Allemand"],["en","Anglais"],["it","Italien"]]}/><Select settings={settings} onChange={update} label="Fuseau horaire" name="timezone" options={[["Europe/Zurich","Europe/Zurich"],["Europe/Paris","Europe/Paris"],["Europe/London","Europe/London"]]}/><Select settings={settings} onChange={update} label="Devise" name="currency" options={[["CHF","CHF"],["EUR","EUR"],["USD","USD"]]}/><Select settings={settings} onChange={update} label="Format de date" name="dateFormat" options={[["DD/MM/YYYY","JJ/MM/AAAA"],["YYYY-MM-DD","AAAA-MM-JJ"],["MM/DD/YYYY","MM/JJ/AAAA"]]}/><Select settings={settings} onChange={update} label="Format d’heure" name="timeFormat" options={[["24h","24 heures"],["12h","12 heures"]]}/><Select settings={settings} onChange={update} label="Premier jour de la semaine" name="weekStartsOn" options={[["monday","Lundi"],["sunday","Dimanche"]]}/></div></Section>
    <Section title="Coordonnées" description="Informations de contact et adresse de référence."><div className={styles.grid3}><Field settings={settings} onChange={update} label="E-mail de contact" name="contactEmail" type="email"/><Field settings={settings} onChange={update} label="Téléphone" name="phone" type="tel"/><Field settings={settings} onChange={update} label="Adresse" name="address"/><Field settings={settings} onChange={update} label="Code postal" name="postalCode"/><Field settings={settings} onChange={update} label="Ville" name="city"/><Field settings={settings} onChange={update} label="Canton / région / état" name="region"/></div><Textarea settings={settings} onChange={update} label="Adresse de facturation" name="billingAddress" hint="À renseigner uniquement si elle diffère de l’adresse principale."/></Section>
    <Section title="Paiements et facturation" description="Données nécessaires à l’émission de factures et aux paiements."><div className={styles.grid3}><Select settings={settings} onChange={update} label="Devise de facturation" name="billingCurrency" options={[["CHF","CHF"],["EUR","EUR"],["USD","USD"]]}/><Field settings={settings} onChange={update} label="Début de la facturation" name="billingStart" type="date"/><Field settings={settings} onChange={update} label="Nom légal" name="legalName"/><Field settings={settings} onChange={update} label="Numéro TVA / fiscal" name="taxNumber"/><Field settings={settings} onChange={update} label="Référence de facture" name="invoiceReference"/><Field settings={settings} onChange={update} label="Moyens de paiement acceptés" name="paymentMethods" hint="Ex. carte, virement"/><Field settings={settings} onChange={update} label="Conditions de paiement" name="paymentTerms" hint="Ex. 30 jours"/></div><div className={styles.grid2}><Textarea settings={settings} onChange={update} label="Adresse de facturation" name="invoiceAddress"/><Textarea settings={settings} onChange={update} label="Taxes applicables" name="taxes" hint="Précisez les taxes, taux et cas particuliers."/></div></Section>
    {organization.org_type !== "federation" ? <OrganizationPartnersAdmin organizationId={organizationId} isAcademy={organization.org_type==='academy'}/> : null}
    <section className={styles.dangerZone}><div><span className={styles.dangerIcon}><AlertTriangle size={18}/></span><div><h2>Zone dangereuse</h2><p>La suppression d’une organisation est irréversible et entraîne la suppression de ses paramètres.</p></div></div><button type="button" className={styles.dangerButton} onClick={deleteOrganization} disabled={saving}><Trash2 size={15}/>{saving ? "Suppression…" : "Supprimer l’organisation"}</button></section>
    <div className={styles.saveActions}><button type="button" className={styles.primaryButton} onClick={save} disabled={saving}><Save size={16}/>{saving ? "Enregistrement…" : "Enregistrer les paramètres"}</button></div>
  </div>;
}
