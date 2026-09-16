/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { defaultEvaluationChoices, validateCriterionInput, type EvaluationCriterion, type EvaluationResponseFormat } from "@/lib/evaluationCriteria";

function mustEnv(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }

async function context(req: NextRequest, clubId: string) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return { error: "Missing token", status: 401 } as const;
  const db = createClient(mustEnv("NEXT_PUBLIC_SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const user = await db.auth.getUser(token);
  if (user.error || !user.data.user) return { error: "Invalid token", status: 401 } as const;
  const membership = await db.from("club_members").select("id").eq("club_id", clubId).eq("user_id", user.data.user.id).eq("role", "manager").eq("is_active", true).maybeSingle();
  if (!membership.data) return { error: "Forbidden", status: 403 } as const;
  return { db, userId: user.data.user.id } as const;
}

function updatePayload(body: any) {
  const responseFormat = String(body?.response_format ?? "scale_1_6") as EvaluationResponseFormat;
  const choices = Array.isArray(body?.choices_json) ? body.choices_json.map((choice: any) => ({ value: choice?.value, label: String(choice?.label ?? "").trim(), ...(choice?.icon ? { icon: String(choice.icon) } : {}) })).filter((choice: any) => choice.label) : [];
  const domainKey = String(body?.domain_key ?? "other").trim();
  const result = { name: String(body?.name ?? "").trim(), description: String(body?.description ?? "").trim() || null, respondent: String(body?.respondent ?? "coach"), response_format: responseFormat, choices_json: responseFormat === "short_text" ? [] : choices.length ? choices : defaultEvaluationChoices(responseFormat), activity_types: Array.from(new Set((Array.isArray(body?.activity_types) ? body.activity_types : []).map(String))), domain_key: domainKey, domain_label: String(body?.domain_label ?? "").trim() || domainKey, is_required: Boolean(body?.is_required), is_active: Boolean(body?.is_active), sort_order: Math.trunc(Number(body?.sort_order) || 0), updated_at: new Date().toISOString() };
  const errors = validateCriterionInput(result as Partial<EvaluationCriterion>);
  if (errors.length) throw new Error(errors.join(" "));
  return result;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ clubId: string; criterionId: string }> }) {
  try {
    const { clubId, criterionId } = await ctx.params;
    const auth = await context(req, clubId); if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const body = await req.json().catch(() => ({}));
    if (body?.action === "archive") {
      const result = await auth.db.from("club_evaluation_criteria").update({ is_active: false, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", criterionId).eq("club_id", clubId).select("*").single();
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
      return NextResponse.json({ criterion: result.data });
    }
    const result = await auth.db.from("club_evaluation_criteria").update(updatePayload(body)).eq("id", criterionId).eq("club_id", clubId).select("*").single();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    return NextResponse.json({ criterion: result.data });
  } catch (error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 400 }); }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ clubId: string; criterionId: string }> }) {
  try {
    const { clubId, criterionId } = await ctx.params;
    const auth = await context(req, clubId); if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const used = await auth.db.from("club_event_evaluation_criteria").select("id", { count: "exact", head: true }).eq("criterion_id", criterionId);
    if (used.error) return NextResponse.json({ error: used.error.message }, { status: 400 });
    if ((used.count ?? 0) > 0) return NextResponse.json({ error: "Ce critère a déjà été utilisé et doit être archivé." }, { status: 409 });
    const result = await auth.db.from("club_evaluation_criteria").delete().eq("id", criterionId).eq("club_id", clubId);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status: 500 }); }
}
