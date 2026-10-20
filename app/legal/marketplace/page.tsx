import Link from "next/link";
import { marketplaceLegalPaths, marketplaceRulesContent } from "@/lib/marketplaceRulesContent";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
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
      <p>{marketplaceSafetyText(locale, "rulesDocuments")}</p>
      <p><Link href={`${marketplaceLegalPaths.terms}?lang=${locale}`}>{marketplaceSafetyText(locale, "termsLink")}</Link></p>
      <p><Link href={`${marketplaceLegalPaths.privacy}?lang=${locale}`}>{marketplaceSafetyText(locale, "privacyLink")}</Link></p>
      <a href={`mailto:${email}`}>{email}</a><Link href="/contact">{marketplaceSafetyText(locale, "contactActiviTee")}</Link>
    </article>
  </main>;
}
