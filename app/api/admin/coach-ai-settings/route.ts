import { NextResponse } from "next/server";
import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";
import { loadCoachRewriteSettings } from "@/lib/server/coachAiRewriteSettings";
import { COACH_REWRITE_INSTRUCTIONS_MAX, DEFAULT_COACH_REWRITE_INSTRUCTIONS } from "@/lib/coachAiRewriteInstructions";

const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: legalNoStore });
export async function GET(req: Request) {
  try {
    const db = legalDb();
    if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    return reply({ ...await loadCoachRewriteSettings(db), default_instructions: DEFAULT_COACH_REWRITE_INSTRUCTIONS });
  } catch { return reply({ error: "Les consignes de reformulation sont indisponibles." }, 503); }
}

export const PUT = withAdminMutationAudit(async function PUT(req: Request) {
  try {
    const db = legalDb(); const admin = await legalAdmin(req, db);
    if (!admin) return reply({ error: "Forbidden" }, 403);
    const body = await req.json();
    const instructions = typeof body.instructions === "string" ? body.instructions.trim() : "";
    if (instructions.length < 20 || instructions.length > COACH_REWRITE_INSTRUCTIONS_MAX || !Number.isSafeInteger(body.revision) || body.revision < 1) {
      return reply({ error: `Saisissez des consignes de 20 à ${COACH_REWRITE_INSTRUCTIONS_MAX} caractères.` }, 400);
    }
    const result = await db.from("coach_ai_rewrite_settings").update({ instructions, revision: body.revision + 1, updated_at: new Date().toISOString(), updated_by: admin.id })
      .eq("singleton", true).eq("revision", body.revision).select("instructions,revision,updated_at").maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return reply({ error: "Les consignes ont été modifiées ailleurs. Rechargez la page avant de réessayer." }, 409);
    return reply(result.data);
  } catch { return reply({ error: "Enregistrement des consignes impossible." }, 503); }
});
