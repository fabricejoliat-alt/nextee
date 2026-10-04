import { legalTranslationReviewMatches } from "@/lib/legalTranslationReview";
import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";

const reply = (value: object, status = 200) => NextResponse.json(value, { status, headers: legalNoStore });
const roles = new Set(["player", "parent", "coach", "manager", "admin"]);
const locales = ["fr", "en", "de", "it"];

export async function GET(req: Request) {
  try {
    const db = legalDb();
    if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const [docs, drafts, versions, clubs] = await Promise.all([
      db.from("legal_documents").select("*").order("created_at", { ascending: false }),
      db.from("legal_drafts").select("*"),
      db.from("legal_versions").select("*").order("version_number", { ascending: false }),
      db.from("clubs").select("id,name").order("name", { ascending: true }),
    ]);
    if (docs.error || drafts.error || versions.error || clubs.error) throw new Error(docs.error?.message ?? drafts.error?.message ?? versions.error?.message ?? clubs.error?.message);
    return reply({ documents: docs.data, drafts: drafts.data, versions: versions.data, clubs: clubs.data });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "Unavailable" }, 503); }
}

export async function POST(req: Request) {
  try {
    const db = legalDb(); const actor = await legalAdmin(req, db);
    if (!actor) return reply({ error: "Forbidden" }, 403);
    const input = await req.json();
    if (input.operation === "create") {
      const key = String(input.key ?? "").trim();
      const kind = String(input.kind ?? "");
      const action = String(input.action ?? "");
      const scope = String(input.scope ?? "platform");
      const audience = Array.isArray(input.audience) ? input.audience.filter((r: unknown) => roles.has(String(r))) : [];
      if (!/^[a-z0-9_-]+$/.test(key) || !["terms","privacy","parent_authorization","specific_consent","junior_notice"].includes(kind)
        || !["accept","acknowledge","authorize","consent","read"].includes(action) || audience.length === 0
        || !["platform","club"].includes(scope) || (scope === "club" && !input.club_id)) return reply({ error: "Invalid document" }, 400);
      const created = await db.rpc("create_legal_document", {
        p_key: key, p_kind: kind, p_purpose: String(input.purpose_key ?? key), p_scope: scope,
        p_club: scope === "club" ? String(input.club_id) : null, p_roles: audience, p_action: action,
        p_required: Boolean(input.required), p_actor: actor.id,
      });
      if (created.error) return reply({ error: created.error.message }, 409);
      return reply({ id: created.data }, 201);
    }
    const documentId = String(input.document_id ?? "");
    const doc = await db.from("legal_documents").select("id,required_locales,active").eq("id", documentId).maybeSingle();
    if (doc.error || !doc.data) return reply({ error: "Document missing" }, 404);
    if (input.operation === "save_variables") {
      const variables = input.variables;
      if (!Array.isArray(variables) || variables.some((value: unknown) =>
        typeof value !== "string" || !["child_name", "club_name", "user_name"].includes(value)))
        return reply({ error: "Invalid variables" }, 400);
      const revision = Number(input.expected_revision);
      if (!Number.isInteger(revision) || revision < 1) return reply({ error: "Invalid revision" }, 400);
      const saved = await db.rpc("set_legal_draft_variables", {
        p_document: documentId, p_expected_revision: revision, p_variables: variables, p_actor: actor.id,
      });
      if (saved.error) return reply({ error: saved.error.message }, 409);
      return reply({ source_revision: saved.data });
    }
    if (input.operation === "save_translation") {
      const locale = String(input.locale ?? "");
      if (!locales.includes(locale)) return reply({ error: "Invalid locale" }, 400);
      const current = await db.from("legal_drafts").select("*").eq("document_id", documentId).single();
      if (current.error) throw current.error;
      if (Number(input.expected_revision) !== current.data.source_revision) return reply({ error: "Draft changed; reload" }, 409);
      const old = current.data.translations ?? {};
      const sourceRevision = locale === "fr" ? current.data.source_revision + 1 : current.data.source_revision;
      const translations: Record<string, unknown> = { ...old };
      if (locale === "fr") for (const lang of ["en","de","it"]) {
        if (translations[lang] && typeof translations[lang] === "object") translations[lang] = { ...translations[lang] as object, status: "needs_review" };
      }
      translations[locale] = { title: String(input.title ?? "").trim(), body: String(input.body ?? "").trim(),
        action_label: String(input.action_label ?? "").trim(), status: "needs_review", source_revision: sourceRevision };
      const saved = await db.from("legal_drafts").update({ translations, source_revision: sourceRevision, updated_by: actor.id,
        updated_at: new Date().toISOString() }).eq("document_id", documentId).eq("source_revision", current.data.source_revision).eq("translations", JSON.stringify(current.data.translations)).select("document_id");
      if (saved.error) throw saved.error;
      if (!saved.data?.length) return reply({ error: "Concurrent draft edit" }, 409);
      return reply({ source_revision: sourceRevision });
    }
    if (input.operation === "approve_translation") {
      const locale = String(input.locale ?? "");
      if (!locales.includes(locale)) return reply({ error: "Invalid locale" }, 400);
      const current = await db.from("legal_drafts").select("*").eq("document_id", documentId).single();
      if (current.error) throw current.error;
      const tr = current.data.translations?.[locale];
      if (!tr || Number(input.expected_revision) !== current.data.source_revision ||
        !legalTranslationReviewMatches(input.expected_translation, tr))
        return reply({ error: "Translation changed; reload and review" }, 409);
      if (!tr || tr.source_revision !== current.data.source_revision || !tr.title || !tr.body) return reply({ error: "Translation needs review" }, 409);
      const translations = { ...current.data.translations, [locale]: { ...tr, status: "approved", approved_by: actor.id, approved_at: new Date().toISOString() } };
      const saved = await db.from("legal_drafts").update({ translations, updated_by: actor.id }).eq("document_id", documentId)
        .eq("source_revision", current.data.source_revision).eq("translations", JSON.stringify(current.data.translations)).select("document_id");
      if (saved.error) throw saved.error;
      if (!saved.data?.length) return reply({ error: "Concurrent draft edit" }, 409);
      return reply({ ok: true });
    }
    if (input.operation === "summary") {
      const summary = String(input.summary ?? "").trim();
      if (!summary) return reply({ error: "Summary required" }, 400);
      const saved = await db.from("legal_drafts").update({ change_summary: summary, updated_by: actor.id }).eq("document_id", documentId);
      if (saved.error) throw saved.error;
      return reply({ ok: true });
    }
    if (input.operation === "review_rule") {
      const note = String(input.note ?? "").trim();
      const configuration = input.configuration;
      if (note.length < 20 || !configuration || typeof configuration !== "object" || configuration.status !== "approved")
        return reply({ error: "Reviewed rationale and approved configuration required" }, 400);
      const reviewed = await db.rpc("review_legal_applicability", { p_document: documentId, p_reviewer: actor.id,
        p_configuration: configuration, p_note: note });
      if (reviewed.error) return reply({ error: reviewed.error.message }, 409);
      return reply({ ok: true });
    }
    if (input.operation === "publish") {
      const expected = input.expected;
      if (!expected || typeof expected !== "object" || Array.isArray(expected))
        return reply({ error: "Publication review required" }, 400);
      const published = await db.rpc("publish_legal_draft_checked", {
        p_document_id: documentId, p_publisher: actor.id, p_expected: expected,
      });
      if (published.error) return reply({ error: published.error.message }, 409);
      return reply({ version_id: published.data });
    }
    return reply({ error: "Invalid operation" }, 400);
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "Unavailable" }, 503); }
}
