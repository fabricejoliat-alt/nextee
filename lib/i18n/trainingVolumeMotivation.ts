const defaultGermanMotivations: Record<string, [string, string]> = {
  F1: [
    "Tu découvres le golf et développes les bases du jeu. Un volume d’entraînement d’une heure par semaine t’aide à construire les fondations de ton futur niveau.",
    "Du entdeckst den Golfsport und lernst die Grundlagen. Eine Trainingsstunde pro Woche hilft dir, die Basis für dein nächstes Niveau zu schaffen.",
  ],
  F2: [
    "Tu apprends à jouer sur le parcours et à devenir autonome. Un volume d’une à 2 heures d’entraînement par semaine permet de progresser régulièrement.",
    "Du lernst, auf dem Platz selbstständig zu spielen. Ein bis zwei Trainingsstunden pro Woche helfen dir, regelmässig Fortschritte zu machen.",
  ],
  F3: [
    "Tu développes ton jeu et gagnes en régularité. Un volume de 4 à 6 heures par semaine t’aide à franchir les prochaines étapes.",
    "Du entwickelst dein Spiel und wirst konstanter. Vier bis sechs Trainingsstunden pro Woche helfen dir, die nächsten Schritte zu machen.",
  ],
  T1: [
    "Aujourd’hui tu es un joueur compétitif. Tu développes un niveau avancé et te rapproches du single handicap. Pour progresser et performer en tournoi, un volume d’entraînement de 8 à 10 heures par semaine est recommandé.",
    "Du spielst bereits Wettkämpfe und näherst dich einem einstelligen Handicap. Für weitere Fortschritte und gute Turnierergebnisse werden acht bis zehn Trainingsstunden pro Woche empfohlen.",
  ],
  T2: [
    "Un volume de 12 à 15 heures par semaine permet de faire la différence en compétition.",
    "Zwölf bis fünfzehn Trainingsstunden pro Woche können im Wettkampf den Unterschied machen.",
  ],
  T3: [
    "Tu fais partie des joueurs de performance. Ton entraînement vise maintenant l’excellence avec 18 à 22 heures d’entraînement par semaine.",
    "Du gehörst zu den Leistungsspielern. Mit 18 bis 22 Trainingsstunden pro Woche arbeitest du jetzt auf Spitzenleistungen hin.",
  ],
  T4: [
    "Tu évolues parmi les meilleurs juniors. Pour viser les tournois nationaux et internationaux, l’entraînement atteint 22 à 25 heures par semaine.",
    "Du gehörst zu den besten Junioren. Für nationale und internationale Turniere trainierst du 22 bis 25 Stunden pro Woche.",
  ],
  E1: [
    "Tu évolues au niveau élite amateur. Ton entraînement se situe généralement autour de 25 à 30 heures par semaine.",
    "Du spielst auf Amateur-Eliteniveau und trainierst in der Regel 25 bis 30 Stunden pro Woche.",
  ],
  E2: [
    "Tu fais partie de l’élite internationale. Ton entraînement est celui d’un athlète de haut niveau avec environ 30 heures par semaine ou plus.",
    "Du gehörst zur internationalen Elite. Wie ein Spitzensportler trainierst du etwa 30 Stunden pro Woche oder mehr.",
  ],
  M: [
    "Tu vises l’excellence au plus haut niveau du golf mondial. L’entraînement dépasse généralement 30 heures par semaine et chaque détail compte.",
    "Du strebst Spitzenleistungen auf höchstem Weltniveau an. Das Training umfasst meist mehr als 30 Stunden pro Woche, und jedes Detail zählt.",
  ],
};

export function localizeTrainingVolumeMotivation(locale: string, code: string | null | undefined, text: string | null | undefined) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  const fallback = defaultGermanMotivations[String(code ?? "")];
  if (locale === "de" && fallback && value === fallback[0]) return fallback[1];
  return value;
}
