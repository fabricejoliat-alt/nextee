"use client";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import styles from "./MarketplaceSafety.module.css";

export default function MarketplaceReviewStatus({ status, note }: { status: string; note?: string | null }) {
  const { locale } = useI18n();
  if (status === "approved") return null;
  return <div className={styles.status} role="status">
    <strong>{marketplaceSafetyText(locale, status === "rejected" ? "rejected" : "pending")}</strong>
    {note && <p>{note}</p>}
    {status !== "rejected" && <p>{marketplaceSafetyText(locale, "reviewNotice")}</p>}
  </div>;
}
