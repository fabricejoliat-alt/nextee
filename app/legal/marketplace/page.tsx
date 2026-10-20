import Link from "next/link";
import { marketplaceRulesContent } from "@/lib/marketplaceRulesContent";
import { publicContactEmail } from "@/lib/server/publicContact";
import styles from "../LegalPublic.module.css";

export const dynamic = "force-dynamic";

export default async function MarketplaceRules({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  const locale = lang === "en" || lang === "de" || lang === "it" ? lang : "fr";
  const [title, ...paragraphs] = marketplaceRulesContent[locale];
  const email = await publicContactEmail();
  return <main className={styles.page}>
    <nav className={styles.breadcrumb}><Link href="/player/marketplace">Marketplace</Link>
      {(["fr", "en", "de", "it"] as const).map(value => <Link key={value} href={`/legal/marketplace?lang=${value}`} lang={value} aria-current={locale === value ? "page" : undefined}>{value.toUpperCase()}</Link>)}</nav>
    <h1 className={styles.heading}>{title}</h1>
    <article className={styles.card}>{paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      <a href={`mailto:${email}`}>{email}</a><Link href="/contact">Contact ActiviTee</Link>
    </article>
  </main>;
}
