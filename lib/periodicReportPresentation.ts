import { managerLocaleTag } from "./managerLocale.ts";
import type { AppLocale } from "./i18n/messages.ts";

export const periodicReportEntries: Record<string, readonly [string, string, string, string]> = {
  title: ["Rapport périodique", "Periodic report", "Periodischer Bericht", "Rapporto periodico"],
  summary: ["Résumé de la période", "Period summary", "Zusammenfassung des Zeitraums", "Riepilogo del periodo"],
  participation: ["Participation au club", "Club participation", "Clubteilnahme", "Partecipazione al club"],
  insufficient: ["Données insuffisantes", "Insufficient data", "Unzureichende Daten", "Dati insufficienti"],
  attendance: ["Assiduité : {rate} % · Absences excusées : {excused}", "Attendance: {rate}% · Excused absences: {excused}", "Anwesenheit: {rate} % · Entschuldigte Abwesenheiten: {excused}", "Presenza: {rate}% · Assenze giustificate: {excused}"],
  training: ["Entraînement", "Training", "Training", "Allenamento"],
  trainingDetail: ["Séances : {sessions} · Régularité : {rate} %", "Sessions: {sessions} · Consistency: {rate}%", "Einheiten: {sessions} · Regelmässigkeit: {rate} %", "Sessioni: {sessions} · Regolarità: {rate}%"],
  objective: [" · {rate} % du repère FTEM", " · {rate}% of the FTEM reference", " · {rate} % des FTEM-Richtwerts", " · {rate}% del riferimento FTEM"],
  competitions: ["Compétitions", "Competitions", "Wettkämpfe", "Competizioni"],
  competitionDetail: ["Parcours : {rounds} · Résultats : {results}", "Rounds: {rounds} · Results: {results}", "Runden: {rounds} · Ergebnisse: {results}", "Giri: {rounds} · Risultati: {results}"],
  handicap: ["Handicap et FTEM", "Handicap and FTEM", "Handicap und FTEM", "Handicap e FTEM"],
  noLevel: ["Niveau indisponible", "Level unavailable", "Stufe nicht verfügbar", "Livello non disponibile"],
  noChange: [" · évolution indisponible", " · change unavailable", " · Entwicklung nicht verfügbar", " · variazione non disponibile"],
  improvement: [" · Progression de {value}", " · Improvement of {value}", " · Verbesserung um {value}", " · Miglioramento di {value}"],
  change: [" · Évolution de {value}", " · Change of {value}", " · Veränderung um {value}", " · Variazione di {value}"],
  evaluations: ["Évaluations", "Evaluations", "Bewertungen", "Valutazioni"],
  observations: ["Observations : {count}", "Observations: {count}", "Beobachtungen: {count}", "Osservazioni: {count}"],
  evaluationDetail: ["Engagement {engagement} · Attitude {attitude} · Application {application}", "Engagement {engagement} · Attitude {attitude} · Application {application}", "Engagement {engagement} · Haltung {attitude} · Umsetzung {application}", "Impegno {engagement} · Atteggiamento {attitude} · Applicazione {application}"],
  upcoming: ["Prochaines activités", "Upcoming activities", "Nächste Aktivitäten", "Prossime attività"],
  next: ["Prochaine période", "Next period", "Nächster Zeitraum", "Prossimo periodo"],
  priority: ["Priorité", "Priority", "Priorität", "Priorità"],
  goal: ["Objectif", "Objective", "Ziel", "Obiettivo"],
  encouragement: ["Encouragement", "Encouragement", "Ermutigung", "Incoraggiamento"],
  coachMessage: ["Message de l’encadrement", "Coaching team message", "Nachricht des Betreuungsteams", "Messaggio dello staff"],
  factAttendance: ["présences : {present} sur {total} activités comptabilisées", "attendance: {present} out of {total} counted activities", "Anwesenheit: {present} von {total} berücksichtigten Aktivitäten", "presenze: {present} su {total} attività conteggiate"],
  factTraining: ["entraînement enregistré : {duration}", "recorded training: {duration}", "erfasstes Training: {duration}", "allenamento registrato: {duration}"],
  factCompetitions: ["compétitions : {count}", "competitions: {count}", "Wettkämpfe: {count}", "competizioni: {count}"],
  factHandicap: ["handicap passé de {from} à {to}", "handicap changed from {from} to {to}", "Handicap von {from} auf {to}", "handicap passato da {from} a {to}"],
  summaryFacts: ["Bilan de la période pour {name} : {facts}.", "Period summary for {name}: {facts}.", "Bilanz des Zeitraums für {name}: {facts}.", "Bilancio del periodo per {name}: {facts}."],
  summaryEmpty: ["Aucune donnée suffisante n’est disponible pour résumer cette période de {name}.", "There is not enough data to summarize this period for {name}.", "Es gibt nicht genügend Daten, um diesen Zeitraum für {name} zusammenzufassen.", "Non ci sono dati sufficienti per riassumere questo periodo di {name}."],
};

export function periodicReportLabels(input?: string | null) {
  const locale: AppLocale = input === "en" || input === "de" || input === "it" ? input : "fr";
  const index = (["fr", "en", "de", "it"] as const).indexOf(locale);
  const t = (key: string) => periodicReportEntries[key]?.[index] ?? key;
  const number = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : value.toLocaleString(managerLocaleTag(locale));
  const format = (key: string, values: Record<string, string | number>) => t(key).replace(/\{(\w+)\}/g, (token, name: string) => String(values[name] ?? token));
  const duration = (minutes: number) => `${number(Math.floor(Math.round(minutes) / 60))} h ${String(Math.round(minutes) % 60).padStart(2, "0")}`;
  const date = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(managerLocaleTag(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(new Date(value)) : "—";
  return { locale, t, number, format, duration, date };
}

export function periodicReportSummary(locale: string | undefined, input: { name: string; present: number; denominator: number; minutes: number; competitions: number; handicapChange: number | null; handicapStart: number | null; handicapEnd: number | null }) {
  const { format, number, duration } = periodicReportLabels(locale);
  const facts = [
    input.denominator ? format("factAttendance", { present: number(input.present), total: number(input.denominator) }) : null,
    input.minutes ? format("factTraining", { duration: duration(input.minutes) }) : null,
    input.competitions ? format("factCompetitions", { count: number(input.competitions) }) : null,
    input.handicapChange ? format("factHandicap", { from: number(input.handicapStart), to: number(input.handicapEnd) }) : null,
  ].filter((fact): fact is string => Boolean(fact));
  return facts.length ? format("summaryFacts", { name: input.name, facts: facts.slice(0, 3).join(" ; ") }) : format("summaryEmpty", { name: input.name });
}
