import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
import { COACH_PRIVATE_NOTE_MAX_LENGTH } from "@/lib/coachDebrief";
import { isCoachTrainingAssistanceEnabled } from "@/lib/server/coachTrainingAssistance";

type OpenAIResponse = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

function extractOutputText(response: OpenAIResponse) {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function requiredUuid(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function responseLanguage(value: unknown) {
  const locale = String(value ?? "").trim().toLowerCase().split("-")[0];
  if (locale === "en") return "English";
  if (locale === "de") return "German";
  if (locale === "it") return "Italian";
  return "French";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const playerId = requiredUuid(body?.player_id);
    const sourceText = String(body?.source_text ?? "").trim();
    const audience = body?.audience === "private" ? "private" : "junior";
    const outputLanguage = responseLanguage(body?.locale);
    if (!playerId) return NextResponse.json({ error: "Invalid player" }, { status: 400 });
    if (!sourceText || sourceText.length > COACH_PRIVATE_NOTE_MAX_LENGTH) {
      return NextResponse.json({ error: "A valid individual source comment is required." }, { status: 400 });
    }

    const { supabaseAdmin, callerId } = await requireCaller(token);
    const event = await requireCoachEventAccess(supabaseAdmin, callerId, eventId);
    if (event.event_type !== "training") return NextResponse.json({ error: "Training only" }, { status: 400 });
    if (!(await isCoachTrainingAssistanceEnabled(supabaseAdmin, event.club_id, callerId))) {
      return NextResponse.json({ error: "Training assistance is disabled for this coach." }, { status: 403 });
    }

    const attendeeRes = await supabaseAdmin
      .from("club_event_attendees")
      .select("player_id")
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (attendeeRes.error) throw new Error(attendeeRes.error.message);
    if (!attendeeRes.data) return NextResponse.json({ error: "Player is not part of this session." }, { status: 400 });

    const profileRes = await supabaseAdmin
      .from("profiles")
      .select("id,first_name,last_name")
      .eq("id", playerId)
      .maybeSingle();
    if (profileRes.error) throw new Error(profileRes.error.message);
    const displayName = `${profileRes.data?.first_name ?? ""} ${profileRes.data?.last_name ?? ""}`.trim();

    const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) return NextResponse.json({ error: "AI analysis is not configured." }, { status: 503 });

    const openAIRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_COACH_MODEL || "gpt-4o-mini",
        store: false,
        max_output_tokens: 1000,
        input: [
          {
            role: "system",
            content:
              audience === "private"
                ? `You assist a golf coach with one explicitly identified private coaching note. Rewrite only the supplied source into one concise internal note for authorized coaches, for that exact player_id. Preserve its meaning, but write both the text and rationale only in ${outputLanguage}. Use precise, respectful wording and do not infer or modify attendance, ActiviTee ratings, diagnoses, decisions, or facts. Never refer to or request any other player. The note must remain private. The coach will edit and explicitly apply the proposal; do not imply it has been saved.`
                : `You assist a golf coach with one explicitly identified player comment. Rewrite only the supplied source into one concise, constructive note that is suitable to be read by that junior and the coach, for that exact player_id. Preserve its meaning, but write both the text and rationale only in ${outputLanguage}. Use respectful, clear wording and do not infer or modify attendance, ActiviTee ratings, diagnoses, decisions, or facts. Never refer to or request any other player. The coach will edit and explicitly apply the proposal; do not imply it has been saved.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              player: { player_id: playerId, display_name: displayName },
              audience,
              output_language: outputLanguage,
              individual_source: sourceText,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "coach_single_player_note_proposal",
            strict: true,
            schema: {
              type: "object",
              properties: {
                player_id: { type: "string", enum: [playerId] },
                text: { type: "string" },
                rationale: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium"] },
              },
              required: ["player_id", "text", "rationale", "confidence"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const openAIJson = (await openAIRes.json().catch(() => ({}))) as OpenAIResponse & { error?: { message?: string } };
    if (!openAIRes.ok) {
      return NextResponse.json({ error: openAIJson.error?.message || "AI analysis failed." }, { status: 502 });
    }

    const parsed = JSON.parse(extractOutputText(openAIJson) || "{}") as Record<string, unknown>;
    const proposalText = String(parsed.text ?? "").trim();
    if (String(parsed.player_id ?? "") !== playerId || !proposalText || proposalText.length > COACH_PRIVATE_NOTE_MAX_LENGTH) {
      return NextResponse.json({ error: "AI returned an invalid player proposal." }, { status: 502 });
    }

    return NextResponse.json({
      proposal: {
        player_id: playerId,
        text: proposalText,
        rationale: String(parsed.rationale ?? "").trim(),
        confidence: parsed.confidence === "high" ? "high" : "medium",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const status = message === "forbidden" ? 403 : message === "event_not_found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
