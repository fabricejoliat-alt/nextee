import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { NextRequest, NextResponse } from "next/server";
import { completeEtiquetteCard, etiquetteAccess, etiquetteFields } from "@/lib/server/etiquetteApi";

type Context = { params: Promise<{ cardVersionId: string }> };

export async function GET(req: NextRequest, context: Context) {
  try {
    const access = await etiquetteAccess(req);
    if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { cardVersionId } = await context.params;
    const version = await access.db.from("etiquette_card_versions").select(etiquetteFields).eq("id", cardVersionId).single();
    if (version.error) throw version.error;
    return NextResponse.json({ version: version.data });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to load card" }, { status: 500 });
  }
}

export const PATCH = withAdminMutationAudit(async function PATCH(req: NextRequest, context: Context) {
  try {
    const access = await etiquetteAccess(req);
    if (!access) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { cardVersionId } = await context.params;
    const current = await access.db.from("etiquette_card_versions").select("*").eq("id", cardVersionId).single();
    if (current.error) throw current.error;
    const body = await req.json().catch(() => ({}));
    if (body.action === "new_version") {
      const newest = await access.db.from("etiquette_card_versions").select("id,version").eq("card_id", current.data.card_id)
        .eq("locale", current.data.locale).order("version", { ascending: false }).limit(1).single();
      if (newest.error) throw newest.error;
      if (newest.data.id !== cardVersionId) return NextResponse.json({ error: "A newer version already exists" }, { status: 409 });
      const { id: _id, created_at: _created, approved_at: _approved, approved_by: _by, ...copy } = current.data;
      void _id; void _created; void _approved; void _by;
      const result = await access.db.from("etiquette_card_versions").insert({ ...copy, version: newest.data.version + 1,
        editorial_status: "needs_review", approved_at: null, approved_by: null }).select("id").single();
      if (result.error) throw result.error;
      return NextResponse.json({ cardVersionId: result.data.id });
    }
    if (current.data.approved_at) return NextResponse.json({ error: "Approved versions are locked" }, { status: 409 });
    if (body.action === "approve") {
      if (!completeEtiquetteCard(current.data)) return NextResponse.json({ error: "Complete all editorial fields before approval" }, { status: 409 });
      const result = await access.db.from("etiquette_card_versions").update({ editorial_status: "approved",
        approved_at: new Date().toISOString(), approved_by: access.userId }).eq("id", cardVersionId).is("approved_at", null)
        .select(etiquetteFields).single();
      if (result.error) throw result.error;
      return NextResponse.json({ version: result.data });
    }
    if (body.action !== "save") return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    const fields = ["title", "situation", "simple_explanation", "action_text", "common_mistake", "mission_text",
      "coach_tip", "official_reference", "reference_version", "image_alt"] as const;
    const values = Object.fromEntries(fields.map((field) => [field, String(body[field] ?? "").trim()]));
    if (!completeEtiquetteCard(values)) return NextResponse.json({ error: "Complete all editorial fields" }, { status: 400 });
    const kind = String(body.reference_kind ?? "good_practice");
    if (!["rule", "code", "club_guidance", "good_practice"].includes(kind)) return NextResponse.json({ error: "Invalid reference kind" }, { status: 400 });
    const result = await access.db.from("etiquette_card_versions").update({ ...values, reference_kind: kind,
      image_url: String(body.image_url ?? "").trim() || null, editorial_status: "needs_review" })
      .eq("id", cardVersionId).is("approved_at", null).select(etiquetteFields).single();
    if (result.error) throw result.error;
    return NextResponse.json({ version: result.data });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Unable to update card" }, { status: 500 });
  }
});
