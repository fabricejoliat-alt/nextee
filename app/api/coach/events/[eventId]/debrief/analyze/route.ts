import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
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

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });
    const { eventId: rawEventId } = await ctx.params;
    const eventId = String(rawEventId ?? "").trim();
    if (!eventId) return NextResponse.json({ error: "Missing eventId" }, { status: 400 });

    const { supabaseAdmin, callerId } = await requireCaller(token);
    const event = await requireCoachEventAccess(supabaseAdmin, callerId, eventId);
    if (event.event_type !== "training") return NextResponse.json({ error: "Training only" }, { status: 400 });
    if (!(await isCoachTrainingAssistanceEnabled(supabaseAdmin, event.club_id))) {
      return NextResponse.json({ error: "Training assistance is disabled for this organization." }, { status: 403 });
    }

    const [debriefRes, attendeesRes] = await Promise.all([
      supabaseAdmin
        .from("coach_training_debriefs")
        .select("id,report_text,report_scope,report_version")
        .eq("event_id", eventId)
        .maybeSingle(),
      supabaseAdmin
        .from("club_event_attendees")
        .select("player_id,coach_recorded_status")
        .eq("event_id", eventId),
    ]);
    if (debriefRes.error) throw new Error(debriefRes.error.message);
    if (attendeesRes.error) throw new Error(attendeesRes.error.message);
    const reportText = String(debriefRes.data?.report_text ?? "").trim();
    if (!reportText) return NextResponse.json({ error: "A session report is required before AI analysis." }, { status: 400 });

    const presentIds = (attendeesRes.data ?? [])
      .filter((row: { coach_recorded_status: string | null }) => row.coach_recorded_status === "present")
      .map((row: { player_id: string }) => row.player_id);
    if (presentIds.length === 0) return NextResponse.json({ error: "No present player to analyze." }, { status: 400 });

    const profilesRes = await supabaseAdmin
      .from("profiles")
      .select("id,first_name,last_name")
      .in("id", presentIds);
    if (profilesRes.error) throw new Error(profilesRes.error.message);
    const players = (profilesRes.data ?? []).map((profile: { id: string; first_name: string | null; last_name: string | null }) => ({
      player_id: profile.id,
      display_name: `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim(),
    }));

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
        max_output_tokens: 3500,
        input: [
          {
            role: "system",
            content:
              "You assist a golf coach. Extract only concrete individual observations from a hot debrief that may contain collective context, individual remarks, or both. Preserve collective context for interpretation but never turn a purely collective statement into an individual note. Use only the provided present-player IDs. If attribution is ambiguous, omit the proposal. Never make decisions, ratings, diagnoses, or invented facts. Write concise private coaching notes in the report language.",
          },
          {
            role: "user",
            content: JSON.stringify({
              report_scope: debriefRes.data?.report_scope ?? "mixed",
              present_players: players,
              session_report: reportText,
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "coach_private_note_proposals",
            strict: true,
            schema: {
              type: "object",
              properties: {
                proposals: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      player_id: { type: "string", enum: presentIds },
                      text: { type: "string" },
                      rationale: { type: "string" },
                      confidence: { type: "string", enum: ["high", "medium"] },
                    },
                    required: ["player_id", "text", "rationale", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["proposals"],
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

    const outputText = extractOutputText(openAIJson);
    const parsed = JSON.parse(outputText || "{}") as {
      proposals?: Array<{ player_id?: string; text?: string; rationale?: string; confidence?: string }>;
    };
    const presentSet = new Set(presentIds);
    const proposals = (parsed.proposals ?? [])
      .map((proposal) => ({
        player_id: String(proposal.player_id ?? "").trim(),
        text: String(proposal.text ?? "").trim(),
        rationale: String(proposal.rationale ?? "").trim(),
        confidence: proposal.confidence === "high" ? "high" : "medium",
      }))
      .filter((proposal) => presentSet.has(proposal.player_id) && proposal.text.length > 0 && proposal.text.length <= 4000);

    return NextResponse.json({ proposals, reportVersion: Number(debriefRes.data?.report_version ?? 0) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const status = message === "forbidden" ? 403 : message === "event_not_found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
