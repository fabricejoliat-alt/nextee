"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileText, Paperclip, Upload } from "lucide-react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import DocumentUploadProgress from "@/components/ui/DocumentUploadProgress";
import { organizationFetch as fetch } from "@/lib/organizationFetch";
import { supabase } from "@/lib/supabaseClient";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { optimizeUploadFile } from "@/lib/clientUploadFiles";
import { PLAYER_DOCUMENT_ACCEPT } from "@/lib/playerDocumentPolicy";
import { uploadCoachActivityDocument } from "@/lib/coachActivityDocumentUpload";
import { uploadDocumentWithProgress, type DocumentUploadProgress as UploadState } from "@/lib/uploadDocumentWithProgress";
import styles from "./CoachActivityDocuments.module.css";

type ActivityDocument = { id: string; file_name: string; public_url: string; coach_only: boolean };

export default function CoachActivityDocuments({ playerId, eventId, organizationId, disabled, onBusyChange }: {
  playerId: string;
  eventId: string;
  organizationId: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { locale } = useI18n();
  const text = (fr: string, en: string, de: string, it: string) => pickLocaleText(locale, fr, en, de, it);
  const [documents, setDocuments] = useState<ActivityDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [progress, setProgress] = useState<UploadState | null>(null);
  const [uploading, setUploading] = useState(false);
  const inFlight = useRef(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.access_token) throw new Error("session");
        const query = new URLSearchParams({ club_event_id: eventId, organization_id: organizationId });
        const response = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/documents?${query}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error("load");
        if (active) setDocuments(payload.documents ?? []);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [playerId, eventId, organizationId, reload]);

  async function addDocument() {
    if (inFlight.current || disabled || !file || !name.trim()) return;
    inFlight.current = true;
    setUploading(true);
    onBusyChange(true);
    setProgress({ phase: "preparing", percent: 0 });
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) throw new Error(text("Session expirée. Reconnectez-vous.", "Session expired. Sign in again.", "Sitzung abgelaufen. Bitte erneut anmelden.", "Sessione scaduta. Accedi di nuovo."));
      const optimized = await optimizeUploadFile(file);
      const document = await uploadCoachActivityDocument({
        playerId, eventId, organizationId, token: data.session.access_token, file: optimized, name,
      }, { fetch, transfer: uploadDocumentWithProgress, progress: setProgress });
      setDocuments(previous => [document, ...previous.filter(row => row.id !== document.id)]);
      setFile(null);
      setName("");
      if (picker.current) picker.current.value = "";
    } catch (error) {
      setProgress({ phase: "error", percent: 0, error: error instanceof Error ? error.message : text("Envoi impossible.", "Upload failed.", "Hochladen fehlgeschlagen.", "Caricamento non riuscito.") });
    } finally {
      inFlight.current = false;
      setUploading(false);
      onBusyChange(false);
    }
  }

  return <details open className={styles.panel}>
    <summary><Paperclip size={18} aria-hidden="true" /><span>{text("Documents de l’activité", "Activity documents", "Aktivitätsdokumente", "Documenti dell’attività")}</span>
      {documents.length > 0 && <span className={styles.count}>{documents.length}</span>}
      <ChevronDown size={18} className={styles.chevron} aria-hidden="true" />
    </summary>
    <div className={styles.body}>
    <p>{text("Chaque fichier ajouté est immédiatement visible par le junior.", "Each file you add is immediately visible to the junior.", "Jede hinzugefügte Datei ist für den Junior sofort sichtbar.", "Ogni file aggiunto è subito visibile al junior.")}</p>
    <fieldset disabled={disabled || uploading || loading} className={styles.fields}>
      <label>{text("Choisir un fichier", "Choose a file", "Datei auswählen", "Scegli un file")}
        <input ref={picker} type="file" accept={PLAYER_DOCUMENT_ACCEPT} onChange={event => {
          const selected = event.target.files?.[0] ?? null;
          setFile(selected); setName(selected?.name ?? ""); setProgress(null);
        }} />
      </label>
      <small>{text("Photos : 15 Mo · Documents : 25 Mo · Vidéos : 100 Mo", "Photos: 15 MB · Documents: 25 MB · Videos: 100 MB", "Fotos: 15 MB · Dokumente: 25 MB · Videos: 100 MB", "Foto: 15 MB · Documenti: 25 MB · Video: 100 MB")}</small>
      {file ? <label>{text("Nom du document", "Document name", "Dokumentname", "Nome del documento")}<input value={name} maxLength={180} onChange={event => setName(event.target.value)} /></label> : null}
      <button type="button" disabled={!file || !name.trim()} onClick={() => void addDocument()}><Upload size={16} aria-hidden="true" />{text("Ajouter le document", "Add document", "Dokument hinzufügen", "Aggiungi documento")}</button>
    </fieldset>
    <DocumentUploadProgress state={progress} />
    {loading ? <p role="status">{text("Chargement…", "Loading…", "Laden…", "Caricamento…")}</p> : loadError ? <p role="alert">{text("Impossible de charger les documents.", "Unable to load documents.", "Dokumente konnten nicht geladen werden.", "Impossibile caricare i documenti.")} <button type="button" disabled={uploading} onClick={() => setReload(value => value + 1)}>{text("Réessayer", "Retry", "Erneut versuchen", "Riprova")}</button></p> : !documents.length ? <p>{text("Aucun document lié à cette activité pour ce junior.", "No documents linked to this activity for this junior.", "Keine Dokumente für diesen Junior mit dieser Aktivität verknüpft.", "Nessun documento collegato a questa attività per questo junior.")}</p> : null}
    {documents.length ? <ul className={styles.list}>{documents.map(document => <li key={document.id}>
      <FileText size={17} aria-hidden="true" /><span>{document.file_name}{document.coach_only ? <small>{text("Coachs uniquement", "Coaches only", "Nur Trainer", "Solo allenatori")}</small> : null}</span>
      {document.public_url ? <a href={document.public_url} target="_blank" rel="noreferrer">{text("Ouvrir", "Open", "Öffnen", "Apri")}</a> : null}
    </li>)}</ul> : null}
    </div>
  </details>;
}
