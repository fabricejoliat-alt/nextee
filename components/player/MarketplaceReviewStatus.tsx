"use client";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { marketplaceSafetyText } from "@/lib/marketplaceSafetyLabels";
import InlineNotice from "@/components/ui/InlineNotice";

export default function MarketplaceReviewStatus({ status, note, className }: { status: string; note?: string | null; className?: string }) {
  const { locale } = useI18n();
  if (status === "approved") return null;
  return <InlineNotice className={className} variant={status === "rejected" ? "error" : "warning"}
    title={marketplaceSafetyText(locale, status === "rejected" ? "rejected" : "pending")}>
    {note && <p>{note}</p>}
    {status !== "rejected" && <p>{marketplaceSafetyText(locale, "reviewNotice")}</p>}
  </InlineNotice>;
}
