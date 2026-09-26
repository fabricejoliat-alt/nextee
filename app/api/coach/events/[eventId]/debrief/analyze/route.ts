import { NextResponse, type NextRequest } from "next/server";
import { requireCaller } from "@/app/api/messages/_lib";
import { requireCoachEventAccess } from "@/app/api/coach/events/_access";
import {
  hasAnalyzableDebriefSource,
  normalizeCoachDebriefAnalysis,
  type CoachIndividualComments,
  type CoachReportScope,
} from "@/lib/coachDebrief";
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
    if (!(await isCoachTrainingAssistanceEnabled(supabaseAdmin, event.club_id, callerId))) {
      return NextResponse.json({ error: "Training assistance is disabled for this coach." }, { status: 403 });
    }

    const [debriefRes, attendeesRes] = await Promise.all([
      supabaseAdmin
        .from("coach_training_debriefs")
        .select("id,report_text,report_scope,individual_comments,report_version")
        .eq("event_id", eventId)
        .maybeSingle(),
      supabaseAdmin
        .from("club_event_attendees")
        .select("player_id,coach_recorded_status")
        .eq("event_id", eventId),
    ]);
    if (debriefRes.error) throw new Error(debriefRes.error.message);
    if (attendeesRes.error) throw new Error(attendeesRes.error.message);
    const presentIds = (attendeesRes.data ?? [])
      .filter((row: { coach_recorded_status: string | null }) => row.coach_recorded_status === "present")
      .map((row: { player_id: string }) => row.player_id);
    const reportScope: CoachReportScope = debriefRes.data?.report_scope === "individual" ? "individual" : "collective";
    const reportText = String(debriefRes.data?.report_text ?? "").trim();
    const individualComments = (
      debriefRes.data?.individual_comments && typeof debriefRes.data.individual_comments === "object"
        ? debriefRes.data.individual_comments
        : {}
    ) as CoachIndividualComments;
    if (!hasAnalyzableDebriefSource(reportScope, reportText, individualComments, presentIds)) {
      return NextResponse.json({ error: "A source comment is required before AI analysis." }, { status: 400 });
    }

    const profilesRes = presentIds.length
      ? await supabaseAdmin.from("profiles").select("id,first_name,last_name").in("id", presentIds)
      : { data: [], error: null };
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
              "You assist a golf coach while the coach remains the final editor. Never infer or modify attendance or ActiviTee ratings. In collective mode, produce a faithful, structured collective session summary from the source without inventing facts, and separately extract private-note proposals only for concrete observations clearly attributable to a named present player. If attribution is ambiguous, omit it. In individual mode, each source comment is already assigned to one present player: keep that exact assignment and propose at most one concise private coaching note per non-empty comment. Never diagnose, decide, or add facts. Use only the provided player IDs and write in the source language. The original source remains separate and must never be rewritten in place.",
          },
          {
            role: "user",
            content: JSON.stringify({
              report_scope: reportScope,
              present_players: players,
              collective_source: reportScope === "collective" ? reportText : null,
              individual_sources:
                reportScope === "individual"
                  ? players
                      .map((player) => ({
                        player_id: player.player_id,
                        comment: String(individualComments[player.player_id] ?? "").trim(),
                      }))
                      .filter((item) => item.comment)
                  : [],
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "coach_debrief_proposals",
            strict: true,
            schema: {
              type: "object",
              properties: {
                collective_summary: { type: "string" },
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
              required: ["collective_summary", "proposals"],
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
    const analysis = normalizeCoachDebriefAnalysis(JSON.parse(outputText || "{}"), reportScope, presentIds);

    return NextResponse.json({
      reportScope,
      collectiveSummary: analysis.collectiveSummary,
      proposals: analysis.proposals,
      reportVersion: Number(debriefRes.data?.report_version ?? 0),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const status = message === "forbidden" ? 403 : message === "event_not_found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
