import type { AppLocale } from "./i18n/messages.ts";
import { managerLocaleTag } from "./managerLocale.ts";
export type OmKind = "contest" | "tournament";
export type OmGroup = { id: string; name: string | null; is_active: boolean | null; club_season_id: string | null };
export type OmRecord = { id: string; organization_id: string; version: string; title?: string; name?: string; description: string | null; group_id?: string | null; contest_date?: string; full_ranking?: unknown; starts_on?: string | null; ends_on?: string | null; is_active?: boolean };
export type OmPlayer = { id: string; first_name: string | null; last_name: string | null };
export type OmResult = { player_id: string; rank: number; note: string | null };
export type OmContestData = { contest: OmRecord; version: string; players: OmPlayer[]; results: OmResult[] };
export const omName = (player: OmPlayer, fallback: string) => [player.first_name,player.last_name].filter(Boolean).join(" ").trim() || fallback;
export const omStandardGroup = (group: OmGroup) => group.is_active !== false && Boolean(group.club_season_id) && !String(group.name ?? "").startsWith("__ARCHIVE_") && group.name !== "Groupe spécifique" && !String(group.name ?? "").startsWith("__EVENT_SPECIFIQUE__");
export function omDate(value: string | null | undefined, locale: AppLocale, fallback: string) {
 if (!value) return fallback;
 const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
 return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat(managerLocaleTag(locale),{day:"2-digit",month:"short",year:"numeric",timeZone:"Europe/Zurich"}).format(date);
}
export const omNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
export const omPoints = (value: unknown, locale: AppLocale) => new Intl.NumberFormat(managerLocaleTag(locale),{minimumFractionDigits:2,maximumFractionDigits:2}).format(omNumber(value));
/** Existing bonus generators store these English descriptions as data. Hide only their exact defaults. */
export function omBonusSubtitle(type: string, description: string | null) {
 const generated: Record<string, string> = {
  training_presence: "Club training attendance",
  camp_day_presence: "Club camp attendance",
  internal_contest_podium: "Internal contest podium",
 };
 return description === generated[type] ? null : description;
}
export function omError(cause: unknown) {
 const error = cause as { message?: string; code?: string } | null;
 const known = ["forbidden","invalid_request","invalid_fields","invalid_dates","invalid_group","invalid_player","duplicate_player","invalid_rankings","empty_confirmation_required","om_conflict","request_conflict","contest_not_found","tournament_not_found","tournament_in_use"];
 if (known.includes(error?.message ?? "")) return { key: error!.message!, definite: true };
 if (error?.code === "42501") return {key:"forbidden",definite:true};
 if (error?.code === "23505") return {key:"duplicate_name",definite:true};
 if (error?.code?.startsWith("22")) return {key:"invalid_fields",definite:true};
 if (["PGRST202","42883"].includes(error?.code ?? "")) return {key:"unavailable",definite:true};
 return {key:"unconfirmed",definite:false};
}
export function omText(t:(key:string)=>string,key:string,values:Record<string,string|number>={}) {
 return t(`managerOm.${key}`).replace(/\{(\w+)\}/g,(token,name:string)=>Object.hasOwn(values,name)?String(values[name]):token);
}
