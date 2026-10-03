import { coachDirectoryRows } from "./coachDirectoryMessages.ts";
import { coachGroupRows } from "./coachGroupMessages.ts";
import { coachPlanningRows } from "./coachPlanningMessages.ts";
import { coachEventEditorRows } from "./coachEventEditorMessages.ts";
import { coachActivityFormRows } from "./coachActivityFormMessages.ts";
import { coachFinishingRows } from "./coachFinishingMessages.ts";
import { coachProfileRows } from "./coachProfileMessages.ts";
import { coachActivityRows } from "./coachActivityMessages.ts";

// Interface copy only: club-authored catalogue content remains unchanged.
const rows = {
  ...coachActivityRows,
  ...coachProfileRows,
  ...coachFinishingRows,
  ...coachDirectoryRows,
  ...coachGroupRows,
  ...coachPlanningRows,
  ...coachEventEditorRows,
  ...coachActivityFormRows,
  "coach.home.attendanceOne": ["{count} présence à compléter", "{count} attendance to complete", "{count} Anwesenheit zu ergänzen", "{count} presenza da completare"],
  "coach.home.evaluationOne": ["{count} évaluation à terminer", "{count} evaluation to finish", "{count} Bewertung abzuschliessen", "{count} valutazione da completare"],
  "coach.nav.activity": [
    "Mon activité",
    "My activity",
    "Meine Aktivitäten",
    "La mia attività"
  ],
  "coach.nav.activities": [
    "Activités",
    "Activities",
    "Aktivitäten",
    "Attività"
  ],
  "coach.nav.evaluations": [
    "Activités à évaluer",
    "Activities to evaluate",
    "Zu bewertende Aktivitäten",
    "Attività da valutare"
  ],
  "coach.nav.groups": [
    "Mes groupes",
    "My groups",
    "Meine Gruppen",
    "I miei gruppi"
  ],
  "coach.nav.players": [
    "Juniors",
    "Juniors",
    "Junioren",
    "Juniores"
  ],
  "coach.nav.camps": [
    "Stages / camps",
    "Camps",
    "Camps",
    "Stage / campi"
  ],
  "coach.nav.tracking": [
    "Suivi",
    "Progress",
    "Betreuung",
    "Monitoraggio"
  ],
  "coach.nav.validations": [
    "Validations",
    "Validations",
    "Validierungen",
    "Validazioni"
  ],
  "coach.nav.merit": [
    "Ordre du mérite",
    "Order of Merit",
    "Verdienstwertung",
    "Ordine di merito"
  ],
  "coach.nav.rules": [
    "Règles de golf",
    "Golf rules",
    "Golfregeln",
    "Regole del golf"
  ],
  "coach.nav.information": [
    "Informations",
    "Information",
    "Informationen",
    "Informazioni"
  ],
  "coach.nav.notifications": [
    "Notifications",
    "Notifications",
    "Mitteilungen",
    "Notifiche"
  ],
  "coach.retry": [
    "Réessayer",
    "Try again",
    "Erneut versuchen",
    "Riprova"
  ],
  "coach.open": [
    "Ouvrir",
    "Open",
    "Öffnen",
    "Apri"
  ],
  "coach.openNamed": [
    "Ouvrir {name}",
    "Open {name}",
    "{name} öffnen",
    "Apri {name}"
  ],
  "coach.error.session": [
    "Votre session a expiré. Reconnectez-vous.",
    "Your session has expired. Sign in again.",
    "Deine Sitzung ist abgelaufen. Melde dich erneut an.",
    "La sessione è scaduta. Accedi di nuovo."
  ],
  "coach.error.load": [
    "Impossible de charger les données. Réessayez.",
    "Unable to load the data. Try again.",
    "Die Daten konnten nicht geladen werden. Bitte versuche es erneut.",
    "Impossibile caricare i dati. Riprova."
  ],
  "coach.error.save": [
    "L’enregistrement a échoué. Vos saisies sont conservées dans ce formulaire.",
    "Save failed. Your changes remain in this form.",
    "Speichern fehlgeschlagen. Deine Eingaben bleiben in diesem Formular erhalten.",
    "Salvataggio non riuscito. I dati inseriti restano nel modulo."
  ],
  "coach.error.forbidden": [
    "Vous n’avez pas accès à ces données.",
    "You do not have access to this data.",
    "Du hast keinen Zugriff auf diese Daten.",
    "Non hai accesso a questi dati."
  ],
  "coach.error.notFound": [
    "Cette ressource n’est plus disponible.",
    "This resource is no longer available.",
    "Diese Ressource ist nicht mehr verfügbar.",
    "Questa risorsa non è più disponibile."
  ],
  "coach.error.conflict": [
    "Cette évaluation a changé depuis son ouverture. Copiez vos notes puis rechargez avant de la modifier.",
    "This evaluation has changed. Copy your notes, then reload before editing it.",
    "Diese Bewertung wurde geändert. Kopiere deine Notizen und lade die Seite vor dem Bearbeiten neu.",
    "Questa valutazione è stata modificata. Copia le note e ricarica la pagina prima di modificarla."
  ],
  "coach.error.criteria": [
    "Complétez les critères personnalisés obligatoires.",
    "Complete the required custom criteria.",
    "Fülle die erforderlichen benutzerdefinierten Kriterien aus.",
    "Completa i criteri personalizzati obbligatori."
  ],
  "coach.error.notFinished": [
    "L’entraînement doit être terminé avant l’évaluation.",
    "Training must finish before it can be evaluated.",
    "Das Training muss vor der Bewertung beendet sein.",
    "L’allenamento deve terminare prima della valutazione."
  ],
  "coach.error.cancelled": [
    "Une activité annulée ne peut pas être évaluée.",
    "A cancelled activity cannot be evaluated.",
    "Eine abgesagte Aktivität kann nicht bewertet werden.",
    "Un’attività annullata non può essere valutata."
  ],
  "coach.error.disabled": [
    "L’évaluation est désactivée pour cette activité.",
    "Evaluation is disabled for this activity.",
    "Die Bewertung ist für diese Aktivität deaktiviert.",
    "La valutazione è disattivata per questa attività."
  ],
  "coach.error.attendee": [
    "Ce junior ne participe pas à cette activité.",
    "This junior is not a participant in this activity.",
    "Dieser Junior nimmt nicht an dieser Aktivität teil.",
    "Questo junior non partecipa a questa attività."
  ],
  "coach.error.ai": [
    "L’analyse est indisponible. Vous pouvez continuer la saisie manuelle.",
    "Analysis is unavailable. You can continue entering notes manually.",
    "Die Analyse ist nicht verfügbar. Du kannst die Notizen weiterhin manuell eingeben.",
    "L’analisi non è disponibile. Puoi continuare a inserire le note manualmente."
  ],
  "coach.error.aiDisabled": [
    "L’assistance IA n’est pas activée pour votre compte dans ce club.",
    "AI assistance is not enabled for your account in this club.",
    "Die KI-Unterstützung ist für dein Konto in diesem Club nicht aktiviert.",
    "L’assistenza IA non è attiva per il tuo account in questo club."
  ],
  "coach.error.rateLimit": [
    "Trop de demandes. Patientez puis réessayez.",
    "Too many requests. Wait and try again.",
    "Zu viele Anfragen. Warte kurz und versuche es erneut.",
    "Troppe richieste. Attendi e riprova."
  ],
  "coach.error.invalid": [
    "Vérifiez les valeurs saisies avant de réessayer.",
    "Check the entered values and try again.",
    "Prüfe die eingegebenen Werte und versuche es erneut.",
    "Controlla i valori inseriti e riprova."
  ],
  "coach.responsePlaceholder": [
    "Votre réponse…",
    "Your answer…",
    "Deine Antwort…",
    "La tua risposta…"
  ],
  "coach.validation.intro": [
    "Consultez les défis techniques et les juniors à accompagner dans leur progression.",
    "Explore technical challenges and the juniors ready to work on them.",
    "Entdecke technische Aufgaben und Junioren, die du dabei begleiten kannst.",
    "Consulta le sfide tecniche e i juniores da accompagnare nei progressi."
  ],
  "coach.validation.challengeCount": [
    "{count} défis",
    "{count} challenges",
    "{count} Aufgaben",
    "{count} sfide"
  ],
  "coach.validation.challengeOne": [
    "1 défi",
    "1 challenge",
    "1 Aufgabe",
    "1 sfida"
  ],
  "coach.validation.error": [
    "Impossible de charger les validations.",
    "Unable to load validations.",
    "Validierungen konnten nicht geladen werden.",
    "Impossibile caricare le validazioni."
  ],
  "coach.validation.summary": [
    "Synthèse des validations",
    "Validation overview",
    "Übersicht der Validierungen",
    "Riepilogo delle validazioni"
  ],
  "coach.validation.available": [
    "Défis disponibles",
    "Available challenges",
    "Verfügbare Aufgaben",
    "Sfide disponibili"
  ],
  "coach.validation.catalogHint": [
    "Référentiel commun",
    "Shared catalogue",
    "Gemeinsamer Katalog",
    "Catalogo comune"
  ],
  "coach.validation.validated": [
    "Défis validés",
    "Validated challenges",
    "Bestandene Aufgaben",
    "Sfide superate"
  ],
  "coach.validation.validatedHint": [
    "Par au moins un junior des clubs accessibles",
    "By at least one junior in the accessible clubs",
    "Von mindestens einem Junior der zugänglichen Clubs",
    "Da almeno un junior dei club accessibili"
  ],
  "coach.validation.sections": [
    "Secteurs",
    "Sections",
    "Bereiche",
    "Settori"
  ],
  "coach.validation.sectionHint": [
    "Putting, petit jeu et plus",
    "Putting, short game and more",
    "Putten, kurzes Spiel und mehr",
    "Putting, gioco corto e altro"
  ],
  "coach.validation.catalog": [
    "Catalogue des validations",
    "Validation catalogue",
    "Validierungskatalog",
    "Catalogo delle validazioni"
  ],
  "coach.validation.catalogIntro": [
    "Recherchez un défi ou consultez les consignes par secteur.",
    "Search for a challenge or browse instructions by section.",
    "Suche eine Aufgabe oder sieh dir die Anleitungen nach Bereich an.",
    "Cerca una sfida o consulta le istruzioni per settore."
  ],
  "coach.validation.search": [
    "Rechercher un défi",
    "Search challenges",
    "Aufgabe suchen",
    "Cerca una sfida"
  ],
  "coach.validation.sectionNav": [
    "Secteurs de validation",
    "Validation sections",
    "Validierungsbereiche",
    "Settori di validazione"
  ],
  "coach.validation.empty": [
    "Aucun défi trouvé",
    "No challenges found",
    "Keine Aufgaben gefunden",
    "Nessuna sfida trovata"
  ],
  "coach.validation.emptyHint": [
    "Essayez un autre terme ou un autre secteur.",
    "Try another search term or section.",
    "Versuche einen anderen Suchbegriff oder Bereich.",
    "Prova un altro termine o settore."
  ],
  "coach.validation.level": [
    "Niveau {level}",
    "Level {level}",
    "Stufe {level}",
    "Livello {level}"
  ],
  "coach.validation.noLevel": [
    "Niveau non défini",
    "Level not set",
    "Keine Stufe festgelegt",
    "Livello non definito"
  ],
  "coach.validation.challengers": [
    "Challengers",
    "Challengers",
    "Bereite Junioren",
    "Juniores pronti"
  ],
  "coach.validation.challengersFor": [
    "Voir les challengers : {name}",
    "View challengers: {name}",
    "Bereite Junioren anzeigen: {name}",
    "Visualizza i juniores pronti: {name}"
  ],
  "coach.validation.playerCount": [
    "{validated}/{total} juniors ont validé ce défi",
    "{validated}/{total} juniors have passed this challenge",
    "{validated}/{total} Junioren haben diese Aufgabe bestanden",
    "{validated}/{total} juniores hanno superato questa sfida"
  ],
  "coach.validation.illustration": [
    "Illustration : {name}",
    "Illustration: {name}",
    "Illustration: {name}",
    "Illustrazione: {name}"
  ],
  "coach.validation.noIllustration": [
    "Illustration à venir",
    "Illustration coming soon",
    "Illustration folgt",
    "Illustrazione in arrivo"
  ],
  "coach.validation.objective": [
    "Objectif",
    "Objective",
    "Ziel",
    "Obiettivo"
  ],
  "coach.validation.instructions": [
    "Consigne",
    "Instructions",
    "Anleitung",
    "Istruzioni"
  ],
  "coach.validation.equipment": [
    "Matériel",
    "Equipment",
    "Material",
    "Materiale"
  ],
  "coach.validation.rule": [
    "Règle de validation",
    "Validation rule",
    "Validierungsregel",
    "Regola di validazione"
  ],
  "coach.validation.noChallenger": [
    "Aucun junior à ce niveau",
    "No juniors at this level",
    "Keine Junioren auf dieser Stufe",
    "Nessun junior a questo livello"
  ],
  "coach.validation.noChallengerHint": [
    "Les juniors de vos clubs ont validé ce défi ou ne l’ont pas encore atteint.",
    "Juniors in your clubs have passed this challenge or have not reached it yet.",
    "Die Junioren deiner Clubs haben diese Aufgabe bereits bestanden oder noch nicht erreicht.",
    "I juniores dei tuoi club hanno superato questa sfida o non l’hanno ancora raggiunta."
  ],
  "coach.validation.openPlayer": [
    "Ouvrir le suivi du junior",
    "Open junior progress",
    "Betreuung des Juniors öffnen",
    "Apri il monitoraggio del junior"
  ],
  "coach.validation.player": [
    "Joueur",
    "Player",
    "Spieler",
    "Giocatore"
  ],
  "coach.home.hello": [
    "Bonjour",
    "Hello",
    "Hallo",
    "Ciao"
  ],
  "coach.home.intro": [
    "Votre centre d’action pour les activités, présences et évaluations.",
    "Your hub for activities, attendance and evaluations.",
    "Deine Übersicht für Aktivitäten, Anwesenheit und Bewertungen.",
    "Il tuo centro per attività, presenze e valutazioni."
  ],
  "coach.home.contextLoading": [
    "Chargement du contexte…",
    "Loading context…",
    "Kontext wird geladen…",
    "Caricamento del contesto…"
  ],
  "coach.home.noClub": [
    "Aucun club actif",
    "No active club",
    "Kein aktiver Club",
    "Nessun club attivo"
  ],
  "coach.home.today": [
    "Activités aujourd’hui",
    "Activities today",
    "Heutige Aktivitäten",
    "Attività di oggi"
  ],
  "coach.home.week": [
    "À venir cette semaine",
    "Coming up this week",
    "Diese Woche geplant",
    "In programma questa settimana"
  ],
  "coach.home.attendance": [
    "Présences à compléter",
    "Attendance to complete",
    "Anwesenheit zu erfassen",
    "Presenze da completare"
  ],
  "coach.home.evaluations": [
    "Évaluations à terminer",
    "Evaluations to complete",
    "Offene Bewertungen",
    "Valutazioni da completare"
  ],
  "coach.home.groups": [
    "Groupes suivis",
    "Groups followed",
    "Betreute Gruppen",
    "Gruppi seguiti"
  ],
  "coach.home.players": [
    "Juniors suivis",
    "Juniors followed",
    "Betreute Junioren",
    "Juniores seguiti"
  ],
  "coach.home.upcoming": [
    "Prochaines activités",
    "Upcoming activities",
    "Nächste Aktivitäten",
    "Prossime attività"
  ],
  "coach.home.upcomingHint": [
    "Vos trois prochains rendez-vous.",
    "Your next three activities.",
    "Deine nächsten drei Termine.",
    "I tuoi prossimi tre appuntamenti."
  ],
  "coach.home.noActivity": [
    "Aucune activité planifiée.",
    "No activities planned.",
    "Keine Aktivitäten geplant.",
    "Nessuna attività pianificata."
  ],
  "coach.home.news": [
    "Actualités de mes clubs",
    "News from my clubs",
    "Neuigkeiten meiner Clubs",
    "Notizie dei miei club"
  ],
  "coach.home.newsHint": [
    "Les dernières nouvelles publiées par vos clubs.",
    "The latest news published by your clubs.",
    "Die neuesten Meldungen deiner Clubs.",
    "Le ultime notizie pubblicate dai tuoi club."
  ],
  "coach.home.allNews": [
    "Toutes les actualités",
    "All news",
    "Alle Neuigkeiten",
    "Tutte le notizie"
  ],
  "coach.home.noNews": [
    "Aucune actualité pour le moment.",
    "No news yet.",
    "Noch keine Neuigkeiten.",
    "Nessuna notizia al momento."
  ],
  "coach.home.attention": [
    "Points d’attention",
    "Needs attention",
    "Zu beachten",
    "Punti di attenzione"
  ],
  "coach.home.attentionHint": [
    "Les éléments à vérifier prochainement.",
    "Items to check next.",
    "Was als Nächstes geprüft werden sollte.",
    "Gli elementi da verificare prossimamente."
  ],
  "coach.home.attendanceCount": [
    "{count} présences à compléter",
    "{count} attendance records to complete",
    "{count} Anwesenheiten zu erfassen",
    "{count} presenze da completare"
  ],
  "coach.home.evaluationCount": [
    "{count} évaluations à terminer",
    "{count} evaluations to complete",
    "{count} offene Bewertungen",
    "{count} valutazioni da completare"
  ],
  "coach.home.noAttention": [
    "Aucun point d’attention.",
    "Nothing needs attention.",
    "Nichts zu beachten.",
    "Nessun punto di attenzione."
  ],
  "coach.home.metrics": [
    "Indicateurs principaux",
    "Key figures",
    "Kennzahlen",
    "Indicatori principali"
  ],
  "coach.home.shortcuts": [
    "Raccourcis",
    "Shortcuts",
    "Schnellzugriff",
    "Scorciatoie"
  ],
  "coach.home.openCalendar": [
    "Ouvrir le calendrier",
    "Open calendar",
    "Kalender öffnen",
    "Apri il calendario"
  ],
  "coach.home.viewActivities": [
    "Consulter vos activités",
    "View your activities",
    "Deine Aktivitäten ansehen",
    "Consulta le tue attività"
  ],
  "coach.home.viewGroups": [
    "Consulter mes groupes",
    "View my groups",
    "Meine Gruppen ansehen",
    "Consulta i miei gruppi"
  ],
  "coach.home.groupsHint": [
    "Juniors et planning",
    "Juniors and schedule",
    "Junioren und Planung",
    "Juniores e pianificazione"
  ],
  "coach.home.evaluate": [
    "Évaluations à faire",
    "Pending evaluations",
    "Ausstehende Bewertungen",
    "Valutazioni da fare"
  ],
  "coach.home.evaluateHint": [
    "Compléter les retours attendus",
    "Complete outstanding feedback",
    "Ausstehende Rückmeldungen ergänzen",
    "Completa i feedback richiesti"
  ],
  "coach.activity.training": [
    "Entraînement",
    "Training",
    "Training",
    "Allenamento"
  ],
  "coach.activity.interclub": [
    "Interclub",
    "Interclub",
    "Interclub",
    "Interclub"
  ],
  "coach.activity.camp": [
    "Stage / camp",
    "Camp",
    "Camp",
    "Stage / campo"
  ],
  "coach.activity.session": [
    "Séance",
    "Session",
    "Sitzung",
    "Sessione"
  ],
  "coach.activity.event": [
    "Événement",
    "Event",
    "Veranstaltung",
    "Evento"
  ],
  "coach.activity.other": [
    "Activité",
    "Activity",
    "Aktivität",
    "Attività"
  ],
  "coach.activity.noGroup": [
    "Groupe non renseigné",
    "Group not provided",
    "Keine Gruppe angegeben",
    "Gruppo non indicato"
  ],
  "coach.activity.noClub": [
    "Club non renseigné",
    "Club not provided",
    "Kein Club angegeben",
    "Club non indicato"
  ],
  "coach.activity.noPlace": [
    "Lieu à confirmer",
    "Location to be confirmed",
    "Ort noch zu bestätigen",
    "Luogo da confermare"
  ],
  "coach.calendar.intro": [
    "Consultez et gérez les activités de vos groupes.",
    "View and manage your group activities.",
    "Sieh dir die Aktivitäten deiner Gruppen an und verwalte sie.",
    "Consulta e gestisci le attività dei tuoi gruppi."
  ],
  "coach.calendar.add": [
    "Ajouter une activité",
    "Add activity",
    "Aktivität hinzufügen",
    "Aggiungi un’attività"
  ],
  "coach.calendar.metrics": [
    "Indicateurs des activités",
    "Activity statistics",
    "Aktivitätsstatistik",
    "Statistiche delle attività"
  ],
  "coach.calendar.completed": [
    "Activités réalisées jusqu’à aujourd’hui",
    "Activities completed to date",
    "Bisher abgeschlossene Aktivitäten",
    "Attività completate fino a oggi"
  ],
  "coach.calendar.scope": [
    "dans votre périmètre",
    "in your scope",
    "in deinem Bereich",
    "nel tuo ambito"
  ],
  "coach.calendar.planned": [
    "Activités planifiées",
    "Planned activities",
    "Geplante Aktivitäten",
    "Attività pianificate"
  ],
  "coach.calendar.upcoming": [
    "à venir",
    "upcoming",
    "bevorstehend",
    "in programma"
  ],
  "coach.calendar.total": [
    "Activités totales",
    "Total activities",
    "Aktivitäten insgesamt",
    "Attività totali"
  ],
  "coach.calendar.totalHint": [
    "réalisées et planifiées",
    "completed and planned",
    "abgeschlossen und geplant",
    "completate e pianificate"
  ],
  "coach.calendar.filter": [
    "Filtrer les activités",
    "Filter activities",
    "Aktivitäten filtern",
    "Filtra le attività"
  ],
  "coach.calendar.filterHint": [
    "Affinez la liste par vue, type d’activité ou groupe.",
    "Refine the list by view, activity type or group.",
    "Filtere nach Ansicht, Aktivitätstyp oder Gruppe.",
    "Filtra per vista, tipo di attività o gruppo."
  ],
  "coach.calendar.month": [
    "Mois",
    "Month",
    "Monat",
    "Mese"
  ],
  "coach.calendar.week": [
    "Semaine",
    "Week",
    "Woche",
    "Settimana"
  ],
  "coach.calendar.day": [
    "Jour",
    "Day",
    "Tag",
    "Giorno"
  ],
  "coach.calendar.display": [
    "Affichage",
    "Display",
    "Anzeige",
    "Visualizzazione"
  ],
  "coach.calendar.all": [
    "Toutes les activités",
    "All activities",
    "Alle Aktivitäten",
    "Tutte le attività"
  ],
  "coach.calendar.type": [
    "Type d’activité",
    "Activity type",
    "Aktivitätstyp",
    "Tipo di attività"
  ],
  "coach.calendar.allTypes": [
    "Tous les types",
    "All types",
    "Alle Typen",
    "Tutti i tipi"
  ],
  "coach.calendar.group": [
    "Groupe",
    "Group",
    "Gruppe",
    "Gruppo"
  ],
  "coach.calendar.allGroups": [
    "Tous les groupes",
    "All groups",
    "Alle Gruppen",
    "Tutti i gruppi"
  ],
  "coach.calendar.previous": [
    "Période précédente",
    "Previous period",
    "Vorheriger Zeitraum",
    "Periodo precedente"
  ],
  "coach.calendar.next": [
    "Période suivante",
    "Next period",
    "Nächster Zeitraum",
    "Periodo successivo"
  ],
  "coach.calendar.today": [
    "Aujourd’hui",
    "Today",
    "Heute",
    "Oggi"
  ],
  "coach.calendar.loading": [
    "Chargement des activités…",
    "Loading activities…",
    "Aktivitäten werden geladen…",
    "Caricamento delle attività…"
  ],
  "coach.calendar.specificGroup": [
    "Groupe spécifique",
    "Specific group",
    "Spezifische Gruppe",
    "Gruppo specifico"
  ],
  "coach.calendar.empty": [
    "Aucune activité sur cette période.",
    "No activity in this period.",
    "Keine Aktivität in diesem Zeitraum.",
    "Nessuna attività in questo periodo."
  ],
  "coach.learning.title": [
    "Parcours d’apprentissage",
    "Learning journey",
    "Lernpfad",
    "Percorso di apprendimento"
  ],
  "coach.learning.intro": [
    "Des supports pour faire progresser vos juniors, séance après séance.",
    "Resources to help your juniors progress, session by session.",
    "Materialien, mit denen deine Junioren von Training zu Training Fortschritte machen.",
    "Materiali per aiutare i tuoi juniores a progredire, allenamento dopo allenamento."
  ],
  "coach.learning.challenges": [
    "Les prochains défis à travailler par secteur.",
    "The next challenges to work on by section.",
    "Die nächsten Aufgaben nach Bereich.",
    "Le prossime sfide da affrontare per settore."
  ],
  "coach.learning.allValidations": [
    "Toutes les validations",
    "All validations",
    "Alle Validierungen",
    "Tutte le validazioni"
  ],
  "coach.learning.loading": [
    "Chargement des validations…",
    "Loading validations…",
    "Validierungen werden geladen…",
    "Caricamento delle validazioni…"
  ],
  "coach.learning.catalog": [
    "Consulter le catalogue des validations",
    "Browse the validation catalogue",
    "Validierungskatalog ansehen",
    "Consulta il catalogo delle validazioni"
  ],
  "coach.learning.rulesIntro": [
    "Une série à découvrir avec vos juniors.",
    "A series to explore with your juniors.",
    "Eine Serie, die du mit deinen Junioren entdecken kannst.",
    "Una serie da scoprire con i tuoi juniores."
  ],
  "coach.learning.series": [
    "Série {number} · {month}",
    "Series {number} · {month}",
    "Serie {number} · {month}",
    "Serie {number} · {month}"
  ],
  "coach.learning.rulesTitle": [
    "Les règles du jeu, pas à pas",
    "The rules of the game, step by step",
    "Die Spielregeln, Schritt für Schritt",
    "Le regole del gioco, passo dopo passo"
  ],
  "coach.learning.rulesHint": [
    "Parcourez les situations avec vos juniors et préparez-les au quiz.",
    "Explore the situations with your juniors and prepare them for the quiz.",
    "Besprich die Situationen mit deinen Junioren und bereite sie auf das Quiz vor.",
    "Esplora le situazioni con i tuoi juniores e preparali al quiz."
  ]
} satisfies Record<string, [string, string, string, string]>;

export const coachMessages = Object.fromEntries(
  (["fr", "en", "de", "it"] as const).map((locale, index) => [locale,
    Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, values[index]]))])
) as Record<"fr" | "en" | "de" | "it", Record<keyof typeof rows, string>>;

export function coachText(t: (key: string) => string, key: string, values: Record<string, string | number>) {
  return t(key).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
}

export function coachDateLocale(locale: string) {
  return ({ fr: "fr-CH", en: "en-GB", de: "de-CH", it: "it-CH" } as Record<string, string>)[locale] ?? "fr-CH";
}
