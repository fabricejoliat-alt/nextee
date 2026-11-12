"use client";

import { useId, useState } from "react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { useTrainingDurationDisplay } from "./TrainingDurationPreference";
import type { TrainingDurationUnit } from "@/lib/trainingDurationDisplay";

const messages = {
  fr: { title: "Affichage des volumes d’entraînement", minutes: "Minutes (80 min)", hours: "Heures et minutes (1h20)", help: "Ce choix concerne uniquement les statistiques. La saisie des entraînements reste en minutes.", saving: "Enregistrement…", error: "Impossible d’enregistrer ce choix. Votre réglage précédent est conservé." },
  en: { title: "Training volume display", minutes: "Minutes (80 min)", hours: "Hours and minutes (1h20)", help: "This choice applies only to statistics. Training entry stays in minutes.", saving: "Saving…", error: "Unable to save this choice. Your previous setting is preserved." },
  de: { title: "Anzeige des Trainingsumfangs", minutes: "Minuten (80 min)", hours: "Stunden und Minuten (1h20)", help: "Diese Einstellung gilt nur für Statistiken. Trainings werden weiterhin in Minuten erfasst.", saving: "Wird gespeichert…", error: "Die Einstellung konnte nicht gespeichert werden. Die bisherige Auswahl bleibt erhalten." },
  it: { title: "Visualizzazione del volume di allenamento", minutes: "Minuti (80 min)", hours: "Ore e minuti (1h20)", help: "Questa scelta riguarda solo le statistiche. Gli allenamenti restano inseriti in minuti.", saving: "Salvataggio…", error: "Impossibile salvare la scelta. L’impostazione precedente viene mantenuta." },
};

export default function TrainingDurationSettings() {
  const { locale } = useI18n();
  const copy = messages[locale];
  const id = useId();
  const { unit, ready, saving, setUnit } = useTrainingDurationDisplay();
  const [failed, setFailed] = useState(false);
  async function change(value: TrainingDurationUnit) {
    setFailed(false);
    try { await setUnit(value); } catch { setFailed(true); }
  }
  return <div style={{ display: "grid", gap: 8 }}>
    <label htmlFor={id} style={{ fontWeight: 800 }}>{copy.title}</label>
    <select id={id} value={unit} disabled={!ready || saving} aria-describedby={`${id}-help`} onChange={event => void change(event.target.value as TrainingDurationUnit)}>
      <option value="minutes">{copy.minutes}</option><option value="hours">{copy.hours}</option>
    </select>
    <small id={`${id}-help`}>{copy.help}</small>
    {saving ? <small role="status">{copy.saving}</small> : null}
    {failed ? <small role="alert">{copy.error}</small> : null}
  </div>;
}
