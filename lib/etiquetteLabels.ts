export const etiquetteLabels = {
  fr: { title: "Étiquette & esprit du jeu", intro: "Sur le parcours, chaque geste compte. Apprends à jouer en sécurité, à laisser de la place aux autres et à prendre soin du terrain, du premier départ au dernier putt.",
    summary: "12 thèmes · 36 fiches · À découvrir à ton rythme", theme: "Thème", cards: "Les fiches du thème", explore: "À découvrir maintenant",
    path: "Mon parcours", themes: "Les 12 thèmes", selected: "Affiché", card: "Fiche", read: "Lire la fiche", back: "Retour aux fiches",
    situation: "La situation", understand: "Comprendre", action: "Le bon réflexe", avoid: "À éviter", mission: "Ma mission sur le parcours",
    tip: "Conseil Coach", unavailable: "Aucun thème publié pour le moment.", error: "Chargement impossible. Réessayez.", retry: "Réessayer",
    loading: "Chargement des fiches…", fallback: "Cette fiche est disponible en français ; aucune traduction validée pour cette langue." },
  en: { title: "Etiquette & spirit of the game", intro: "Every gesture matters on the course. Learn to play safely, give others space and care for the course, from the first tee to the last putt.",
    summary: "12 themes · 36 cards · Explore at your own pace", theme: "Theme", cards: "Cards in this theme", explore: "Explore now",
    path: "My learning journey", themes: "12 themes", selected: "Selected", card: "Card", read: "Read card", back: "Back to cards",
    situation: "The situation", understand: "Understand", action: "What to do", avoid: "Avoid", mission: "My on-course mission",
    tip: "Coach tip", unavailable: "No theme has been published yet.", error: "Unable to load. Try again.", retry: "Try again",
    loading: "Loading cards…", fallback: "This card is available in French; no approved translation exists for this language." },
  de: { title: "Etikette & Geist des Spiels", intro: "Auf dem Platz zählt jede Geste. Lerne, sicher zu spielen, anderen Raum zu geben und den Platz zu schonen, vom ersten Abschlag bis zum letzten Putt.",
    summary: "12 Themen · 36 Karten · Entdecke sie in deinem Tempo", theme: "Thema", cards: "Karten dieses Themas", explore: "Jetzt entdecken",
    path: "Mein Lernweg", themes: "12 Themen", selected: "Ausgewählt", card: "Karte", read: "Karte lesen", back: "Zurück zu den Karten",
    situation: "Die Situation", understand: "Verstehen", action: "Das richtige Verhalten", avoid: "Vermeiden", mission: "Meine Aufgabe auf dem Platz",
    tip: "Tipp für Coaches", unavailable: "Es wurde noch kein Thema veröffentlicht.", error: "Laden fehlgeschlagen. Bitte erneut versuchen.", retry: "Erneut versuchen",
    loading: "Karten werden geladen…", fallback: "Diese Karte ist auf Französisch verfügbar; für diese Sprache liegt keine freigegebene Übersetzung vor." },
  it: { title: "Etichetta & spirito del gioco", intro: "Sul campo ogni gesto conta. Impara a giocare in sicurezza, a lasciare spazio agli altri e a prenderti cura del percorso, dal primo tee all’ultimo putt.",
    summary: "12 temi · 36 schede · Scoprili al tuo ritmo", theme: "Tema", cards: "Schede del tema", explore: "Scopri ora",
    path: "Il mio percorso", themes: "12 temi", selected: "Selezionato", card: "Scheda", read: "Leggi la scheda", back: "Torna alle schede",
    situation: "La situazione", understand: "Capire", action: "Il gesto giusto", avoid: "Da evitare", mission: "La mia missione sul campo",
    tip: "Consiglio per il coach", unavailable: "Nessun tema è stato ancora pubblicato.", error: "Caricamento non riuscito. Riprova.", retry: "Riprova",
    loading: "Caricamento delle schede…", fallback: "Questa scheda è disponibile in francese; non esiste una traduzione approvata per questa lingua." },
} as const;

export function etiquetteText(locale: string) {
  return etiquetteLabels[locale as keyof typeof etiquetteLabels] ?? etiquetteLabels.fr;
}
