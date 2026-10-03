"use client";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import type { ManagerClub } from "./useManagerClubSelection";

export default function ManagerClubSelect({ clubs, clubId, onChange, disabled = false }: {
  clubs: ManagerClub[]; clubId: string; onChange: (id: string) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  return <label className="user-mgmt-field"><span className="user-mgmt-field-label">{t("common.club")}</span>
    <select aria-label={t("common.club")} value={clubId} disabled={disabled || !clubs.length} onChange={(event) => onChange(event.target.value)}>
      {!clubId ? <option value="">{t(clubs.length ? "manager.chooseClub" : "manager.noClub")}</option> : null}
      {clubs.map((club) => <option key={club.id} value={club.id}>{club.name || t("common.club")}</option>)}
    </select>
  </label>;
}
