"use client";
/* eslint-disable @next/next/no-img-element */

import { useI18n } from "@/components/i18n/AppI18nProvider";
import { coachDateLocale } from "@/lib/i18n/coachMessages";
import styles from "../../../app/coach/players/[playerId]/CoachPlayerDetail.module.css";

type Props = {
  avatarUrl: string;
  name: string;
  initials: string;
  handicap: number | null | undefined;
};

export default function CoachPlayerIdentity(props: Props) {
  const { locale, t } = useI18n();
  const handicap = typeof props.handicap === "number" && Number.isFinite(props.handicap)
    ? new Intl.NumberFormat(coachDateLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(props.handicap)
    : "—";

  return (
    <div className={styles.identity}>
      <div className={styles.avatar}>
        {props.avatarUrl ? <img src={props.avatarUrl} alt={props.name} /> : props.initials}
      </div>
      <div className={styles.identityCopy}>
        <strong className={styles.identityName}>{props.name}</strong>
        <div className={styles.identityHandicap}><span>{t("coach.directory.handicap")}</span><b>{handicap}</b></div>
      </div>
    </div>
  );
}
