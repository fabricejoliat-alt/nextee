import Link from "next/link";
import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import styles from "./HomeActivityCard.module.css";

type Props = {
  startsAt: string;
  dateLocale: string;
  title: string;
  detail: string;
  location: string;
  href: string;
  action?: ReactNode;
};

/** The same activity layout for Player and Coach home, with role-specific content/actions. */
export default function HomeActivityCard({ startsAt, dateLocale, title, detail, location, href, action }: Props) {
  const date = new Date(startsAt);
  const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(dateLocale, options).format(date);

  return <article className={styles.activityItem}>
    <div className={styles.activityDate} aria-label={format({ dateStyle: "full", timeStyle: "short" })}>
      <span>{format({ weekday: "short" }).replace(".", "")}</span>
      <b>{date.getDate()}</b>
      <span>{format({ month: "short" }).replace(".", "")}</span>
      <time dateTime={startsAt}>{format({ hour: "2-digit", minute: "2-digit" })}</time>
    </div>
    <div className={styles.activityBody}>
      <Link className={styles.activityTitle} href={href}>{title}</Link>
      <span className={styles.activityMeta}>{detail}</span>
      <span className={styles.activityLocation}><MapPin size={14} aria-hidden="true" /><span>{location}</span></span>
    </div>
    {action}
  </article>;
}
