import type { AppLocale } from "./i18n/messages.ts";
import { managerContentEntries } from "./i18n/managerContentMessages.ts";
import { managerCount, managerFormat, managerLocaleTag, type ManagerTranslate } from "./managerLocale.ts";

// API validation messages predate localization. Only known UI messages are mapped;
// user-authored camp/news content and unknown diagnostics are never translated.
const errorKeys = new Map(Object.entries(managerContentEntries).flatMap(([key, values]) => values.map(value => [value, key] as const)));
for (const [value, key] of Object.entries({
  "Missing token": "invalidSession", "Invalid token": "invalidSession", "Unauthorized": "invalidSession",
  "Forbidden": "forbidden", "Upload impossible.": "uploadError", "Stage/camp introuvable.": "campNotFound",
  "title required": "campNameRequired", "club_id required": "chooseOrganization",
  "Le head coach est requis pour planifier le stage.": "headRequired",
  "Un head coach est requis dès qu’une journée est définie.": "headRequired",
})) errorKeys.set(value, key);

export function managerContentPresentation(t: ManagerTranslate, locale: AppLocale) {
  return {
    format: (key: string, values: Record<string, string | number>) => managerFormat(t, `manager.content.${key}`, values),
    count: (key: string, value: number) => managerCount(t, locale, `manager.content.${key}`, value),
    number: (value: number) => value.toLocaleString(managerLocaleTag(locale)),
    errorText: (value: string | null | undefined) => value && errorKeys.has(value) ? t(`manager.content.${errorKeys.get(value)}`) : value,
    ageBandLabel: (key: string, fallback: string) => key === "u10" ? t("manager.content.ageUnder10") : key === "adult" ? t("manager.content.adult") : fallback,
  };
}
