import Link from "next/link";
import { MessageCircle } from "lucide-react";
import PublicPageShell from "@/components/public/PublicPageShell";
import { publicContactEmail } from "@/lib/server/publicContact";
import ContactForm from "./ContactForm";
import styles from "../legal/LegalPublic.module.css";

export const dynamic = "force-dynamic";
const TEST_SITE_KEY = "1x00000000000000000000AA";

export default async function ContactPage() {
  const email = await publicContactEmail();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    || (process.env.NODE_ENV === "production" ? "" : TEST_SITE_KEY);
  return <PublicPageShell><main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Fil d’Ariane"><Link href="/">Accueil</Link><span aria-hidden="true">/</span><span>Contact</span></nav>
    <span className={styles.eyebrow}><MessageCircle size={17} aria-hidden="true" /> Nous contacter</span>
    <h1 className={styles.heading}>Une question ? Écrivez-nous.</h1>
    <p className={styles.lead}>Pour une question sur ActiviTee, votre accès ou l’utilisation de la plateforme, utilisez ce formulaire sécurisé.</p>
    <ContactForm siteKey={siteKey} contactEmail={email} />
    <footer className={styles.footer}><Link href="/legal">Documents juridiques</Link><Link href="/legal/request">Mes données</Link></footer>
  </main></PublicPageShell>;
}
