"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import type { DocumentUploadProgress as UploadState } from "@/lib/uploadDocumentWithProgress";
import styles from "./DocumentUploadProgress.module.css";

export default function DocumentUploadProgress({ state }: { state: UploadState | null }) {
  const { locale } = useI18n();
  const [dismissedState, setDismissedState] = useState<UploadState | null>(null);
  useEffect(() => {
    if (state?.phase !== "complete") return;
    const timer = window.setTimeout(() => setDismissedState(state), 3000);
    return () => window.clearTimeout(timer);
  }, [state]);
  if (!state || dismissedState === state) return null;
  const labels = {
    preparing: pickLocaleText(locale, "Préparation du fichier…", "Preparing file…", "Datei wird vorbereitet…"),
    uploading: pickLocaleText(locale, "Envoi en cours…", "Uploading…", "Wird hochgeladen…"),
    finalizing: pickLocaleText(locale, "Envoi terminé, enregistrement du document…", "Upload complete, saving document…", "Upload abgeschlossen, Dokument wird gespeichert…"),
    complete: pickLocaleText(locale, "Document ajouté", "Document added", "Dokument hinzugefügt"),
    error: pickLocaleText(locale, "Échec de l’envoi", "Upload failed", "Upload fehlgeschlagen"),
  };
  return <div className={styles.container}>
    <div className={styles.heading} role="status" aria-live="polite">
      <span>{labels[state.phase]}</span>
      {state.phase === "uploading" ? <b>{state.percent}%</b> : null}
    </div>
    {state.phase !== "error" ? <progress className={styles.progress} max={100}
      value={state.phase === "preparing" ? undefined : state.percent}
      aria-label={labels[state.phase]} /> : null}
    {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
  </div>;
}
