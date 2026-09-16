"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Languages, RotateCcw, Save, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { messages, type AppLocale } from "@/lib/i18n/messages";
import styles from "./TranslationsAdmin.module.css";

type Row = { locale: AppLocale; key: string; value: string };
const locales: Array<{ id: AppLocale; label: string; code: string }> = [
  { id: "fr", label: "Français", code: "FR" }, { id: "en", label: "English", code: "EN" },
  { id: "de", label: "Deutsch", code: "DE" }, { id: "it", label: "Italiano", code: "IT" },
];

export default function TranslationsAdmin() {
  const [locale, setLocale] = useState<AppLocale>("fr");
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function token() { const { data } = await supabase.auth.getSession(); return data.session?.access_token ?? null; }
  async function load() {
    setLoading(true); setError(null);
    try {
      const accessToken = await token(); if (!accessToken) throw new Error("Pas de session.");
      const response = await fetch(`/api/admin/translations?locale=${locale}`, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Erreur de chargement.");
      const list = (data.rows ?? []) as Row[]; setRows(list); setDraft(Object.fromEntries(list.map((row) => [row.key, row.value])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de chargement."); setRows([]); setDraft({}); }
    finally { setLoading(false); }
  }
  // The language change is the intentional trigger for reloading this editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [locale]);

  const base = useMemo(() => messages[locale] ?? {}, [locale]);
  const overrides = useMemo(() => Object.fromEntries(rows.map((row) => [row.key, row.value])), [rows]);
  const keys = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("fr");
    return Array.from(new Set([...Object.keys(base), ...Object.keys(overrides)])).sort((a, b) => a.localeCompare(b)).filter((key) => !normalized || `${key} ${base[key] ?? ""} ${draft[key] ?? ""}`.toLocaleLowerCase("fr").includes(normalized));
  }, [base, draft, overrides, query]);
  const activeLocale = locales.find((item) => item.id === locale)!;

  async function save(key: string, nextValue = draft[key] ?? "") {
    setSavingKey(key); setError(null); setNotice(null);
    try {
      const accessToken = await token(); if (!accessToken) throw new Error("Pas de session.");
      const response = await fetch("/api/admin/translations", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ locale, key, value: nextValue }) });
      const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error ?? "Erreur de sauvegarde.");
      setNotice(nextValue.trim() ? "Traduction enregistrée." : "Traduction réinitialisée."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Erreur de sauvegarde."); }
    finally { setSavingKey(null); }
  }

  return <div className={styles.page}>
    <nav className={styles.breadcrumb}><Link href="/admin">Administration</Link><ChevronRight size={14}/><span>Traductions</span></nav>
    <div className={styles.topline}><div><h1>Traductions</h1><p>Adaptez les textes de l’application, langue par langue.</p></div><div className={styles.summary}><Languages size={19}/><span><b>{rows.length}</b> personnalisation{rows.length > 1 ? "s" : ""}</span></div></div>
    {error ? <div className={styles.errorAlert}>{error}</div> : null}{notice ? <div className={styles.successAlert}><Check size={16}/>{notice}</div> : null}
    <section className={styles.panel}><div className={styles.panelTop}><h2>Éditeur de langue</h2><p>Comparez la valeur de référence puis saisissez la version adaptée.</p></div>
      <div className={styles.toolbar}><div className={styles.localeTabs}><span>Langue</span>{locales.map((item) => <button key={item.id} type="button" aria-pressed={locale === item.id} onClick={() => { setLocale(item.id); setQuery(""); }}><i>{item.code}</i>{item.label}</button>)}</div><div className={styles.search}><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une clé ou un texte" style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: 12, fontWeight: 500, lineHeight: 1.2, letterSpacing: "0.01em", paddingLeft: 34 }} /></div></div>
      <div className={styles.tableMeta}><span>{loading ? "Chargement…" : `${keys.length} texte${keys.length > 1 ? "s" : ""}`}</span><span>{activeLocale.code} · {activeLocale.label}</span></div>
      {loading ? <div className={styles.loading}>Chargement des traductions…</div> : keys.length === 0 ? <div className={styles.loading}>Aucun texte ne correspond à votre recherche.</div> : <div className={styles.tableFrame}><table className={styles.table}><thead><tr><th>Clé</th><th>Référence</th><th>Traduction {activeLocale.code}</th><th>Actions</th></tr></thead><tbody>{keys.map((key, index) => { const isOverride = key in overrides; const busy = savingKey === key; return <tr key={key} className={index % 2 ? styles.alternate : ""}><td data-label="Clé"><code>{key}</code>{isOverride ? <span className={styles.override}>Personnalisée</span> : null}</td><td data-label="Référence"><p>{base[key] ?? "—"}</p></td><td data-label={`Traduction ${activeLocale.code}`}><textarea value={draft[key] ?? overrides[key] ?? ""} placeholder={base[key] ?? "Saisir la traduction"} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /></td><td className={styles.actionCell}><button type="button" className={styles.saveButton} onClick={() => void save(key)} disabled={busy}><Save size={14}/>{busy ? "…" : "Enregistrer"}</button>{isOverride ? <button type="button" className={styles.resetButton} onClick={() => { setDraft((current) => ({ ...current, [key]: "" })); void save(key, ""); }} disabled={busy} aria-label={`Réinitialiser ${key}`}><RotateCcw size={14}/></button> : null}</td></tr>; })}</tbody></table></div>}
    </section>
  </div>;
}
