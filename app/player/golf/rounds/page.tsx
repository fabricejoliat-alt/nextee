"use client";

import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import GolfRoundsWorkspace from "@/components/golf/GolfRoundsWorkspace";
import playerUiStyles from "@/components/player/PlayerUI.module.css";
import { useI18n } from "@/components/i18n/AppI18nProvider";

export default function RoundsListPage() {
  const { t } = useI18n();
  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: t("rounds.andStatistics") }]} />
        <header className={playerUiStyles.topline}>
          <div>
            <h1>{t("rounds.title")}</h1>
            <p className={playerUiStyles.lead}>{t("rounds.subtitle")}</p>
          </div>
        </header>
        <GolfRoundsWorkspace />
      </div>
    </div>
  );
}
