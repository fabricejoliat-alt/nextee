/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { defaultEvaluationChoices, validateCriterionInput, type EvaluationCriterion, type EvaluationResponseFormat } from "@/lib/evaluationCriteria";

function mustEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

async function context(req: NextRequest, clubId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: "Missing token", status: 401 } as const;
  const db = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const user = await db.auth.getUser(token);
  if (user.error || !user.data.user) return { error: "Invalid token", status: 401 } as const;
  const membership = await db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", user.data.user.id).eq("role", "manager").eq("is_active", true).maybeSingle();
  if (membership.error) return { error: membership.error.message, status: 400 } as const;
  if (!membership.data) return { error: "Forbidden", status: 403 } as const;
  return { db, userId: user.data.user.id } as const;
}

function payload(body: any) {
  const responseFormat = String(body?.response_format ?? "scale_1_6") as EvaluationResponseFormat;
  const customChoices = Array.isArray(body?.choices_json)
    ? body.choices_json.map((choice: any) => ({ value: choice?.value, label: String(choice?.label ?? "").trim(), ...(choice?.icon ? { icon: String(choice.icon) } : {}) })).filter((choice: any) => choice.label)
    : [];
  const domainKey = String(body?.domain_key ?? "other").trim();
  const result = {
    name: String(body?.name ?? "").trim(),
    description: String(body?.description ?? "").trim() || null,
    respondent: String(body?.respondent ?? "coach"),
    response_format: responseFormat,
    choices_json: responseFormat === "short_text" ? [] : (customChoices.length ? customChoices : defaultEvaluationChoices(responseFormat)),
    activity_types: Array.from(new Set((Array.isArray(body?.activity_types) ? body.activity_types : []).map(String))),
    domain_key: domainKey,
    domain_label: String(body?.domain_label ?? "").trim() || domainKey,
    is_required: Boolean(body?.is_required),
    is_active: body?.is_active == null ? true : Boolean(body.is_active),
    sort_order: Number.isFinite(Number(body?.sort_order)) ? Math.trunc(Number(body.sort_order)) : 0,
  };
  const errors = validateCriterionInput(result as Partial<EvaluationCriterion>);
  if (errors.length) throw new Error(errors.join(" "));
  return result;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const auth = await context(req, clubId);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const rows = await auth.db.from("club_evaluation_criteria").select("*").eq("club_id", clubId).order("sort_order").order("created_at");
    if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 400 });
    const ids = (rows.data ?? []).map((row: any) => row.id);
    const used = ids.length ? await auth.db.from("club_event_evaluation_criteria").select("criterion_id").in("criterion_id", ids) : { data: [], error: null };
    if (used.error) return NextResponse.json({ error: used.error.message }, { status: 400 });
    const counts = new Map<string, number>();
    (used.data ?? []).forEach((row: any) => counts.set(row.criterion_id, (counts.get(row.criterion_id) ?? 0) + 1));
    return NextResponse.json({ criteria: (rows.data ?? []).map((row: any) => ({ ...row, used_count: counts.get(row.id) ?? 0 })) });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clubId: string }> }) {
  try {
    const { clubId } = await ctx.params;
    const auth = await context(req, clubId);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => ({}));
    const row = await auth.db.from("club_evaluation_criteria").insert({ club_id: clubId, created_by: auth.userId, ...payload(body) }).select("*").single();
    if (row.error) return NextResponse.json({ error: row.error.message }, { status: 400 });
    return NextResponse.json({ criterion: { ...row.data, used_count: 0 } }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 400 });
  }
}
