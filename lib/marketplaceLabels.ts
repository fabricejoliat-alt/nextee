import type { AppLocale } from "@/lib/i18n/messages";

export const MARKETPLACE_CONDITIONS = ["New", "Like new", "Good condition", "To repair"] as const;

type MarketplaceCondition = (typeof MARKETPLACE_CONDITIONS)[number];

const CONDITION_LABELS: Record<AppLocale, Record<MarketplaceCondition, string>> = {
  fr: {
    New: "Neuf",
    "Like new": "Comme neuf",
    "Good condition": "Bon état",
    "To repair": "À réparer",
  },
  en: {
    New: "New",
    "Like new": "Like new",
    "Good condition": "Good condition",
    "To repair": "To repair",
  },
  de: {
    New: "Neu",
    "Like new": "Wie neu",
    "Good condition": "Guter Zustand",
    "To repair": "Reparaturbedürftig",
  },
  it: {
    New: "Nuovo",
    "Like new": "Come nuovo",
    "Good condition": "Buone condizioni",
    "To repair": "Da riparare",
  },
};

export function marketplaceConditionLabel(locale: AppLocale, value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  if (!MARKETPLACE_CONDITIONS.includes(normalized as MarketplaceCondition)) return normalized;
  return CONDITION_LABELS[locale][normalized as MarketplaceCondition];
}
