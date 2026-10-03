import type { AppLocale } from "./i18n/messages.ts";
import { managerSettingsEntries } from "./i18n/managerSettingsMessages.ts";
import { managerCount, managerFormat, type ManagerTranslate } from "./managerLocale.ts";

// Translate only known UI feedback. Club-authored names and unknown diagnostics stay intact.
const errorKeys = new Map(Object.entries(managerSettingsEntries).filter(([, values]) => !values[0].includes("{")).flatMap(([key, values]) => values.map(value => [value, key] as const)));
for (const [value, key] of Object.entries({
  "Missing token": "invalidSession", "Invalid token": "invalidSession", "Unauthorized": "invalidSession",
  "Forbidden": "forbidden", "Member not found": "memberNotFound",
  "Erreur de chargement.": "loadError", "Erreur de chargement du club.": "clubLoadError",
})) errorKeys.set(value, key);

export function managerSettingsPresentation(t: ManagerTranslate, locale: AppLocale) {
  return {
    format: (key: string, values: Record<string, string | number>) => managerFormat(t, `manager.settings.${key}`, values),
    count: (key: string, value: number) => managerCount(t, locale, `manager.settings.${key}`, value),
    errorText: (value: string | null | undefined) => value && errorKeys.has(value) ? t(`manager.settings.${errorKeys.get(value)}`) : value,
  };
}
