"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, messages, type AppLocale } from "@/lib/i18n/messages";

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (next: AppLocale) => void;
  t: (key: string) => string;
};

const STORAGE_KEY = "app_locale";

const I18nContext = createContext<I18nContextValue | null>(null);

export default function AppI18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "fr" || raw === "en") setLocaleState(raw);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/i18n/messages?locale=${locale}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        setOverrides((json.overrides ?? {}) as Record<string, string>);
      } catch {
        if (!cancelled) setOverrides({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: (next) => setLocaleState(next),
      t: (key) => overrides[key] ?? messages[locale][key] ?? messages.fr[key] ?? key,
    }),
    [locale, overrides]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within AppI18nProvider.");
  }
  return ctx;
}
