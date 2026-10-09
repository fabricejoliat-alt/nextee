import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, requirePlatformAdmin } from "../_lib";

const MAX_SOURCE_LENGTH = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    return Array.isArray(content) ? content : [];
  }).map((part) => {
    if (!part || typeof part !== "object") return "";
    const value = part as { type?: unknown; text?: unknown };
    return value.type === "output_text" && typeof value.text === "string" ? value.text : "";
  }).join("").trim();
}

export const POST = withAdminMutationAudit(async function POST(req: NextRequest) {
  try {
    const database = createAdminClient();
    const auth = await requirePlatformAdmin(req, database);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => ({}));
    const source = {
      title: String(body?.title ?? "").trim(),
      summary: String(body?.summary ?? "").trim(),
      body: String(body?.body ?? "").trim(),
    };
    if (!source.title) return NextResponse.json({ error: "Renseigne d’abord le titre français." }, { status: 400 });
    if (source.title.length + source.summary.length + source.body.length > MAX_SOURCE_LENGTH) {
      return NextResponse.json({ error: "Le contenu à traduire est trop long." }, { status: 400 });
    }
    const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) return NextResponse.json({ error: "La traduction OpenAI n’est pas configurée." }, { status: 503 });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
        store: false,
        max_output_tokens: 4000,
        input: [
          { role: "developer", content: [{ type: "input_text", text: "Translate an ActiviTee golf-club news item from French into English, German and Italian. Preserve every fact, date, proper noun, URL, paragraph and any HTML markup exactly in structure. Do not add information. Use natural, professional language suitable for junior players, coaches and club managers. Return only the requested JSON." }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify({ source_language: "fr", target_languages: ["en", "de", "it"], source }) }] },
        ],
        text: { format: { type: "json_schema", name: "platform_news_translations", strict: true, schema: {
          type: "object", additionalProperties: false, required: ["en", "de", "it"], properties: {
            en: { $ref: "#/$defs/translation" }, de: { $ref: "#/$defs/translation" }, it: { $ref: "#/$defs/translation" },
          }, $defs: { translation: { type: "object", additionalProperties: false, required: ["title", "summary", "body"], properties: {
            title: { type: "string" }, summary: { type: "string" }, body: { type: "string" },
          } } },
        } } },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return NextResponse.json({ error: "La traduction OpenAI a échoué. Réessaie dans un instant." }, { status: 502 });
    const text = responseText(payload);
    if (!text) return NextResponse.json({ error: "OpenAI n’a retourné aucune traduction." }, { status: 502 });
    const translations = JSON.parse(text) as Record<string, { title: string; summary: string; body: string }>;
    return NextResponse.json({ translations });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return NextResponse.json({ error: "La traduction prend trop de temps." }, { status: 504 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Traduction impossible." }, { status: 500 });
  }
});
