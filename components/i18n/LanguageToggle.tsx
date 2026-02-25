"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";

export default function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <button
      type="button"
      className="icon-btn lang-toggle"
      aria-label={t("common.switchLanguage")}
      title={t("common.switchLanguage")}
      onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
    >
      {locale.toUpperCase()}
    </button>
  );
}

