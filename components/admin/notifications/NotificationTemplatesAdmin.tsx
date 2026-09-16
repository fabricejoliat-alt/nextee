"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, Check, ChevronRight, RotateCcw, Save, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { notificationTemplateDefaults } from "@/lib/notificationMessages";
import styles from "./NotificationTemplatesAdmin.module.css";

type Locale = "fr" | "en" | "de" | "it";
type Row = { locale: Locale; key: string; value: string };
const locales: Array<{ id: Locale; label: string; code: string }> = [{ id: "fr", label: "Français", code: "FR" }, { id: "en", label: "English", code: "EN" }, { id: "de", label: "Deutsch", code: "DE" }, { id: "it", label: "Italiano", code: "IT" }];

export default function NotificationTemplatesAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [locale, setLocale] = useState<Locale>("fr");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const templates = useMemo(() => Object.entries(notificationTemplateDefaults).map(([key, value]) => ({ key, ...value })).sort((a, b) => a.key.localeCompare(b.key)), []);

  async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? null; }
  async function load() {
    setLoading(true); setError(null);
    try {
      const accessToken = await token(); if (!accessToken) throw new Error("Pas de session.");
      const responses = await Promise.all(locales.map(async ({ id }) => { const response = await fetch(`/api/admin/translations?locale=${id}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Erreur de chargement."); return (data.rows ?? []) as Row[]; }));
      const allRows = responses.flat(); setRows(allRows); setDraft(Object.fromEntries(allRows.map((row) => [`${row.locale}:${row.key}`, row.value])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de chargement."); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const overrides = useMemo(() => new Set(rows.map((row) => `${row.locale}:${row.key}`)), [rows]);
  const visibleTemplates = useMemo(() => { const normalized = query.trim().toLocaleLowerCase("fr"); return templates.filter((template) => !normalized || `${template.key} ${template.label}`.toLocaleLowerCase("fr").includes(normalized)); }, [query, templates]);
  const activeLocale = locales.find((item) => item.id === locale)!;
  function defaultText(template: typeof templates[number], field: "title" | "body") { return (template[locale] ?? template.en)[field]; }
  function draftKey(templateKey: string, field: "title" | "body") { return `${locale}:${templateKey}.${field}`; }
  async function saveOne(key: string, value: string, accessToken: string) { const response = await fetch("/api/admin/translations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ locale, key, value }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Erreur de sauvegarde."); }
  async function saveTemplate(templateKey: string, reset = false) {
    setSavingKey(templateKey); setError(null); setNotice(null);
    try {
      const accessToken = await token(); if (!accessToken) throw new Error("Pas de session.");
      await Promise.all(["title", "body"].map((field) => saveOne(`${templateKey}.${field}`, reset ? "" : draft[draftKey(templateKey, field as "title" | "body")] ?? "", accessToken)));
      setNotice(reset ? "Modèle réinitialisé." : "Modèle enregistré."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de sauvegarde."); }
    finally { setSavingKey(null); }
  }

  return <div className={styles.page}>
    <nav className={styles.breadcrumb}><Link href="/admin">Administration</Link><ChevronRight size={14}/><span>Notifications</span></nav>
    <div className={styles.topline}><div><h1>Notifications</h1><p>Personnalisez les titres et messages envoyés dans l’application.</p></div><div className={styles.summary}><Bell size={19}/><span><b>{rows.length}</b> texte{rows.length > 1 ? "s" : ""} personnalisé{rows.length > 1 ? "s" : ""}</span></div></div>
    {error ? <div className={styles.errorAlert}>{error}</div> : null}{notice ? <div className={styles.successAlert}><Check size={16}/>{notice}</div> : null}
    <section className={styles.panel}><div className={styles.panelTop}><h2>Modèles de notification</h2><p>Sélectionnez une langue et adaptez chaque message. Sans personnalisation, le texte de référence est utilisé.</p></div>
      <div className={styles.toolbar}><div className={styles.localeTabs}><span>Langue</span>{locales.map((item) => <button type="button" key={item.id} aria-pressed={locale === item.id} onClick={() => setLocale(item.id)}><i>{item.code}</i>{item.label}</button>)}</div><div style={{ position: "relative", width: "min(330px, 100%)" }}><Search size={16} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "#7c877d", pointerEvents: "none" }} aria-hidden="true"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un modèle" aria-label="Rechercher un modèle" style={{ boxSizing: "border-box", width: "100%", height: 42, padding: "0 11px 0 34px", border: "1px solid #dce3dc", borderRadius: 9, outline: 0, background: "#fff", color: "#1e2c20", fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", fontWeight: 500, lineHeight: 1.2, letterSpacing: "0.01em" }} /></div></div>
      <div className={styles.meta}><span>{loading ? "Chargement…" : `${visibleTemplates.length} modèle${visibleTemplates.length > 1 ? "s" : ""}`}</span><span>{activeLocale.code} · {activeLocale.label}</span></div>
      {loading ? <div className={styles.loading}>Chargement des modèles…</div> : <div className={styles.templateGrid}>{visibleTemplates.map((template) => { const titleKey = draftKey(template.key, "title"); const bodyKey = draftKey(template.key, "body"); const title = draft[titleKey] ?? defaultText(template, "title"); const body = draft[bodyKey] ?? defaultText(template, "body"); const changed = overrides.has(titleKey) || overrides.has(bodyKey); const busy = savingKey === template.key; return <article className={styles.template} key={template.key}><div className={styles.templateHead}><div><h3>{template.label}</h3><code>{template.key}</code></div>{changed ? <span>Personnalisé</span> : null}</div><label className={styles.field}><b>Titre</b><input value={title} onChange={(event) => setDraft((current) => ({ ...current, [titleKey]: event.target.value }))}/></label><label className={styles.field}><b>Message</b><textarea value={body} onChange={(event) => setDraft((current) => ({ ...current, [bodyKey]: event.target.value }))}/></label><div style={{ display: "grid", gap: 7, padding: 10, border: "1px solid #e0e7df", borderRadius: 10, background: "#f5f8f4" }}><span style={{ color: "#758178", fontSize: 9, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase" }}>Aperçu de la notification</span><div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}><i style={{ display: "grid", placeItems: "center", width: 27, height: 27, flex: "0 0 auto", borderRadius: 8, background: "var(--primary)", color: "#fff" }}><Bell size={15}/></i><p style={{ display: "grid", gap: 3, margin: 0, minWidth: 0 }}><b style={{ color: "#304236", fontSize: 11 }}>{title || "Titre de la notification"}</b><small style={{ display: "block", color: "#728076", fontSize: 10, lineHeight: 1.35 }}>{body || "Le contenu de la notification apparaîtra ici."}</small></p></div></div><div className={styles.actions}><button type="button" className={styles.saveButton} onClick={() => void saveTemplate(template.key)} disabled={busy}><Save size={14}/>{busy ? "…" : "Enregistrer"}</button>{changed ? <button type="button" className={styles.resetButton} onClick={() => { setDraft((current) => ({ ...current, [titleKey]: "", [bodyKey]: "" })); void saveTemplate(template.key, true); }} disabled={busy}><RotateCcw size={14}/>Réinitialiser</button> : null}</div></article>; })}</div>}
    </section>
  </div>;
}
