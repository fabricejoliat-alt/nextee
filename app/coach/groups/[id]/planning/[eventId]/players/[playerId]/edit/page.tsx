"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";
import { ArrowLeft, ArrowRight, CalendarDays, ChevronRight, Clock3, ExternalLink, FileText, MapPin, Pencil, Save, ShieldCheck, Trash2, Upload } from "lucide-react";
import { createAppNotification } from "@/lib/notifications";
import { getNotificationMessage } from "@/lib/notificationMessages";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { pickLocaleText } from "@/lib/i18n/pickLocaleText";
import { optimizeUploadFile } from "@/lib/clientUploadFiles";
import EvaluationResponseField from "@/components/evaluations/EvaluationResponseField";
import { validateResponseValue, type EventEvaluationCriterion } from "@/lib/evaluationCriteria";
import actionStyles from "@/components/admin/organizations/OrganizationSettingsAdmin.module.css";
import pageStyles from "./CoachEvaluationEdit.module.css";

type EventRow = {
  id: string;
  group_id: string;
  club_id: string;
  event_type: "training" | "interclub" | "camp" | "session" | "event";
  starts_at: string;
  duration_minutes: number;
  location_text: string | null;
  series_id: string | null;
  status: "scheduled" | "cancelled";
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  handicap: number | null;
  avatar_url: string | null;
};

type CoachFeedbackRow = {
  event_id: string;
  player_id: string;
  coach_id: string;
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  visible_to_player: boolean;
  private_note: string | null;
  player_note: string | null;
};
type CoachLite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};
type AttendanceStatus = "expected" | "present" | "absent" | "excused";
type TrainingItemRow = {
  id: string;
  session_id: string;
  category: string;
  minutes: number;
  note: string | null;
  other_detail: string | null;
  created_at: string;
};
type EventStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
};
type PlayerPlannedStructureItemRow = {
  category: string;
  minutes: number;
  note: string | null;
  position: number | null;
};
type PlayerDashboardDocument = {
  id: string;
  organization_id: string;
  player_id: string;
  uploaded_by: string;
  uploaded_by_name?: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  coach_only: boolean;
  club_event_id: string | null;
  created_at: string;
  public_url: string;
};

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function nameOf(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    warmup_mobility: "Warmup / mobilité",
    long_game: "Long jeu",
    short_game_all: "Petit jeu (tout secteur)",
    putting: "Putting",
    wedging: "Wedging",
    pitching: "Pitching",
    chipping: "Chipping",
    bunker: "Bunker",
    course: "Parcours",
    mental: "Mental",
    fitness: "Fitness",
    other: "Autre",
  };
  return map[cat] ?? cat;
}

function initials(p?: { first_name: string | null; last_name: string | null } | null) {
  const f = (p?.first_name ?? "").trim();
  const l = (p?.last_name ?? "").trim();
  const fi = f ? f[0].toUpperCase() : "";
  const li = l ? l[0].toUpperCase() : "";
  return (fi + li) || "👤";
}

function PlayerAvatar({ player }: { player: ProfileRow | null }) {
  if (player?.avatar_url) {
    return (
      <img
        src={player.avatar_url}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return initials(player);
}

const MAX_SCORE = 6;

function RatingScale({ label, value, disabled, onChange }: { label: string; value: number | null; disabled: boolean; onChange: (value: number | null) => void }) {
  return <div className={pageStyles.ratingField}><span>{label}</span><div className={pageStyles.ratingGrid} role="group" aria-label={label}>{Array.from({ length: MAX_SCORE }, (_, index) => index + 1).map((score) => <button key={score} type="button" className={pageStyles.ratingButton} disabled={disabled} aria-pressed={value === score} onClick={() => onChange(value === score ? null : score)}>{score}</button>)}</div></div>;
}

function feedbackFingerprint(input: {
  engagement: number | null;
  attitude: number | null;
  performance: number | null;
  visible_to_player: boolean;
  private_note: string | null;
  player_note: string | null;
}) {
  return JSON.stringify({
    engagement: input.engagement ?? null,
    attitude: input.attitude ?? null,
    performance: input.performance ?? null,
    visible_to_player: !!input.visible_to_player,
    private_note: (input.private_note ?? "").trim() || null,
    player_note: (input.player_note ?? "").trim() || null,
  });
}

export default function CoachEventPlayerFeedbackEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string; eventId: string; playerId: string }>();
  const { locale } = useI18n();
  const groupId = String(params?.id ?? "").trim();
  const eventId = String(params?.eventId ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meId, setMeId] = useState("");

  const [event, setEvent] = useState<EventRow | null>(null);
  const [player, setPlayer] = useState<ProfileRow | null>(null);
  const [orderedPlayerIds, setOrderedPlayerIds] = useState<string[]>([]);
  const [attendanceStatus, setAttendanceStatus] = useState<AttendanceStatus>("present");
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const [initialFeedbackFp, setInitialFeedbackFp] = useState("");
  const [customCriteria, setCustomCriteria] = useState<EventEvaluationCriterion[]>([]);
  const [customResponses, setCustomResponses] = useState<Record<string, string | number | boolean | null>>({});
  const [lockedByCoach, setLockedByCoach] = useState<CoachLite | null>(null);
  const [eventStructureItems, setEventStructureItems] = useState<EventStructureItemRow[]>([]);
  const [playerPlannedStructureItems, setPlayerPlannedStructureItems] = useState<PlayerPlannedStructureItemRow[]>([]);
  const [sessionItems, setSessionItems] = useState<TrainingItemRow[]>([]);
  const [documents, setDocuments] = useState<PlayerDashboardDocument[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [docCoachOnly, setDocCoachOnly] = useState(false);
  const [renamingDocumentId, setRenamingDocumentId] = useState("");
  const [deletingDocumentId, setDeletingDocumentId] = useState("");
  const docFileInputRef = useRef<HTMLInputElement | null>(null);

  const [draft, setDraft] = useState<CoachFeedbackRow>({
    event_id: eventId,
    player_id: playerId,
    coach_id: "",
    engagement: null,
    attitude: null,
    performance: null,
    visible_to_player: false,
    private_note: null,
    player_note: null,
  });

  async function load() {
    setLoading(true);
    setError(null);

    try {
      if (!eventId || !playerId) throw new Error("Missing parameters.");

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Session invalide.");

      const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/players/${encodeURIComponent(playerId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Training not found."));

      setMeId(String(json?.meId ?? ""));
      setEvent((json?.event ?? null) as EventRow | null);
      setPlayer((json?.player ?? null) as ProfileRow | null);
      setEventStructureItems((json?.eventStructureItems ?? []) as EventStructureItemRow[]);
      setPlayerPlannedStructureItems((json?.playerPlannedStructureItems ?? []) as PlayerPlannedStructureItemRow[]);
      setSessionItems((json?.sessionItems ?? []) as TrainingItemRow[]);
      setLockedByCoach((json?.lockedByCoach ?? null) as CoachLite | null);
      setOrderedPlayerIds(
        Array.isArray(json?.orderedPlayerIds)
          ? (json.orderedPlayerIds as string[]).map((id) => String(id ?? "")).filter(Boolean)
          : [playerId]
      );

      const existingFeedback = (json?.feedback ?? null) as CoachFeedbackRow | null;
      if (existingFeedback) {
        const row = existingFeedback;
        setDraft(row);
        setInitialFeedbackFp(
          feedbackFingerprint({
            engagement: row.engagement,
            attitude: row.attitude,
            performance: row.performance,
            visible_to_player: row.visible_to_player,
            private_note: row.private_note,
            player_note: row.player_note,
          })
        );
      } else {
        const row = {
          event_id: eventId,
          player_id: playerId,
          coach_id: String(json?.meId ?? ""),
          engagement: null,
          attitude: null,
          performance: null,
          visible_to_player: false,
          private_note: null,
          player_note: null,
        };
        setDraft(row);
        setInitialFeedbackFp(
          feedbackFingerprint({
            engagement: row.engagement,
            attitude: row.attitude,
            performance: row.performance,
            visible_to_player: row.visible_to_player,
            private_note: row.private_note,
            player_note: row.player_note,
          })
        );
      }

      setAttendanceStatus((String(json?.attendanceStatus ?? "present") as AttendanceStatus) || "present");
      setCustomCriteria((json?.customEvaluationCriteria ?? []) as EventEvaluationCriterion[]);
      setCustomResponses(Object.fromEntries(((json?.customEvaluationResponses ?? []) as Array<{ event_criterion_id: string; value_json: string | number | boolean }>).map((row) => [row.event_criterion_id, row.value_json])));

      setLoading(false);
    } catch (e: unknown) {
      setError(errorMessage(e, "Erreur chargement."));
      setEvent(null);
      setPlayer(null);
      setOrderedPlayerIds([]);
      setEventStructureItems([]);
      setPlayerPlannedStructureItems([]);
      setSessionItems([]);
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, playerId]);

  async function loadDocuments() {
    if (!playerId) return;
    setLoadingDocuments(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const query = eventId ? `?club_event_id=${encodeURIComponent(eventId)}` : "";
      const res = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/documents${query}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Load documents error"));
      setDocuments((json?.documents ?? []) as PlayerDashboardDocument[]);
    } catch {
      setDocuments([]);
    } finally {
      setLoadingDocuments(false);
    }
  }

  useEffect(() => {
    void loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, eventId]);

  function openDocumentPicker() {
    if (uploadingDocument) return;
    docFileInputRef.current?.click();
  }

  function onPickDocument(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    setDocFile(file);
    setDocName(file?.name ?? "");
  }

  async function uploadDocument() {
    if (!docFile || !playerId || !event?.club_id || uploadingDocument) return;
    const finalDocName = docName.trim();
    if (!finalDocName) {
      setError("Veuillez saisir un nom de document.");
      return;
    }
    setUploadingDocument(true);
    try {
      const uploadFile = await optimizeUploadFile(docFile);
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");

      const prepareRes = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/documents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "prepare",
          organization_id: event.club_id,
          coach_only: docCoachOnly,
          club_event_id: eventId,
          original_name: uploadFile.name,
          mime_type: uploadFile.type,
          size_bytes: uploadFile.size,
        }),
      });
      const prepareJson = await prepareRes.json().catch(() => ({}));
      if (!prepareRes.ok) throw new Error(String(prepareJson?.error ?? "Upload failed"));

      const uploadPath = String(prepareJson?.path ?? "").trim();
      const uploadToken = String(prepareJson?.token ?? "").trim();
      if (!uploadPath || !uploadToken) throw new Error("Upload initialization failed");

      const uploadRes = await supabase.storage.from("marketplace").uploadToSignedUrl(uploadPath, uploadToken, uploadFile, {
        upsert: false,
        contentType: uploadFile.type || "application/octet-stream",
      });
      if (uploadRes.error) throw new Error(uploadRes.error.message);

      const finalizeRes = await fetch(`/api/coach/players/${encodeURIComponent(playerId)}/documents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "finalize",
          organization_id: event.club_id,
          coach_only: docCoachOnly,
          club_event_id: eventId,
          storage_path: uploadPath,
          original_name: uploadFile.name,
          file_name: finalDocName,
          mime_type: uploadFile.type,
          size_bytes: uploadFile.size,
        }),
      });
      const json = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) throw new Error(String(json?.error ?? "Upload failed"));

      const created = json?.document as PlayerDashboardDocument | undefined;
      if (created?.id) {
        setDocuments((prev) => [created, ...prev]);
      } else {
        await loadDocuments();
      }
      setDocFile(null);
      setDocName("");
      setDocCoachOnly(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    } catch (e: unknown) {
      setError(errorMessage(e, "Upload failed"));
    } finally {
      setUploadingDocument(false);
    }
  }

  async function renameDocument(doc: PlayerDashboardDocument) {
    if (!meId || meId !== String(doc.uploaded_by ?? "")) return;
    const currentName = String(doc.file_name ?? "").trim();
    const nextName = window.prompt("Nouveau nom du document", currentName)?.trim() ?? "";
    if (!nextName || nextName === currentName) return;
    setRenamingDocumentId(doc.id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token || !playerId) throw new Error("Missing token");
      const res = await fetch(
        `/api/coach/players/${encodeURIComponent(playerId)}/documents/${encodeURIComponent(doc.id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ file_name: nextName }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Rename failed"));
      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, file_name: String(json?.document?.file_name ?? nextName) } : d))
      );
    } catch (e: unknown) {
      setError(errorMessage(e, "Rename failed"));
    } finally {
      setRenamingDocumentId("");
    }
  }

  async function toggleDocumentCoachOnly(doc: PlayerDashboardDocument) {
    if (!meId || meId !== String(doc.uploaded_by ?? "")) return;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token || !playerId) throw new Error("Missing token");
      const res = await fetch(
        `/api/coach/players/${encodeURIComponent(playerId)}/documents/${encodeURIComponent(doc.id)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ coach_only: !doc.coach_only }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Update failed"));
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === doc.id ? { ...d, coach_only: Boolean(json?.document?.coach_only ?? !doc.coach_only) } : d
        )
      );
    } catch (e: unknown) {
      setError(errorMessage(e, "Update failed"));
    }
  }

  async function deleteDocument(doc: PlayerDashboardDocument) {
    if (!doc?.id || deletingDocumentId || !meId || meId !== String(doc.uploaded_by ?? "")) return;
    const ok = window.confirm(`Supprimer le document "${doc.file_name}" ?`);
    if (!ok) return;
    setDeletingDocumentId(doc.id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? "";
      if (!token) throw new Error("Missing token");
      const res = await fetch(
        `/api/coach/players/${encodeURIComponent(playerId)}/documents/${encodeURIComponent(doc.id)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(json?.error ?? "Delete failed"));
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e: unknown) {
      setError(errorMessage(e, "Delete failed"));
    } finally {
      setDeletingDocumentId("");
    }
  }

  const canSave = useMemo(() => {
    if (busy || loading) return false;
    if (!event || !player) return false;
    return true;
  }, [busy, loading, event, player]);
  const displayedPlannedItems = playerPlannedStructureItems.length > 0 ? playerPlannedStructureItems : eventStructureItems;
  const plannedLabel = playerPlannedStructureItems.length > 0 ? "Planifiée pour ce joueur" : "Planifiée commune au groupe";
  const canShowStructure = event?.event_type === "training" || event?.event_type === "camp";
  const evaluationLocked = busy;
  const lockedByCoachName = lockedByCoach ? nameOf(lockedByCoach.first_name, lockedByCoach.last_name) : "un autre coach";

  const nextPlayerId = useMemo(() => {
    const idx = orderedPlayerIds.indexOf(playerId);
    if (idx < 0) return null;
    return orderedPlayerIds[idx + 1] ?? null;
  }, [orderedPlayerIds, playerId]);

  async function save(goNext = false) {
    setBusy(true);
    setError(null);

    if (attendanceStatus !== "absent") {
      const missing = customCriteria.find((criterion) => criterion.snapshot_is_required && !validateResponseValue(criterion.snapshot_response_format, criterion.snapshot_choices, customResponses[criterion.id]));
      if (missing) { setError(`Le critère « ${missing.snapshot_name} » est obligatoire.`); setBusy(false); return; }
    }

    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? "";
    if (!token) {
      setError("Session invalide.");
      setBusy(false);
      return;
    }

    const saveRes = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/players/${encodeURIComponent(playerId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attendance_status: attendanceStatus,
        engagement: draft.engagement,
        attitude: draft.attitude,
        performance: draft.performance,
        visible_to_player: attendanceStatus === "absent" ? false : true,
        private_note: draft.private_note?.trim() || null,
        player_note: attendanceStatus === "absent" ? null : draft.player_note?.trim() || null,
        custom_responses: customResponses,
      }),
    });
    const saveJson = await saveRes.json().catch(() => ({}));
    if (!saveRes.ok) {
      setError(String(saveJson?.error ?? "Save failed"));
      setBusy(false);
      return;
    }

    const nextFeedbackFp = feedbackFingerprint({
      engagement: attendanceStatus === "absent" ? null : draft.engagement,
      attitude: attendanceStatus === "absent" ? null : draft.attitude,
      performance: attendanceStatus === "absent" ? null : draft.performance,
      visible_to_player: attendanceStatus === "absent" ? false : true,
      private_note: draft.private_note,
      player_note: attendanceStatus === "absent" ? null : draft.player_note,
    });

    if (attendanceStatus !== "absent" && meId && playerId && nextFeedbackFp !== initialFeedbackFp) {
      const eventTypeLabel =
        event?.event_type === "camp"
          ? pickLocaleText(locale, "Stage", "Camp")
          : event?.event_type === "interclub"
          ? pickLocaleText(locale, "Interclubs", "Interclub")
          : event?.event_type === "session"
          ? pickLocaleText(locale, "Séance", "Session")
          : event?.event_type === "event"
          ? pickLocaleText(locale, "Événement", "Event")
          : pickLocaleText(locale, "Entraînement", "Training");
      const msg = await getNotificationMessage("notif.coachPlayerEvaluated", locale, {
        playerName: nameOf(player?.first_name ?? null, player?.last_name ?? null),
        eventType: eventTypeLabel,
        dateTime: fmtDateTime(event?.starts_at ?? new Date().toISOString()),
      });
      await createAppNotification({
        actorUserId: meId,
        kind: "coach_player_evaluated",
        title: msg.title,
        body: msg.body,
        data: {
          event_id: eventId,
          group_id: groupId,
          player_id: playerId,
          url: `/player/golf/trainings/new?club_event_id=${eventId}`,
        },
        recipientUserIds: [playerId],
      });
    }

    setBusy(false);
    if (goNext) {
      if (nextPlayerId) {
        router.push(`/coach/groups/${groupId}/planning/${eventId}/players/${nextPlayerId}/edit`);
      } else {
        router.push(`/coach/groups/${groupId}/planning/${eventId}`);
      }
      return;
    }
    router.push(`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}`);
  }

  async function setPresence(next: "present" | "absent") {
    if (attendanceBusy || busy) return;
    const prev = attendanceStatus;
    setAttendanceStatus(next);
    setAttendanceBusy(true);
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token ?? "";
    if (!token) {
      setAttendanceStatus(prev);
      setError("Session invalide.");
      setAttendanceBusy(false);
      return;
    }
    const res = await fetch(`/api/coach/events/${encodeURIComponent(eventId)}/players/${encodeURIComponent(playerId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        attendance_status: next,
        engagement: draft.engagement,
        attitude: draft.attitude,
        performance: draft.performance,
        visible_to_player: draft.visible_to_player,
        private_note: draft.private_note?.trim() || null,
        player_note: draft.player_note?.trim() || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAttendanceStatus(prev);
      setError(String(json?.error ?? "Save failed"));
    }
    setAttendanceBusy(false);
  }

  function handlePresenceToggle() {
    const next: "present" | "absent" = attendanceStatus === "present" ? "absent" : "present";
    const ok = window.confirm(
      next === "absent" ? "Confirmer le passage à absent ?" : "Confirmer le passage à présent ?"
    );
    if (!ok) return;
    void setPresence(next);
  }

  return (
    <main className={pageStyles.page}>
      <div className={pageStyles.stack}>
        <nav className={actionStyles.breadcrumb} aria-label="Fil d’Ariane">
          <Link href="/coach">Coach</Link><ChevronRight size={13} aria-hidden="true" />
          <Link href="/coach/groups">Mes groupes</Link><ChevronRight size={13} aria-hidden="true" />
          <Link href={`/coach/groups/${groupId}/planning`}>Planification</Link><ChevronRight size={13} aria-hidden="true" />
          <Link href={`/coach/groups/${groupId}/planning/${eventId}`}>Activité</Link><ChevronRight size={13} aria-hidden="true" />
          <span>Évaluation</span>
        </nav>
        <header className={pageStyles.headerBlock}>
          <div className={pageStyles.headerRow}>
            <div><h1>Évaluer {player ? nameOf(player.first_name, player.last_name) : "le junior"}</h1><p>Renseignez la présence, les observations et le retour destiné au junior.</p></div>
            <div className={pageStyles.headerActions}>
              <Link className={actionStyles.backButton} href={`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}`}><ArrowLeft size={16} aria-hidden="true" />Retour à la fiche</Link>
            </div>
          </div>
          {error ? <div className={actionStyles.errorAlert} role="alert">{error}</div> : null}
        </header>

        <section className={pageStyles.content}>
          {loading ? (
            <div className={pageStyles.panel}><CompactLoadingBlock label="Chargement de l’évaluation…" /></div>
          ) : !event || !player ? (
            <div className={pageStyles.panel}>Aucune donnée disponible pour cette évaluation.</div>
          ) : (
            <div className={pageStyles.formStack}>
              <section className={pageStyles.panel}>
                <div className={pageStyles.identity}>
                  <div className={pageStyles.person}>
                  <div className={pageStyles.avatar}>
                    <PlayerAvatar player={player} />
                  </div>
                  <div className={pageStyles.personCopy}>
                    <span className={pageStyles.eyebrow}>Junior à évaluer</span>
                    <strong className={pageStyles.personName}>{nameOf(player.first_name, player.last_name)}</strong>
                    <span className={pageStyles.fileName}>Handicap {typeof player.handicap === "number" ? player.handicap.toFixed(1) : "non renseigné"}</span>
                  </div>
                </div>
                  <AttendanceToggle
                    checked={attendanceStatus === "present"}
                    onToggle={handlePresenceToggle}
                    disabled={attendanceBusy || evaluationLocked}
                    ariaLabel="Basculer présence"
                    leftLabel="Absent"
                    rightLabel="Présent"
                  />
                </div>
                <div className={pageStyles.metadata}>
                  <span className={pageStyles.meta}><CalendarDays size={14} aria-hidden="true" />{fmtDateTime(event.starts_at)}</span>
                  <span className={pageStyles.meta}><Clock3 size={14} aria-hidden="true" />{event.duration_minutes} min</span>
                  {event.location_text ? <span className={pageStyles.meta}><MapPin size={14} aria-hidden="true" />{event.location_text}</span> : null}
                </div>
              </section>

              <div className={pageStyles.twoColumns}>
                <div className={pageStyles.column}>

              {canShowStructure ? (
                <section className={pageStyles.panel}>
                  <div className={pageStyles.panelHeader}><div><h2 className={pageStyles.panelTitle}>Structure de l’entraînement</h2><p>Contenu planifié et données renseignées par le junior.</p></div></div>

                  {displayedPlannedItems.length === 0 && sessionItems.length === 0 ? (
                    <div className={pageStyles.mutedAlert}>Aucune structure n’a été renseignée.</div>
                  ) : (
                    <div className={pageStyles.column}>
                      {displayedPlannedItems.length > 0 ? (
                        <div className={pageStyles.structureGroup}>
                          <h3>{plannedLabel}</h3>
                          <ul className={pageStyles.structureList}>
                            {displayedPlannedItems.map((it, idx) => {
                              const extra = String(it.note ?? "").trim();
                              return (
                                <li key={`coach-struct-${idx}`}>
                                  <b>{categoryLabel(it.category)}</b><span>{it.minutes} min{extra ? ` · ${extra}` : ""}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}

                      {sessionItems.length > 0 ? (
                        <div className={pageStyles.structureGroup}>
                          <h3>Version junior</h3>
                          <ul className={pageStyles.structureList}>
                            {sessionItems.map((it) => {
                              const extra = String(it.note ?? it.other_detail ?? "").trim();
                              return (
                                <li key={it.id}>
                                  <b>{categoryLabel(it.category)}</b><span>{it.minutes} min{extra ? ` · ${extra}` : ""}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )}
                </section>
              ) : null}

              <section className={`${pageStyles.panel} ${pageStyles.documentPanel}`}>
                <div className={`${pageStyles.panelHeader} ${pageStyles.documentPanelHeader}`}><div><h2 className={pageStyles.panelTitle}>Documents du junior</h2><p>Ajoutez ou consultez les fichiers liés à cette activité.</p></div><span className={pageStyles.documentCount}>{documents.length}</span></div>

                <input
                  ref={docFileInputRef}
                  type="file"
                  onChange={onPickDocument}
                  style={{ display: "none" }}
                />

                <div className={pageStyles.uploadBox}>
                  <div className={pageStyles.uploadHeading}>
                    <span className={pageStyles.uploadIcon}><Upload size={16} aria-hidden="true" /></span>
                    <div><b>Ajouter un document</b><small>Choisissez un fichier puis vérifiez son nom.</small></div>
                  </div>
                  <button type="button" className={pageStyles.filePicker} onClick={openDocumentPicker} disabled={uploadingDocument}>
                    <FileText size={16} aria-hidden="true" />
                    <span><b>{docFile ? docFile.name : "Choisir un fichier"}</b><small>{docFile ? "Fichier prêt à être ajouté" : "Aucun fichier sélectionné"}</small></span>
                  </button>
                  <label className={pageStyles.field}><span>Nom du document</span><input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Ex. Analyse vidéo du swing" maxLength={180} /></label>
                  <label className={pageStyles.checkField}><input type="checkbox" checked={docCoachOnly} onChange={(e) => setDocCoachOnly(e.target.checked)} disabled={uploadingDocument} /><span><b>Réserver aux coachs</b><small>Le junior ne pourra pas consulter ce document.</small></span></label>
                  <button className={actionStyles.primaryButton} type="button" disabled={!docFile || !docName.trim() || uploadingDocument} onClick={() => void uploadDocument()}><Upload size={15} aria-hidden="true" />{uploadingDocument ? "Ajout en cours…" : "Ajouter le document"}</button>
                </div>

                <div className={pageStyles.documentSectionTitle}><span>Documents liés</span><small>{documents.length ? `${documents.length} fichier${documents.length > 1 ? "s" : ""}` : "Aucun fichier"}</small></div>
                {loadingDocuments ? (
                  <CompactLoadingBlock label="Chargement des documents…" />
                ) : documents.length === 0 ? (
                  <div className={pageStyles.mutedAlert}>Aucun document lié à cette activité.</div>
                ) : (
                  <div className={pageStyles.documentList}>
                    {documents.map((doc) => {
                      const uploader = String(doc.uploaded_by_name ?? "").trim() || String(doc.uploaded_by ?? "").slice(0, 8);
                      const canManage = meId === String(doc.uploaded_by ?? "");
                      return (
                        <div key={doc.id} className={pageStyles.documentItem}>
                          <div className={pageStyles.documentTop}>
                            <div className={pageStyles.documentCopy}>
                              <b>{doc.file_name}</b>
                              <div className={pageStyles.documentBadges}>
                                <span className={pageStyles.badge}>Activité</span>
                                {doc.coach_only ? <span className={pageStyles.badge}><ShieldCheck size={11} aria-hidden="true" />Coachs uniquement</span> : null}
                              </div>
                              <small>
                                Par {uploader} • {new Intl.DateTimeFormat("fr-CH", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                }).format(new Date(doc.created_at))}
                              </small>
                            </div>
                            <a
                              href={doc.public_url}
                              target="_blank"
                              rel="noreferrer"
                              className={pageStyles.iconButton}
                              aria-label={`Ouvrir ${doc.file_name}`}
                              title="Ouvrir"
                            >
                              <ExternalLink size={15} aria-hidden="true" />
                            </a>
                          </div>
                          {canManage ? (
                            <div className={pageStyles.documentActions}>
                              <button
                                type="button"
                                className={pageStyles.iconButton}
                                onClick={() => void renameDocument(doc)}
                                disabled={renamingDocumentId === doc.id || deletingDocumentId === doc.id}
                                aria-label={`Renommer ${doc.file_name}`}
                                title="Renommer"
                              >
                                <Pencil size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={pageStyles.iconButton}
                                onClick={() => void toggleDocumentCoachOnly(doc)}
                                disabled={renamingDocumentId === doc.id || deletingDocumentId === doc.id}
                                aria-label={doc.coach_only ? `Rendre ${doc.file_name} visible au junior` : `Réserver ${doc.file_name} aux coachs`}
                                title={doc.coach_only ? "Rendre visible au junior" : "Réserver aux coachs"}
                              >
                                <ShieldCheck size={15} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={pageStyles.dangerIconButton}
                                onClick={() => void deleteDocument(doc)}
                                disabled={deletingDocumentId === doc.id || renamingDocumentId === doc.id}
                                aria-label={`Supprimer ${doc.file_name}`}
                                title="Supprimer"
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
                </div>

                <div className={pageStyles.column}>

              <section className={`${pageStyles.panel} ${pageStyles.column}`}>
                <div className={pageStyles.panelHeader}><div><h2 className={pageStyles.panelTitle}>Évaluation coach</h2><p>Attribuez une valeur de 1 à 6 pour chaque dimension.</p></div></div>
                {lockedByCoach ? (
                  <div className={pageStyles.infoAlert}>
                    Cette évaluation a déjà été saisie par {lockedByCoachName}. Elle est partagée : vous pouvez la compléter ou la mettre à jour.
                  </div>
                ) : null}
                <div className={pageStyles.description}>
                  <div><b>Engagement :</b> implication dans l’entraînement.</div>
                  <div><b>Attitude :</b> concentration, comportement et esprit.</div>
                  <div><b>Application :</b> qualité de mise en pratique des exercices.</div>
                </div>

                {attendanceStatus === "absent" ? (
                  <div className={pageStyles.mutedAlert}>
                    Junior absent : seule la note privée du coach est disponible.
                  </div>
                ) : (
                  <div className={pageStyles.column}>
                    <RatingScale label="Engagement" value={draft.engagement} disabled={evaluationLocked} onChange={(value) => setDraft((current) => ({ ...current, engagement: value }))} />
                    <RatingScale label="Attitude" value={draft.attitude} disabled={evaluationLocked} onChange={(value) => setDraft((current) => ({ ...current, attitude: value }))} />
                    <RatingScale label="Application" value={draft.performance} disabled={evaluationLocked} onChange={(value) => setDraft((current) => ({ ...current, performance: value }))} />
                  </div>
                )}
              </section>

              {attendanceStatus !== "absent" && customCriteria.length ? (
                <section className={`${pageStyles.panel} ${pageStyles.column}`}>
                  <div className={pageStyles.panelHeader}><div><h2 className={pageStyles.panelTitle}>Focus personnalisés</h2><p>Les champs marqués d’un astérisque sont obligatoires.</p></div></div>
                  {customCriteria.map((criterion) => <label key={criterion.id} className={pageStyles.field}><span>{criterion.snapshot_name}{criterion.snapshot_is_required ? " *" : ""}</span>{criterion.snapshot_description ? <small>{criterion.snapshot_description}</small> : null}<EvaluationResponseField name={criterion.snapshot_name} format={criterion.snapshot_response_format} choices={criterion.snapshot_choices} value={customResponses[criterion.id]} disabled={evaluationLocked} onChange={(value) => setCustomResponses((current) => ({ ...current, [criterion.id]: value }))}/></label>)}
                </section>
              ) : null}

              {attendanceStatus !== "absent" ? (
                <section className={`${pageStyles.panel} ${pageStyles.column}`}>
                  <div className={pageStyles.panelHeader}><div><h2 className={pageStyles.panelTitle}>Retour au junior</h2><p>Ce commentaire sera visible par le junior.</p></div></div>
                  <label className={pageStyles.field}>
                    <span>Note pour le junior</span>
                    <textarea
                      value={draft.player_note ?? ""}
                      onChange={(e) => setDraft((p) => ({ ...p, player_note: e.target.value }))}
                      disabled={evaluationLocked}
                      placeholder="Votre retour pour le junior…"
                    />
                  </label>
                </section>
              ) : null}

              <section className={`${pageStyles.panel} ${pageStyles.column}`}>
                <div className={pageStyles.panelHeader}><div><h2 className={pageStyles.panelTitle}>Note privée</h2><p>Visible uniquement par les coachs autorisés.</p></div></div>
                <label className={pageStyles.field}>
                  <span>Note interne</span>
                  <textarea
                    value={draft.private_note ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, private_note: e.target.value }))}
                    disabled={evaluationLocked}
                    placeholder="Ajouter une note privée…"
                  />
                </label>
              </section>
                </div>
              </div>

              <section className={`${pageStyles.panel} ${pageStyles.footer}`}>
                <div className={pageStyles.footerActions}>
                  <Link className={actionStyles.secondaryButton} href={`/coach/groups/${groupId}/planning/${eventId}/players/${playerId}`}>Annuler</Link>
                  <button
                    type="button"
                    className={actionStyles.primaryButton}
                    disabled={!canSave}
                    onClick={() => save(true)}
                  >
                    {nextPlayerId ? <ArrowRight size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                    {busy ? "Enregistrement…" : nextPlayerId ? "Enregistrer et suivant" : "Enregistrer et fermer"}
                  </button>
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
