import type { AppLocale } from "./i18n/messages.ts";

export type ManagerTranslate = (key: string) => string;
export const managerLocaleTag = (locale: AppLocale) => locale === "en" ? "en-GB" : `${locale}-CH`;

/** Replace complete tokens so a name containing another token is never interpolated twice. */
export function managerFormat(t: ManagerTranslate, key: string, values: Record<string, string | number>) {
  return t(key).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}

export function managerCount(t: ManagerTranslate, locale: AppLocale, key: string, count: number) {
  const category = new Intl.PluralRules(locale).select(count) === "one" ? "one" : "other";
  return managerFormat(t, `${key}.${category}`, { count: count.toLocaleString(managerLocaleTag(locale)) });
}

export function managerActivityLabel(t: ManagerTranslate, type: string) {
  return ["training", "interclub", "camp", "session", "competition", "event"].includes(type)
    ? t(`manager.activity.${type}`) : type;
}
