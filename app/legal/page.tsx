import Link from "next/link";
import { ArrowRight, FileText, ShieldCheck, UserRound } from "lucide-react";
import { legalDb } from "@/lib/server/legalAccess";
import styles from "./LegalPublic.module.css";

export const dynamic = "force-dynamic";
export default async function LegalLanding() {
  let documents: Array<{ document_key: string; kind: string }> = [];
  try {
    const result = await legalDb().from("legal_documents").select("document_key,kind").eq("active", true)
      .in("kind", ["terms", "privacy"]).eq("scope", "platform");
    documents = result.data ?? [];
  } catch { /* Documents not yet available. */ }
  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/">Accueil</Link><span aria-hidden="true">/</span><span>Documents juridiques</span></nav>
    <span className={styles.eyebrow}><ShieldCheck size={17} aria-hidden="true" /> ActiviTee</span>
    <h1 className={styles.heading}>Documents juridiques</h1>
    <p className={styles.lead}>Consultez les conditions d’utilisation et les informations relatives à la protection de vos données.</p>
    {documents.length ? <div className={styles.cards}>{documents.map((doc) => <article key={doc.document_key} className={styles.card}>
      <span className={styles.icon}><FileText size={21} aria-hidden="true" /></span>
      <h2>{doc.kind === "terms" ? "Conditions d’utilisation" : "Confidentialité"}</h2>
      <p>{doc.kind === "terms" ? "Les règles d’utilisation de la plateforme ActiviTee." : "Comment les données personnelles sont utilisées et protégées."}</p>
      <Link href={`/legal/${doc.document_key}`}>Lire le document <ArrowRight size={16} aria-hidden="true" /></Link>
    </article>)}</div> : <p className={styles.empty}>Les documents publics seront disponibles après leur activation. Vous pouvez nous contacter pour toute question.</p>}
    <div className={styles.cards}><article className={`${styles.card} ${styles.cardWide}`}>
      <span className={styles.icon}><UserRound size={21} aria-hidden="true" /></span><h2>Vos données personnelles</h2>
      <p>Demandez l’accès, la rectification ou la suppression de vos données.</p><Link href="/legal/request">Faire une demande <ArrowRight size={16} aria-hidden="true" /></Link>
    </article></div>
    <footer className={styles.footer}><Link href="/contact">Contact</Link><Link href="/">Connexion</Link></footer>
  </main>;
}
