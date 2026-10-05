import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COACH_PREPARATION_MAX_HISTORY_EVENTS, completedBefore, selectPreparationPrivateNote } from "../coachPreparationInsights.ts";
type HistoryEvent = {
  id: string;
  starts_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  status: string;
};

type HistoryFeedback = {
  event_id: string;
  player_id: string;
  private_note: string | null;
  updated_at: string | null;
};

type ValidatedPrivateNote = {
  id: string;
  event_id: string;
  player_id: string;
  body: string;
  source_report_version: number;
  validated_at: string;
};


const COACH_PREPARATION_GENERATION_VERSION = 2;
// Keep identifiers and exact timestamps in the local fingerprint, outside the provider payload.
export function coachPreparationProviderInput(source: unknown) {
  const history = source as { private_notes_by_session?: Array<{ private_notes?: Array<{ text?: string }> }> };
  return {
    sessions: (history.private_notes_by_session ?? []).map((session, index) => ({
      recency_order: index + 1,
      notes: (session.private_notes ?? []).map((note) => String(note.text ?? "")),
    })),
  };
}
function recordKey(eventId: string, playerId: string) { return `${eventId}:${playerId}`; }
function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

/** Caller must authorize the target event before reading these private sources. */
export async function loadCoachPreparationSources(
 supabaseAdmin: SupabaseClient,
 targetEvent: { id: string; group_id: string; club_id: string },
 playerIds: string[]
) {
 const eventId = targetEvent.id;
    const now = new Date();
    const historyEventsRes = await supabaseAdmin
      .from("club_events")
      .select("id,starts_at,ends_at,duration_minutes,status")
      .eq("group_id", targetEvent.group_id)
      .eq("club_id", targetEvent.club_id)
      .eq("event_type", "training")
      .neq("id", eventId)
      .lt("starts_at", now.toISOString())
      .order("starts_at", { ascending: false })
      .limit(12);
    if (historyEventsRes.error) throw new Error(historyEventsRes.error.message);
    const historyEvents = ((historyEventsRes.data ?? []) as HistoryEvent[])
      .filter((event) => completedBefore(event, now))
      .slice(0, COACH_PREPARATION_MAX_HISTORY_EVENTS);
    const historyEventIds = historyEvents.map((event) => event.id);
    if (historyEventIds.length === 0 || playerIds.length === 0) return { sourceByPlayerId: new Map<string, { source: unknown; sourceCount: number; sourceHash: string }>(), historyEventIds };

    const [feedbackRes, validatedNotesRes] = await Promise.all([
      supabaseAdmin
        .from("club_event_coach_feedback")
        .select("event_id,player_id,private_note,updated_at")
        .in("event_id", historyEventIds)
        .in("player_id", playerIds),
      supabaseAdmin
        .from("coach_player_private_notes")
        .select("id,event_id,player_id,body,source_report_version,validated_at")
        .in("event_id", historyEventIds)
        .in("player_id", playerIds)
        .order("validated_at", { ascending: false }),
    ]);
    if (feedbackRes.error) throw new Error(feedbackRes.error.message);
    if (validatedNotesRes.error) throw new Error(validatedNotesRes.error.message);

    const feedbackByKey = new Map(
      ((feedbackRes.data ?? []) as HistoryFeedback[]).map((row) => [recordKey(row.event_id, row.player_id), row])
    );
    const latestValidatedNoteByKey = new Map<string, ValidatedPrivateNote>();
    for (const note of (validatedNotesRes.data ?? []) as ValidatedPrivateNote[]) {
      const key = recordKey(note.event_id, note.player_id);
      if (!latestValidatedNoteByKey.has(key) && String(note.body ?? "").trim()) {
        latestValidatedNoteByKey.set(key, note);
      }
    }

    const sourceByPlayerId = new Map<string, { source: unknown; sourceCount: number; sourceHash: string }>();
    for (const playerId of playerIds) {
      const privateNoteSessions = historyEvents.flatMap((historyEvent) => {
        const key = recordKey(historyEvent.id, playerId);
        const feedback = feedbackByKey.get(key);
        const validatedNote = latestValidatedNoteByKey.get(key);
        const selectedNote = selectPreparationPrivateNote({
          feedbackText: feedback?.private_note,
          feedbackUpdatedAt: feedback?.updated_at,
          validatedText: validatedNote?.body,
          validatedAt: validatedNote?.validated_at,
        });
        if (!selectedNote) return [];
        return [{
          event_id: historyEvent.id,
          date: historyEvent.starts_at,
          private_notes: [{
            id: selectedNote.source === "validated"
              ? validatedNote?.id ?? `validated:${historyEvent.id}:${playerId}`
              : `feedback:${historyEvent.id}:${playerId}`,
            text: selectedNote.text,
            saved_at: selectedNote.savedAt || historyEvent.starts_at,
          }],
        }];
      });
      if (privateNoteSessions.length === 0) continue;
      const source = {
        player_reference: playerId,
        instructions_context: "Préparation de la prochaine séance à partir des notes privées du même joueur",
        private_notes_by_session: privateNoteSessions,
      };
      sourceByPlayerId.set(playerId, {
        source,
        sourceCount: privateNoteSessions.length,
        sourceHash: fingerprint({ generationVersion: COACH_PREPARATION_GENERATION_VERSION, source }),
      });
    }

 return { sourceByPlayerId, historyEventIds };
}
