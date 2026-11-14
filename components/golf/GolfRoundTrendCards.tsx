"use client";

import { useMemo } from "react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { calculateGolfRoundTrends, type Trend } from "@/lib/golfRoundTrends";
import type { GolfWorkspaceRound, WorkspaceScorecardHole } from "./GolfRoundsWorkspace";
import styles from "./GolfRoundsWorkspace.module.css";
import trainingStyles from "@/app/player/golf/PlayerGolfTraining.module.css";

export default function GolfRoundTrendCards({ rounds, holesByRound, loading }: {
  rounds: GolfWorkspaceRound[]; holesByRound: Record<string, WorkspaceScorecardHole[]>; loading: boolean;
}) {
  const { locale } = useI18n();
  const tr = (fr: string, en: string, de: string, it: string) => pickLocaleText(locale, fr, en, de, it);
  const trends = useMemo(() => calculateGolfRoundTrends(rounds, holesByRound), [rounds, holesByRound]);
  const format = (n: number | null) => n == null ? "—" : new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(n);
  const fallback = (trend: Trend) => loading ? "…" : trend.direction === "insufficient"
    ? tr("Pas encore assez de données", "Not enough data yet", "Noch nicht genügend Daten", "Dati ancora insufficienti")
    : tr("Aucune tendance nette", "No clear trend", "Kein klarer Trend", "Nessuna tendenza chiara");
  const { sides, afterBirdie } = trends;
  return <div className={styles.trendCards} aria-busy={loading}>
    <article className={`${trainingStyles.panel} ${styles.trendCard}`}>
      <h3>{tr("Aller ou retour ?", "Front or back nine?", "Erste oder zweite neun?", "Prime o seconde nove?")}</h3>
      <strong>{sides.direction === "better" ? tr("Plus performant au retour", "Stronger on the back nine", "Stärker auf den zweiten neun", "Meglio sulle seconde nove") : sides.direction === "worse" ? tr("Plus performant à l’aller", "Stronger on the front nine", "Stärker auf den ersten neun", "Meglio sulle prime nove") : fallback(sides)}</strong>
      {!loading && sides.count > 0 ? <p>{tr("Score moyen / par", "Average score / par", "Durchschnitt / Par", "Media / par")} · {tr("Aller", "Front", "Erste neun", "Prime nove")} {format(sides.frontAverage)} · {tr("Retour", "Back", "Zweite neun", "Seconde nove")} {format(sides.backAverage)}</p> : null}
      <p>{sides.count} {tr("cartes complètes de 18 trous sur les filtres sélectionnés.", "complete 18-hole rounds in the selected filters.", "vollständige 18-Loch-Runden in den gewählten Filtern.", "giri completi di 18 buche nei filtri selezionati.")}</p>
      <details><summary>{tr("Comment lire cette tendance", "How to read this trend", "So liest du diesen Trend", "Come leggere questa tendenza")}</summary><p>{tr("Comparaison aller/retour par rapport au par, sur les mêmes parties. Une tendance exige au moins 8 cartes, un écart moyen d’au moins 1 coup et un test des signes significatif (p < 0,05, égalités exclues). Le par ne corrige pas toute la difficulté des trous.", "Compares front/back scores relative to par in the same rounds. A trend requires at least 8 rounds, an average gap of 1 stroke or more and a significant sign test (p < 0.05, ties excluded). Par does not capture all hole difficulty.", "Vergleich zum Par innerhalb derselben Runden. Ein Trend erfordert mindestens 8 Runden, eine mittlere Differenz von mindestens 1 Schlag und einen signifikanten Vorzeichentest (p < 0,05, Gleichstände ausgeschlossen). Par berücksichtigt nicht die gesamte Schwierigkeit.", "Confronto rispetto al par negli stessi giri. Servono almeno 8 giri, una differenza media di almeno 1 colpo e un test dei segni significativo (p < 0,05, parità escluse). Il par non rappresenta tutta la difficoltà.")}</p></details>
    </article>
    <article className={`${trainingStyles.panel} ${styles.trendCard}`}>
      <h3>{tr("Après un birdie ou un eagle", "After a birdie or eagle", "Nach Birdie oder Eagle", "Dopo un birdie o eagle")}</h3>
      <strong>{afterBirdie.direction === "better" ? tr("Dynamique positive", "Positive momentum", "Positive Dynamik", "Dinamica positiva") : afterBirdie.direction === "worse" ? tr("Trou suivant en retrait", "Next-hole dip", "Schwächer auf dem nächsten Loch", "Calo alla buca successiva") : fallback(afterBirdie)}</strong>
      {!loading && afterBirdie.count > 0 ? <p>{format(afterBirdie.difference)} {tr("coup/trou par rapport à l’habitude", "strokes/hole versus usual", "Schläge/Loch gegenüber üblich", "colpi/buca rispetto al solito")} · {afterBirdie.parOrBetter}/{afterBirdie.count} {tr("au par ou mieux", "par or better", "Par oder besser", "par o meglio")}</p> : null}
      <p>{afterBirdie.count} {tr("trous suivants comparables", "comparable next holes", "vergleichbare Folgelöcher", "buche successive confrontabili")} · {afterBirdie.rounds} {tr("parties", "rounds", "Runden", "giri")}</p>
      <details><summary>{tr("Comment lire cette tendance", "How to read this trend", "So liest du diesen Trend", "Come leggere questa tendenza")}</summary><p>{tr("Birdies, eagles ou mieux : le trou immédiatement suivant est comparé au même trou, même parcours et même départ, dans au moins 3 autres parties où le trou précédent n’était pas sous le par. Il faut 10 situations sur au moins 8 parties, un écart moyen d’au moins 0,2 coup/trou et p < 0,05 au test des signes, avec une observation par partie. Seuls les résultats dans les filtres sélectionnés sont utilisés. Cela décrit le score, sans prouver un relâchement mental.", "After birdies, eagles or better, the immediate next hole is compared with the same hole, course and tee in at least 3 other rounds where the previous hole was not under par. Requires 10 situations across at least 8 rounds, an average gap of 0.2 strokes/hole or more and sign-test p < 0.05, with one observation per round. Uses selected filters only. This describes scores, without proving a mental lapse.", "Das unmittelbare Folgeloch wird mit demselben Loch, Platz und Abschlag in mindestens 3 anderen Runden ohne Unter-Par-Ergebnis am vorherigen Loch verglichen. Erfordert 10 Situationen in mindestens 8 Runden, mindestens 0,2 Schläge/Loch Differenz und p < 0,05 im Vorzeichentest, eine Beobachtung pro Runde. Es gelten die gewählten Filter. Kein Beweis für mentale Unaufmerksamkeit.", "La buca immediatamente successiva è confrontata con la stessa buca, campo e tee in almeno 3 altri giri senza risultato sotto par alla buca precedente. Servono 10 situazioni in almeno 8 giri, almeno 0,2 colpi/buca di differenza e p < 0,05 al test dei segni, una osservazione per giro. Si usano i filtri selezionati. Non prova un calo mentale.")}</p></details>
    </article>
  </div>;
}
