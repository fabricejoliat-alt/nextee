import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { legalDb } from "@/lib/server/legalAccess";
import styles from "../LegalPublic.module.css";

export const dynamic = "force-dynamic";
export default async function LegalText({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { kind } = await params; const { lang } = await searchParams;
  const locale = ["fr", "en", "de", "it"].includes(lang ?? "") ? lang! : "fr";
  const db = legalDb(); const doc = await db.from("legal_documents").select("id,kind").eq("document_key", kind)
    .eq("scope", "platform").eq("active", true).in("kind", ["terms", "privacy"]).maybeSingle();
  if (!doc.data) notFound();
  const version = await db.from("legal_versions").select("version_number,published_at,snapshot")
    .eq("document_id", doc.data.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const translations = version.data?.snapshot?.translations as Record<string, { title: string; body: string }> | undefined;
  const translation = translations?.[locale]; if (!translation) notFound();
  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/">Accueil</Link><span aria-hidden="true">/</span><Link href="/legal">Documents juridiques</Link></nav>
    <span className={styles.eyebrow}><FileText size={17} aria-hidden="true" /> Document ActiviTee</span>
    <h1 className={styles.heading}>{translation.title}</h1>
    <p className={styles.versionMeta}><span>Version {version.data?.version_number}</span><span aria-hidden="true">·</span><span>Publiée le {version.data?.published_at?.slice(0, 10)}</span></p>
    <nav className={styles.localeNav} aria-label="Langue du document">{["fr", "en", "de", "it"].filter((l) => translations?.[l]).map((l) => <Link key={l} href={`/legal/${kind}?lang=${l}`} className={l === locale ? styles.activeLocale : undefined} aria-current={l === locale ? "page" : undefined}>{l.toUpperCase()}</Link>)}</nav>
    <article className={styles.article}>{translation.body}</article>
    <footer className={styles.footer}><Link href="/legal">Tous les documents</Link><Link href="/legal/request">Mes données</Link><Link href="/contact">Contact</Link></footer>
  </main>;
}
