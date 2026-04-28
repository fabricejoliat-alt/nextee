import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/app/api/validations/_lib";

function normalizeOptionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeOptionalNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ exerciseId: string }> }
) {
  try {
    const accessToken = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!accessToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const { exerciseId } = await ctx.params;
    const id = String(exerciseId ?? "").trim();
    if (!id) return NextResponse.json({ error: "Missing exercise id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const payload = {
      name: String(body?.name ?? "").trim(),
      level: normalizeOptionalNumber(body?.level),
      objective: normalizeOptionalText(body?.objective),
      short_description: normalizeOptionalText(body?.short_description),
      detailed_description: normalizeOptionalText(body?.detailed_description),
      equipment: normalizeOptionalText(body?.equipment),
      validation_rule_text: normalizeOptionalText(body?.validation_rule_text),
      illustration_url: normalizeOptionalText(body?.illustration_url),
      is_active: Boolean(body?.is_active ?? true),
      updated_at: new Date().toISOString(),
    };

    if (!payload.name) {
      return NextResponse.json({ error: "Le nom est requis." }, { status: 400 });
    }

    const { supabaseAdmin } = await requireSuperAdmin(accessToken);
    const updateRes = await supabaseAdmin
      .from("validation_exercises")
      .update(payload)
      .eq("id", id)
      .select("id,section_id,external_code,sequence_no,level,name,objective,short_description,detailed_description,equipment,validation_rule_text,illustration_url,is_active,created_at,updated_at")
      .single();

    if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, exercise: updateRes.data });
  } catch (error: unknown) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status ?? 500) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Server error" }, { status });
  }
}
