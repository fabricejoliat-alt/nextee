import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCaller } from "@/app/api/messages/_lib";

const MAX_COMMENT_LENGTH = 1500;
const REQUEST_TIMEOUT_MS = 15_000;

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function responseText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const typed = part as { type?: unknown; text?: unknown };
      return typed.type === "output_text" && typeof typed.text === "string" ? typed.text : "";
    })
    .join("")
    .trim();
}

export async function POST(req: NextRequest) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Session manquante." }, { status: 401 });

    const { callerId } = await requireCaller(accessToken);
    const db = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const membership = await db
      .from("club_members")
      .select("id")
      .eq("user_id", callerId)
      .eq("is_active", true)
      .in("role", ["coach", "manager"])
      .limit(1);

    if (membership.error) return NextResponse.json({ error: membership.error.message }, { status: 400 });
    if (!membership.data?.length) return NextResponse.json({ error: "Accès réservé aux coachs." }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const text = String(body?.text ?? "").trim();
    const locale = String(body?.locale ?? "fr").toLowerCase() === "en" ? "en" : "fr";
    const audience = body?.audience === "coach" ? "coach" : "junior";
    if (!text) return NextResponse.json({ error: "Saisissez d’abord un commentaire." }, { status: 400 });
    if (text.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json({ error: `Le commentaire ne peut pas dépasser ${MAX_COMMENT_LENGTH} caractères.` }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "L’assistant IA n’est pas encore configuré." }, { status: 503 });
    }

    const language = locale === "en" ? "English" : "French";
    const rewriteInstructions =
      audience === "coach"
        ? `Rewrite a golf coach's private internal note in ${language}. Correct spelling and grammar, improve clarity, and keep the tone professional, factual, and concise. Preserve every factual detail. Do not add names, diagnoses, promises, scores, or facts. Return only the rewritten note, without a heading or quotation marks.`
        : `Rewrite a golf coach's feedback for a junior in ${language}. Correct spelling and grammar, improve clarity, and keep the tone warm, constructive, age-appropriate, and concise. Preserve every factual detail. Do not add names, diagnoses, promises, scores, or facts. Return only the rewritten feedback, without a heading or quotation marks.`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
        store: false,
        max_output_tokens: 300,
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text: rewriteInstructions,
              },
            ],
          },
          { role: "user", content: [{ type: "input_text", text }] },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const payload = await openAIResponse.json().catch(() => ({}));
    if (!openAIResponse.ok) {
      console.error("OpenAI comment improvement failed", { status: openAIResponse.status });
      return NextResponse.json({ error: "L’amélioration du commentaire a échoué. Réessayez dans un instant." }, { status: 502 });
    }

    const suggestion = responseText(payload);
    if (!suggestion) return NextResponse.json({ error: "Aucune suggestion n’a été générée." }, { status: 502 });
    return NextResponse.json({ suggestion });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return NextResponse.json({ error: "L’assistant IA met trop de temps à répondre." }, { status: 504 });
    }
    console.error("Coach AI comment route failed", cause instanceof Error ? cause.message : cause);
    return NextResponse.json({ error: "Impossible d’améliorer le commentaire." }, { status: 500 });
  }
}
