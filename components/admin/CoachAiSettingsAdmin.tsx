"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Save, Sparkles } from "lucide-react";
import { adminFetch } from "@/lib/adminFetch";
import { supabase } from "@/lib/supabaseClient";
import { COACH_REWRITE_INSTRUCTIONS_MAX } from "@/lib/coachAiRewriteInstructions";
import styles from "./ContactSettingsAdmin.module.css";
import promptStyles from "./CoachAiSettingsAdmin.module.css";

export default function CoachAiSettingsAdmin() {
  const [instructions, setInstructions] = useState("");
  const [defaults, setDefaults] = useState("");
  const [revision, setRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const response = await adminFetch("/api/admin/coach-ai-settings", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        if (active) { setInstructions(data.instructions); setDefaults(data.default_instructions); setRevision(data.revision); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Chargement impossible."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (revision === null || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const response = await adminFetch("/api/admin/coach-ai-settings", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ instructions, revision }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setInstructions(data.instructions); setRevision(data.revision); setNotice("Consignes enregistrées. Elles s’appliqueront aux prochaines reformulations.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }
  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/admin">Administration</Link><ChevronRight size={14} aria-hidden="true" /><span>Reformulation IA</span></nav>
    <header className={styles.heading}><span className={styles.eyebrow}>Plateforme</span><h1>Reformulation IA</h1><p>Consignes communes aux commentaires destinés aux juniors et aux notes privées des coachs.</p></header>
    <section className={`${styles.card} ${promptStyles.card}`} aria-labelledby="instructions-title">
      <div className={styles.cardHeading}><span className={styles.icon}><Sparkles size={19} aria-hidden="true" /></span><div><h2 id="instructions-title">Consignes de reformulation</h2><p>L’IA doit conserver chaque observation et sa correction. Les règles de confidentialité restent appliquées.</p></div></div>
      {loading ? <p role="status">Chargement…</p> : revision !== null && <form className={`${styles.form} ${promptStyles.form}`} onSubmit={save}>
        <label htmlFor="coach-rewrite-instructions">Indications données à l’IA</label>
        <textarea id="coach-rewrite-instructions" className={promptStyles.instructions} value={instructions} minLength={20} maxLength={COACH_REWRITE_INSTRUCTIONS_MAX} required rows={14} disabled={saving} onChange={event => { setInstructions(event.target.value); setNotice(""); }} aria-describedby="instructions-help" />
        <p id="instructions-help">Précisez le ton, la présentation et les détails à préserver. N’y mettez ni nom de joueur ni donnée personnelle. {instructions.length}/{COACH_REWRITE_INSTRUCTIONS_MAX} caractères.</p>
        <div className={styles.actions}><button type="submit" disabled={saving || instructions.trim().length < 20}><Save size={16} aria-hidden="true" />{saving ? "Enregistrement…" : "Enregistrer les consignes"}</button>
          <button type="button" disabled={saving} onClick={() => { setInstructions(defaults); setNotice("Consignes par défaut rétablies dans le formulaire. Enregistrez pour les appliquer."); }}>Rétablir les consignes par défaut</button></div>
        <p>Version {revision}. La relecture du coach reste nécessaire avant d’appliquer une proposition.</p>
      </form>}
      {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
    </section>
  </div>;
}
