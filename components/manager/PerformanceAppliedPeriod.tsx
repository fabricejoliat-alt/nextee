"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";
import styles from "@/components/manager/PerformanceAppliedPeriod.module.css";

function formatDate(value: string, locale: string) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : `${locale}-CH`, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Zurich" }).format(date);
}

export default function PerformanceAppliedPeriod({ from, to }: { from: string; to: string }) {
  const { t, locale } = useI18n();
  return <p className={styles.period}><span>{t("manager.period")}</span>{formatDate(from, locale)} – {formatDate(to, locale)}</p>;
}
