"use client";

import Link from "next/link";
import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { guide } from "./currentHelp";
import styles from "./PlayerHelp.module.css";

export default function PlayerHelpPage() {
  const { locale } = useI18n();
  const content = guide[locale];
  return <div className="player-dashboard-bg"><div className={`app-shell ${styles.page}`}>
    <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: content.title }]} />
    <header className={styles.header}><div><h1>{content.title}</h1><p>{content.intro}</p></div><Link href="/contact" className="cta-green cta-green-inline">{content.contact}</Link></header>
    <article className={styles.content} lang={locale}>
      <nav className={styles.contents} aria-label={content.title}><div className={styles.contentsLinks}>{content.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</div></nav>
      {content.sections.map((section) => <section className={styles.section} key={section.id} id={section.id}>
        <div className={styles.sectionHeading}><h2>{section.title}</h2></div>
        <div className={styles.block}><p>{section.text}</p><div className={styles.sectionLinks}>{section.links.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</div></div>
      </section>)}
    </article>
  </div></div>;
}
