"use client";

import { useI18n } from "@/components/i18n/AppI18nProvider";
import type { ReactNode } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import CoachActivityCard from "@/components/coach/CoachActivityCard";
import styles from "@/components/coach/CoachActivityCard.module.css";

type Props = {
  startsAt: string; endsAt?: string | null; dateLocale: string; typeLabel: string; title?: string;
  groupName: string; clubName: string; showClub?: boolean; location?: string | null; href?: string;
  actionLabel?: string; statusLabel?: string; actions?: ReactNode; children?: ReactNode;
};

export default function CoachPlayerActivityCard({ startsAt, endsAt, typeLabel, title, groupName, clubName, showClub = false, location, href, actionLabel, actions, children }: Props) {
  const { t } = useI18n();
  return <CoachActivityCard startsAt={startsAt} endsAt={endsAt} typeLabel={typeLabel} title={title} groupName={groupName}
    clubName={clubName} showClub={showClub} location={location} href={href}
    actions={actions ?? (href ? <Link className={`${styles.action} ${styles.view}`} href={href} title={actionLabel ?? t("coach.open")} aria-label={actionLabel ?? t("coach.open")}><Eye size={18} aria-hidden="true"/></Link> : null)}>
    {children}
  </CoachActivityCard>;
}
