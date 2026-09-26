import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
import {
  COACH_PREPARATION_MAX_HISTORY_EVENTS,
  completedBefore,
  isFutureTraining,
  normalizeCoachPreparationPoints,
  selectPreparationPrivateNote,
  type CoachPreparationInsight,
} from "@/lib/coachPreparationInsights";
import { isCoachTrainingAssistanceEnabled } from "@/lib/server/coachTrainingAssistance";

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

type CacheRow = {
  player_id: string;
  source_fingerprint: string;
  attention_points: unknown;
  source_event_count: number;
  generated_at: string;
};

type OpenAIResponse = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

const COACH_PREPARATION_GENERATION_VERSION = 2;

function extractOutputText(response: OpenAIResponse) {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function isMissingCacheTable(error: { code?: string | null; message?: string | null } | null) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("coach_training_preparation_insights");
}

function recordKey(eventId: string, playerId: string) {
  return `${eventId}:${playerId}`;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function generateAttentionPoints(apiKey: string, playerHistory: unknown) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_COACH_MODEL || "gpt-4o-mini",
      store: false,
      max_output_tokens: 500,
      input: [
        {
          role: "system",
          content:
            "Tu aides un entraîneur de golf à préparer la prochaine séance d'un seul junior. Utilise exclusivement les faits et consignes explicitement présents dans les notes privées fournies. Produis de 1 à 4 points selon le nombre réel d'informations distinctes et utiles : une note qui ne contient qu'une seule information doit donner un seul point. Ne complète jamais la liste pour atteindre un quota. Reformule brièvement chaque information comme un point d'attention concret en français, sans ajouter d'exercice, de conseil technique, d'objectif, de cause, de conséquence ou de contexte absent de la note. Une information logistique doit rester logistique. Priorise les notes les plus récentes. N'utilise ni notes visibles par le junior, ni évaluations chiffrées. N'invente aucun fait, diagnostic, objectif médical ou jugement. Ne mentionne aucun autre joueur et n'affirme pas qu'une action a déjà été réalisée.",
        },
        { role: "user", content: JSON.stringify(playerHistory) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "coach_training_private_note_checklist",
          strict: true,
          schema: {
            type: "object",
            properties: {
              points: {
                type: "array",
                minItems: 1,
                maxItems: 4,
                items: { type: "string", minLength: 1, maxLength: 180 },
              },
            },
            required: ["points"],
            additionalProperties: false,
          },
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await response.json().catch(() => ({}))) as OpenAIResponse;
  if (!response.ok) throw new Error(json.error?.message || "AI analysis failed");
  const parsed = JSON.parse(extractOutputText(json) || "{}") as unknown;
  const points = normalizeCoachPreparationPoints(parsed);
  if (points.length < 1) throw new Error("AI returned an empty private-note checklist");
  return points;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(token);
    const targetEvent = await requireCoachEventAccess(supabaseAdmin, callerId, eventId);
    if (!isFutureTraining(targetEvent)) {
      return NextResponse.json({ insights: [], history_event_count: 0 });
    }
    if (!(await isCoachTrainingAssistanceEnabled(supabaseAdmin, targetEvent.club_id, callerId))) {
      return NextResponse.json({ error: "Training assistance is disabled for this coach." }, { status: 403 });
    }

    const targetAttendeesRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id")
      .eq("event_id", eventId);
    if (targetAttendeesRes.error) throw new Error(targetAttendeesRes.error.message);
    const playerIds = Array.from(
      new Set((targetAttendeesRes.data ?? []).map((row) => String(row.player_id ?? "").trim()).filter(Boolean))
    );
    if (playerIds.length === 0) return NextResponse.json({ insights: [], history_event_count: 0 });

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
    if (historyEventIds.length === 0) return NextResponse.json({ insights: [], history_event_count: 0 });

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
    const playersWithoutSource = playerIds.filter((playerId) => !sourceByPlayerId.has(playerId));
    if (playersWithoutSource.length > 0) {
      const cleanupRes = await supabaseAdmin
        .from("coach_training_preparation_insights")
        .delete()
        .eq("target_event_id", eventId)
        .in("player_id", playersWithoutSource);
      if (cleanupRes.error && !isMissingCacheTable(cleanupRes.error)) throw new Error(cleanupRes.error.message);
    }
    if (sourceByPlayerId.size === 0) return NextResponse.json({ insights: [], history_event_count: historyEventIds.length });

    let cacheAvailable = true;
    const cacheByPlayerId = new Map<string, CacheRow>();
    const cacheRes = await supabaseAdmin
      .from("coach_training_preparation_insights")
      .select("player_id,source_fingerprint,attention_points,source_event_count,generated_at")
      .eq("target_event_id", eventId)
      .in("player_id", Array.from(sourceByPlayerId.keys()));
    if (cacheRes.error) {
      if (!isMissingCacheTable(cacheRes.error)) throw new Error(cacheRes.error.message);
      cacheAvailable = false;
    } else {
      for (const row of (cacheRes.data ?? []) as CacheRow[]) cacheByPlayerId.set(row.player_id, row);
    }

    const insights: CoachPreparationInsight[] = [];
    const misses: Array<[string, { source: unknown; sourceCount: number; sourceHash: string }]> = [];
    for (const [playerId, sourceData] of sourceByPlayerId) {
      const cached = cacheByPlayerId.get(playerId);
      const cachedPoints = cached ? normalizeCoachPreparationPoints(cached.attention_points) : [];
      if (cached && cached.source_fingerprint === sourceData.sourceHash && cachedPoints.length >= 1) {
        insights.push({
          player_id: playerId,
          points: cachedPoints,
          source_event_count: cached.source_event_count,
          generated_at: cached.generated_at,
        });
      } else {
        misses.push([playerId, sourceData]);
      }
    }

    if (misses.length > 0) {
      const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
      if (!apiKey) return NextResponse.json({ error: "AI analysis is not configured." }, { status: 503 });
      let firstGenerationError: unknown = null;
      for (let index = 0; index < misses.length; index += 3) {
        const batch = misses.slice(index, index + 3);
        const settled = await Promise.allSettled(
          batch.map(async ([playerId, sourceData]) => ({
            playerId,
            sourceData,
            points: await generateAttentionPoints(apiKey, sourceData.source),
            generatedAt: new Date().toISOString(),
          }))
        );
        const generated = settled.flatMap((result) => {
          if (result.status === "fulfilled") return [result.value];
          firstGenerationError ??= result.reason;
          return [];
        });
        for (const item of generated) {
          insights.push({
            player_id: item.playerId,
            points: item.points,
            source_event_count: item.sourceData.sourceCount,
            generated_at: item.generatedAt,
          });
          if (cacheAvailable) {
            const writeRes = await supabaseAdmin.from("coach_training_preparation_insights").upsert(
              {
                target_event_id: eventId,
                player_id: item.playerId,
                organization_id: targetEvent.club_id,
                group_id: targetEvent.group_id,
                history_event_ids: historyEventIds,
                source_fingerprint: item.sourceData.sourceHash,
                attention_points: item.points,
                source_event_count: item.sourceData.sourceCount,
                model: process.env.OPENAI_COACH_MODEL || "gpt-4o-mini",
                generated_at: item.generatedAt,
                updated_at: item.generatedAt,
              },
              { onConflict: "target_event_id,player_id" }
            );
            if (writeRes.error && isMissingCacheTable(writeRes.error)) cacheAvailable = false;
          }
        }
      }
      if (insights.length === 0 && firstGenerationError) throw firstGenerationError;
    }

    insights.sort((a, b) => playerIds.indexOf(a.player_id) - playerIds.indexOf(b.player_id));
    return NextResponse.json({ insights, history_event_count: historyEventIds.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const status = message === "forbidden" ? 403 : message === "event_not_found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
