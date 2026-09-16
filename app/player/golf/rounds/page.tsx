"use client";

import PlayerBreadcrumb from "@/components/player/PlayerBreadcrumb";
import GolfRoundsWorkspace from "@/components/golf/GolfRoundsWorkspace";
import managerStyles from "@/app/manager/camps/Camps.module.css";

export default function RoundsListPage() {
  return (
    <div className="player-dashboard-bg">
      <div className="app-shell marketplace-page">
        <PlayerBreadcrumb items={[{ label: "Player", href: "/player" }, { label: "Parcours et statistiques" }]} />
        <header className={managerStyles.topline}>
          <div>
            <h1>Mes parcours</h1>
            <p className={managerStyles.lead}>Retrouvez vos parties, vos cartes de score et vos principaux repères de jeu.</p>
          </div>
        </header>
        <GolfRoundsWorkspace />
      </div>
    </div>
  );
}
