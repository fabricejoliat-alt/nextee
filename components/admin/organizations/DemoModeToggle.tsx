"use client";

import { useId } from "react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import styles from "./DemoModeToggle.module.css";

export default function DemoModeToggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const hintId = useId();
  return <label className={styles.control}>
    <span className={styles.copy}><strong>{t("organization.demoMode")}</strong><small id={hintId}>{t("organization.demoHint")}</small></span>
    <input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} aria-describedby={hintId} />
    <span className={styles.track} aria-hidden="true" />
  </label>;
}
