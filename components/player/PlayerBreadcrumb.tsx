"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import styles from "./PlayerBreadcrumb.module.css";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

export default function PlayerBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const { t } = useI18n();

  return (
    <nav className={styles.breadcrumb} aria-label={t("common.breadcrumb")}>
      {items.map((item, index) => {
        const label = item.href === "/player" ? t("player.space") : item.label;
        const isCurrent = index === items.length - 1;
        return (
        <span key={`${item.label}-${index}`} style={{ display: "contents" }}>
          {index > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}
          {item.href ? <Link href={item.href}>{label}</Link> : <span aria-current={isCurrent ? "page" : undefined}>{label}</span>}
        </span>
        );
      })}
    </nav>
  );
}
