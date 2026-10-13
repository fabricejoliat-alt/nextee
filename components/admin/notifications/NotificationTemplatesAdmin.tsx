"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, ChevronRight, Languages, Save } from "lucide-react";
import { adminFetch } from "@/lib/adminFetch";
import { supabase } from "@/lib/supabaseClient";
import { NOTIFICATION_LOCALES, notificationTemplateDefaults, notificationVariableExamples, renderNotificationTemplate,
  validateNotificationTemplate, type NotificationLocale, type TemplatePair } from "@/lib/notificationCatalog";
import styles from "./NotificationTemplatesAdmin.module.css";
type TranslationSet = Record<NotificationLocale, TemplatePair>;
const languageNames = { fr: "Français", en: "Anglais", de: "Allemand", it: "Italien" };
const roleNames = { player: "Joueur / parent", coach: "Coach", manager: "Manager" };
const defaults = () => Object.fromEntries(Object.entries(notificationTemplateDefaults).map(([key, value]) => [key,
  Object.fromEntries(NOTIFICATION_LOCALES.map(locale => [locale, { ...value[locale] }])) as TranslationSet]));
export default function NotificationTemplatesAdmin() {
  const [drafts, setDrafts] = useState(defaults);
  const [selected, setSelected] = useState(Object.keys(notificationTemplateDefaults)[0]);
  const [locale, setLocale] = useState<NotificationLocale>("fr");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [translationAvailable, setTranslationAvailable] = useState(false);
  const [translatedSource, setTranslatedSource] = useState<Record<string, string>>({});
  const [activeField, setActiveField] = useState<keyof TemplatePair>("body");
  async function request(path: string, input?: object) {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Session expirée.");
    const response = await adminFetch(`/api/admin/notification-templates${path}`, {
      method: input ? "POST" : "GET", cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}`, ...(input ? { "Content-Type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Opération indisponible.");
    return result;
  }
  useEffect(() => {
    let active = true;
    void request("").then(result => {
      if (!active) return;
      const next = defaults();
      for (const row of result.rows ?? []) {
        const field = row.key.endsWith(".title") ? "title" : "body";
        const key = row.key.replace(/\.(title|body)$/, "");
        if (next[key]?.[row.locale as NotificationLocale]) next[key][row.locale as NotificationLocale][field] = row.value;
      }
      setDrafts(next); setTranslatedSource(Object.fromEntries(Object.entries(next).map(([key, value]) => [key, JSON.stringify(value.fr)])));
      setTranslationAvailable(result.translationAvailable === true); setLoaded(true);
    }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const template = notificationTemplateDefaults[selected];
  const current = drafts[selected];
  const stale = translatedSource[selected] !== JSON.stringify(current.fr);
  const invalid = validateNotificationTemplate(selected, current[locale]);
  const overrides = { [`${selected}.title`]: current[locale].title, [`${selected}.body`]: current[locale].body };
  const preview = renderNotificationTemplate(selected, locale, notificationVariableExamples, overrides);
  function edit(field: keyof TemplatePair, value: string) {
    setDrafts(all => ({ ...all, [selected]: { ...all[selected], [locale]: { ...all[selected][locale], [field]: value } } }));
    setNotice(""); setError("");
  }
  async function translate() {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(""); setNotice("");
    const key = selected; const source = { ...current.fr };
    try {
      const result = await request("/translate", { key, source });
      setDrafts(all => ({ ...all, [key]: { fr: source, ...result.translations } }));
      setTranslatedSource(all => ({ ...all, [key]: JSON.stringify(source) }));
      setNotice("Les trois traductions sont prêtes. Vérifiez les aperçus puis enregistrez les quatre langues.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Traduction impossible."); }
    finally { setBusy(false); busyRef.current = false; }
  }
  async function save() {
    if (busyRef.current || stale) return; busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { await request("", { key: selected, translations: current }); setNotice("Les quatre langues sont enregistrées pour les notifications de l’application et les push."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setBusy(false); busyRef.current = false; }
  }
  return <div className={styles.page}>
    <nav className={styles.breadcrumb}><Link href="/admin">Administration</Link><ChevronRight size={14}/><span>Notifications</span></nav>
    <div className={styles.topline}><div><h1>Notifications</h1><p>Textes, destinataires et déclencheurs des notifications dans ActiviTee et des push.</p></div></div>
    {error && <div className={styles.errorAlert} role="alert">{error}</div>}
    {notice && <div className={styles.successAlert} role="status">{notice}</div>}
    {loading ? <p className={styles.loading}>Chargement des modèles…</p> : !loaded ? <p className={styles.help}>Rechargez cette page pour réessayer.</p> : <div className={styles.workspace}>
      <aside className={styles.panel}><label className={styles.field}><b>Rechercher un modèle</b><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Évaluation, présence, message…"/></label>
        <div className={styles.modelList}>{Object.entries(notificationTemplateDefaults).filter(([, item]) => item.label.toLowerCase().includes(query.toLowerCase())).map(([key,item]) => <button type="button" key={key} disabled={busy} aria-pressed={selected === key} onClick={() => { setSelected(key); setError(""); setNotice(""); }}><strong>{item.label}</strong><small>{item.roles.map(role => roleNames[role]).join(" · ")}</small></button>)}</div>
        <p className={styles.help}>Les points d’attention « Évaluations à terminer » sont calculés à l’ouverture de l’accueil coach. Ils ne déclenchent pas de push automatique.</p>
      </aside>
      <section className={styles.panel}>
        <div className={styles.panelTop}><h2>{template.label}</h2><p>{template.trigger}</p></div>
        <div className={styles.localeTabs}>{NOTIFICATION_LOCALES.map(value => <button type="button" key={value} disabled={busy} aria-pressed={locale === value} onClick={() => setLocale(value)}>{languageNames[value]}</button>)}</div>
        <label className={styles.field}><b>Titre — {languageNames[locale]}</b><input disabled={busy} maxLength={160} value={current[locale].title} onFocus={() => setActiveField("title")} onChange={event => edit("title", event.target.value)}/></label>
        <label className={styles.field}><b>Message — {languageNames[locale]}</b><textarea disabled={busy} maxLength={1200} value={current[locale].body} onFocus={() => setActiveField("body")} onChange={event => edit("body", event.target.value)}/></label>
        <div className={styles.variables}><strong>Variables disponibles</strong><p>Cliquez pour ajouter une variable au dernier champ utilisé.</p><div>{template.variables.map(variable => <button type="button" key={variable} disabled={busy} title={`Exemple : ${notificationVariableExamples[variable]}`} onClick={() => edit(activeField, `${current[locale][activeField]} {${variable}}`)}>{`{${variable}}`}</button>)}</div></div>
        {invalid && <p className={styles.errorAlert}>{invalid}</p>}
        <div className={styles.preview} aria-label="Exemple de notification"><div><Bell size={18}/><strong>ActiviTee</strong><span>maintenant</span></div><b>{preview.title}</b><p>{preview.body}</p><small>Aperçu avec des données fictives · {languageNames[locale]}</small></div>
        {stale && <p className={styles.help}>Le français a changé : régénérez les trois traductions avant d’enregistrer.</p>}
        {!translationAvailable && <p className={styles.help}>La traduction IA doit être configurée pour générer les trois autres langues.</p>}
        <div className={styles.actions}><button type="button" className={styles.resetButton} disabled={busy || !translationAvailable || Boolean(validateNotificationTemplate(selected,current.fr))} onClick={() => void translate()}><Languages size={16}/>{busy ? "Traitement…" : "Traduire et prévisualiser EN / DE / IT"}</button><button type="button" className={styles.saveButton} disabled={busy || stale || Boolean(invalid)} onClick={() => void save()}><Save size={16}/>Enregistrer les 4 langues</button></div>
      </section>
    </div>}
  </div>;
}
