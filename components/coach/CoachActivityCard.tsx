"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarClock, ClipboardList, Eye, MapPin } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale } from "@/lib/i18n/coachMessages";
import { coachCalendarActionHref, type CoachCalendarActionState } from "@/lib/coachCalendar";
import styles from "./CoachActivityCard.module.css";

export type CoachActivityCardProps = {
  startsAt: string; endsAt?: string | null; typeLabel: string; title?: string | null;
  groupName?: string | null; clubName?: string | null; showClub?: boolean;
  location?: string | null; href?: string; actions?: ReactNode; children?: ReactNode;
  variant?: "card" | "list";
};

/** One date block and three content lines, shared by every Coach activity list. */
export default function CoachActivityCard({ startsAt, endsAt, typeLabel, title, groupName, clubName, showClub = false, location, href, actions, children, variant = "card" }: CoachActivityCardProps) {
  const { locale, t } = useI18n();
  const date = new Date(startsAt);
  const format = (options: Intl.DateTimeFormatOptions, value = date) => new Intl.DateTimeFormat(coachDateLocale(locale), options).format(value);
  const label = `${typeLabel}${title?.trim() && title.trim() !== typeLabel ? ` · ${title.trim()}` : ""}`;
  return <article className={variant === "list" ? styles.listItem : styles.card}>
    <div className={styles.row}>
      <div className={styles.date} aria-label={format({ dateStyle: "full", timeStyle: "short" })}>
        <span>{format({ weekday: "short" }).replace(".", "")}</span><b>{date.getDate()}</b><span>{format({ month: "short" }).replace(".", "")}</span>
        <time dateTime={startsAt}>{format({ hour: "2-digit", minute: "2-digit" })}</time>
        {endsAt ? <time dateTime={endsAt}>{format({ hour: "2-digit", minute: "2-digit" }, new Date(endsAt))}</time> : null}
      </div>
      <div className={styles.body}>
        {href ? <Link className={styles.title} href={href}>{label}</Link> : <h3 className={styles.title}>{label}</h3>}
        <div className={styles.meta}>{groupName || t("coach.activity.noGroup")}{showClub && clubName ? ` · ${clubName}` : ""}</div>
        <div className={styles.location}><MapPin size={14} aria-hidden="true"/><span>{location?.trim() || t("coach.activity.noPlace")}</span></div>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
    {children ? <div className={styles.details}>{children}</div> : null}
  </article>;
}

export function CoachActivityAction({ state, groupId, eventId, href, name }: { state: CoachCalendarActionState; groupId: string; eventId: string; href?: string; name?: string }) {
  const { t } = useI18n();
  const pending = state === "needs_evaluation";
  const prepare = state === "prepare_training";
  const Icon = pending ? ClipboardList : prepare ? CalendarClock : Eye;
  const label = t(pending ? "coachCalendar.toEvaluate" : prepare ? "coachCalendar.prepareTraining" : state === "evaluation_complete" ? "coachCalendar.evaluationComplete" : "coachCalendar.viewActivity");
  return <Link className={`${styles.action} ${pending ? styles.pending : prepare ? styles.prepare : styles.view}`} href={href ?? coachCalendarActionHref(state, groupId, eventId)} title={label} aria-label={name ? `${label} — ${name}` : label}><Icon size={18} aria-hidden="true"/></Link>;
}
