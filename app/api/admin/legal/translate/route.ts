import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { legalTranslationsMatch } from "@/lib/legalTemplate";
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
function outputText(payload: unknown) {
  const output = (payload as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> })?.output ?? [];
  return output.flatMap((v) => v.content ?? []).filter((v) => v.type === "output_text").map((v) => v.text ?? "").join("");
}
export async function POST(req: Request) {
  try {
    const db = legalDb(); const admin = await legalAdmin(req, db); if (!admin) return reply({ error: "Forbidden" }, 403);
    const input = await req.json(); const id = String(input.document_id ?? ""); const locale = String(input.locale ?? "");
    if (!["en","de","it"].includes(locale)) return reply({ error: "Invalid locale" }, 400);
    const draft = await db.from("legal_drafts").select("source_revision,translations,allowed_variables").eq("document_id", id).single();
    if (draft.error) throw draft.error;
    const source = draft.data.translations?.fr;
    if (!source?.title || !source?.body || source.source_revision !== draft.data.source_revision) return reply({ error: "French source incomplete" }, 409);
    if (JSON.stringify(source).length > 20_000) return reply({ error: "Source too long" }, 400);
    const key = process.env.OPENAI_API_KEY; if (!key) return reply({ error: "Translation unavailable" }, 503);
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini", store: false, max_output_tokens: 4000,
        input: [{ role: "developer", content: [{ type: "input_text", text: "Translate only this legal document template into the requested language. Preserve all placeholders in double braces verbatim. Do not add legal claims or facts. Return JSON only. This is an unapproved draft for human review." }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify({ locale, source: { title: source.title, body: source.body, action_label: source.action_label } }) }] }],
        text: { format: { type: "json_schema", name: "legal_translation", strict: true, schema: { type: "object", additionalProperties: false,
          required: ["title","body","action_label"], properties: { title: { type: "string" }, body: { type: "string" }, action_label: { type: "string" } } } } } }) });
    if (!response.ok) return reply({ error: "Translation failed" }, 502);
    const generated = JSON.parse(outputText(await response.json())) as { title: string; body: string; action_label: string };
    if (!legalTranslationsMatch(source, generated, draft.data.allowed_variables ?? []))
      return reply({ error: "Placeholder mismatch; translate manually" }, 409);
    const current = await db.from("legal_drafts").select("source_revision,translations").eq("document_id", id).single();
    if (current.error) throw current.error;
    if (current.data.source_revision !== draft.data.source_revision || JSON.stringify(current.data.translations?.fr) !== JSON.stringify(source))
      return reply({ error: "Source changed while translating" }, 409);
    const translations = { ...current.data.translations, [locale]: { ...generated, status: "proposed", source_revision: draft.data.source_revision } };
    const saved = await db.from("legal_drafts").update({ translations, updated_by: admin.id }).eq("document_id", id)
      .eq("source_revision", draft.data.source_revision).eq("translations", JSON.stringify(current.data.translations)).select("document_id");
    if (saved.error) throw saved.error;
    if (!saved.data?.length) return reply({ error: "Concurrent edit" }, 409);
    return reply({ proposed: true });
  } catch { return reply({ error: "Translation unavailable" }, 503); }
}
