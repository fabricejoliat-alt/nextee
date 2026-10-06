"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import styles from "../LegalPublic.module.css";

export default function LegalRequestPage() {
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState("access");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/legal/data-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, kind, description }) });
      setStatus(response.ok ? "Demande reçue. Une vérification de votre identité sera nécessaire avant toute action." : "Demande indisponible. Contactez l’assistance.");
      if (response.ok) setDescription("");
    } catch { setStatus("Demande indisponible. Contactez l’assistance."); }
    finally { setBusy(false); }
  }
  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/">Accueil</Link><span aria-hidden="true">/</span><Link href="/legal">Documents juridiques</Link><span aria-hidden="true">/</span><span>Mes données</span></nav>
    <span className={styles.eyebrow}><ShieldCheck size={17} aria-hidden="true" /> Protection des données</span>
    <h1 className={styles.heading}>Mes données personnelles</h1>
    <p className={styles.lead}>Vous pouvez demander l’accès, la rectification ou la suppression de vos données. Nous vérifions votre identité avant de traiter une demande.</p>
    <section className={styles.section} aria-labelledby="request-title"><h2 id="request-title">Faire une demande</h2>
      <p>Une demande de suppression est examinée avant toute suppression effective. Elle ne supprime pas immédiatement le compte ou les données.</p>
      <form className={styles.form} onSubmit={submit}>
        <label className={styles.field}>Adresse e-mail<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className={styles.field}>Type de demande<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="access">Accès</option><option value="rectification">Rectification</option><option value="erasure">Suppression</option><option value="other">Autre</option></select></label>
        <label className={styles.field}>Précisions<textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <button className={styles.primary} type="submit" disabled={busy}>{busy ? "Envoi…" : "Envoyer la demande"} <ArrowRight size={16} aria-hidden="true" /></button>
        {status && <p role="status" className={`${styles.status} ${status.startsWith("Demande indisponible") ? styles.error : ""}`}>{status}</p>}
      </form>
    </section>
    <footer className={styles.footer}><Link href="/legal">Documents juridiques</Link><Link href="/contact">Contact</Link></footer>
  </main>;
}
