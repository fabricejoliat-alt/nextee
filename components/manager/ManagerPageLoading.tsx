"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";
import { ListLoadingBlock } from "@/components/ui/LoadingBlocks";
import styles from "@/components/admin/AdminHomeStats.module.css";

export default function ManagerPageLoading() {
  const { t } = useI18n();
  return <section className={styles.quickPanel}><ListLoadingBlock label={t("common.loading")} /></section>;
}
