"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";
import { managerPerformanceFormatters } from "@/lib/managerPerformancePresentation";

export function useManagerPerformanceLabels() {
  const { t, locale } = useI18n();
  return { t, locale, ...managerPerformanceFormatters(t, locale) };
}
