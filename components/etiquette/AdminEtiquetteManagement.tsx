"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, CircleAlert, RefreshCw, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { etiquetteAdminText } from "@/lib/etiquetteAdminLabels";
import styles from "@/components/admin/rules/AdminRulesManagement.module.css";

type Version = { id: string; title: string; official_reference: string; editorial_status: string; approved_at: string | null };
type Card = { id: string; stable_key: string; position: number; published_version_id: string | null; latest: Version | null };
type Theme = { id: string; stable_key: string; position: number; title_i18n: Record<string, string>; status: string; cards: Card[] };

export default function AdminEtiquetteManagement() {
  const { locale } = useI18n();
  const a = etiquetteAdminText(locale);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const token = useCallback(async () => (await supabase.auth.getSession()).data.session?.access_token ?? "", []);
  const load = useCallback(async () => {
    try {
      const auth = await token();
      const response = await fetch("/api/admin/etiquette", { headers: { Authorization: `Bearer ${auth}` }, cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !Array.isArray(json.themes)) throw new Error(String(json.error ?? "Chargement impossible."));
      setThemes(json.themes);
      setSelectedId((current) => current || json.themes[0]?.id || "");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const selected = themes.find((theme) => theme.id === selectedId);
  useEffect(() => { setTitle(selected?.title_i18n.fr ?? ""); }, [selected]);
  const approved = selected?.cards.filter((card) => card.latest?.approved_at && card.latest.editorial_status === "approved").length ?? 0;
  async function act(action: "save_theme" | "publish") {
    if (!selected) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const auth = await token();
      const response = await fetch("/api/admin/etiquette", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
        body: JSON.stringify({ action, themeId: selected.id, title_fr: title }) });
      const json = await response.json();
      if (!response.ok) throw new Error(String(json.error ?? "Enregistrement impossible."));
      setNotice(action === "publish" ? "Le thème complet a été publié." : "Le titre a été enregistré.");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }
  if (loading) return <main className={styles.page} aria-busy="true"><div className={styles.loading}><i/><i/><i/></div></main>;
  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">{a.admin}</Link><ChevronRight size={14}/><span>{a.title}</span></nav>
    <header className={styles.topline}><div><p className={styles.eyebrow}>{a.content}</p><h1>{a.management}</h1><p className={styles.lead}>{a.managementLead}</p></div><div className={styles.summary}><BookOpen size={18}/><span><b>{themes.length}</b> {a.themes}</span></div></header>
    {error && <div className={styles.error} role="alert"><CircleAlert size={17}/>{error}</div>}{notice && <div className={styles.success} role="status"><CheckCircle2 size={17}/>{notice}</div>}
    <section className={styles.seriesLayout}><aside className={styles.seriesList}><div className={styles.listHead}><div><h2>{a.themes}</h2><p>{a.themesHint}</p></div><button type="button" onClick={() => void load()} aria-label={a.refresh}><RefreshCw size={16}/></button></div>
      {themes.map((theme) => <button type="button" key={theme.id} className={`${styles.seriesItem} ${theme.id === selectedId ? styles.active : ""}`} onClick={() => setSelectedId(theme.id)}><b>{String(theme.position).padStart(2, "0")}</b><span><strong>{theme.title_i18n[locale] ?? theme.title_i18n.fr}</strong><small>{theme.status === "published" ? a.published : a.review}</small></span>{theme.status === "published" ? <CheckCircle2 className={styles.validIcon} size={17}/> : <CircleAlert className={styles.invalidIcon} size={17}/>}</button>)}</aside>
      {selected && <section className={styles.panel}><div className={styles.panelHead}><div><span className={styles.panelIcon}><BookOpen size={18}/></span><div><h2>{a.theme} {String(selected.position).padStart(2, "0")} · {selected.title_i18n[locale] ?? selected.title_i18n.fr}</h2><p>{approved}/3 {a.approvedCount}</p></div></div><span className={`${styles.status} ${selected.status === "published" ? styles.published : ""}`}>{selected.status === "published" ? a.published : a.draft}</span></div>
        <div className={styles.formGrid}><label className={styles.full}><span>{a.frenchTitle}</span><input value={title} onChange={(event) => setTitle(event.target.value)}/></label></div>
        <div className={styles.cardsSection}><div><h3>{a.cards}</h3><p>{a.cardsHint}{locale !== "fr" ? ` · ${a.sourceFrench}` : ""}</p></div><div className={styles.cardsGrid}>{selected.cards.map((card) => <Link className={styles.cardLink} key={card.id} href={`/admin/etiquette/cards/${card.latest?.id}`}><b>{card.position}</b><span><strong lang="fr">{card.latest?.title ?? a.card}</strong><small lang="fr">{card.latest?.official_reference ?? "—"}</small></span><em className={card.latest?.approved_at ? styles.cardApproved : styles.cardReview}>{card.latest?.approved_at ? a.approved : a.toReview}</em><ChevronRight size={15}/></Link>)}</div></div>
        <div className={styles.readiness}><div className={approved === 3 ? styles.ready : styles.notReady}>{approved === 3 ? <CheckCircle2 size={18}/> : <CircleAlert size={18}/>}<span><b>{selected.status === "published" ? a.published : approved === 3 ? a.ready : a.required}</b><small>{a.publishHint}</small></span></div><div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => void act("save_theme")} disabled={saving}>{a.saveTheme}</button><button type="button" className={styles.primary} onClick={() => void act("publish")} disabled={saving || approved !== 3}><ShieldCheck size={15}/>{a.publishTheme}</button></div></div>
      </section>}</section>
  </main>;
}
