"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";

export default function CoachEventDetailLoading() {
  const { t } = useI18n();
  return <CompactLoadingBlock label={t("common.loading")} />;
}
