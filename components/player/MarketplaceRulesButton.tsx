"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BookOpen, Mail, X } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import { marketplaceLegalPaths, marketplaceRulesContent } from "@/lib/marketplaceRulesContent";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import ruleStyles from "@/components/rules/PlayerRulesWorkspace.module.css";
import playerUi from "./PlayerUI.module.css";
import styles from "./MarketplaceRulesButton.module.css";

function MarketplaceRulesDialog({ onClose }: { onClose: () => void }) {
  const { locale, t } = useI18n();
  const titleId = useId();
  const [email, setEmail] = useState<string | null>(null);
  const [title, introduction, ...paragraphs] = marketplaceRulesContent[locale];
  const headings = ["rulesConduct", "rulesReview", "rulesSafety", "rulesMessages", "rulesHelp", "rulesJuniors"] as const;
  useEffect(() => {
    const controller = new AbortController();
    async function loadContact() {
      try {
        const response = await fetch("/api/marketplace/rules", { signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (typeof result.email === "string" && !controller.signal.aborted) setEmail(result.email);
      } catch { /* The contact form remains available if the email cannot be loaded. */ }
    }
    void loadContact();
    return () => controller.abort();
  }, []);
  return <AccessibleDialog className={`${ruleStyles.dialog} ${styles.dialog}`} labelledBy={titleId} onClose={onClose}>
    <button type="button" className={ruleStyles.mobileBack} onClick={onClose}><ArrowLeft size={19} aria-hidden="true" />{t("common.back")}</button>
    <button type="button" className={ruleStyles.close} onClick={onClose} aria-label={t("common.close")}><X size={20} aria-hidden="true" /></button>
    <div className={ruleStyles.dialogBody}>
      <span className={ruleStyles.dialogKicker}>Marketplace</span>
      <h2 id={titleId}>{title}</h2>
      <p className={styles.introduction}>{introduction}</p>
      {paragraphs.map((paragraph, index) => <section className={ruleStyles.dialogSection} key={headings[index]}>
        <h3 className={styles.sectionTitle}>{marketplaceSafetyText(locale, headings[index])}</h3><p>{paragraph}</p>
      </section>)}
      <div className={styles.documents}>
        <p>{marketplaceSafetyText(locale, "rulesDocuments")}</p>
        <Link href={`${marketplaceLegalPaths.terms}?lang=${locale}`} onClick={onClose}>{marketplaceSafetyText(locale, "termsLink")}<ArrowUpRight size={15} aria-hidden="true" /></Link>
        <Link href={`${marketplaceLegalPaths.privacy}?lang=${locale}`} onClick={onClose}>{marketplaceSafetyText(locale, "privacyLink")}<ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div>
      <div className={styles.contact}>
        {email && <a className={styles.email} href={`mailto:${email}`}><Mail size={16} aria-hidden="true" />{email}</a>}
        <Link className={playerUi.secondary} href="/contact"><ArrowUpRight size={16} aria-hidden="true" />{marketplaceSafetyText(locale, "contactActiviTee")}</Link>
      </div>
      <button className={`${playerUi.primary} ${ruleStyles.done}`} type="button" onClick={onClose}><ArrowLeft size={16} aria-hidden="true" />{t("common.back")}</button>
    </div>
  </AccessibleDialog>;
}

export default function MarketplaceRulesButton({ className }: { className?: string }) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`${styles.trigger} ${className ?? ""}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <BookOpen size={15} aria-hidden="true" />{marketplaceSafetyText(locale, "rules")}
    </button>
    {open && <MarketplaceRulesDialog onClose={() => setOpen(false)} />}
  </>;
}
