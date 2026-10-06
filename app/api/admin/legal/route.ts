import { legalTranslationReviewMatches } from "@/lib/legalTranslationReview";
import { sharedClubPurposeLabels } from "@/lib/legalAdminGroups";
import { NextResponse } from "next/server";
import { legalAdmin, legalDb, legalNoStore } from "@/lib/server/legalAccess";

const reply = (value: object, status = 200) => NextResponse.json(value, { status, headers: legalNoStore });
const roles = new Set(["player", "parent", "coach", "manager", "admin"]);
const locales = ["fr", "en", "de", "it"];

export async function GET(req: Request) {
  try {
    const db = legalDb();
    if (!await legalAdmin(req, db)) return reply({ error: "Forbidden" }, 403);
    const [docs, drafts, versions, clubs, control] = await Promise.all([
      db.from("legal_documents").select("*").order("created_at", { ascending: false }),
      db.from("legal_drafts").select("*"),
      db.from("legal_versions").select("*").order("version_number", { ascending: false }),
      db.from("clubs").select("id,name").order("name", { ascending: true }),
      db.from("legal_enforcement_control").select("enabled,updated_at").eq("singleton", true).single(),
    ]);
    if (docs.error || drafts.error || versions.error || clubs.error || control.error)
      throw new Error(docs.error?.message ?? drafts.error?.message ?? versions.error?.message ?? clubs.error?.message ?? control.error?.message);
    return reply({ documents: docs.data, drafts: drafts.data, versions: versions.data,
      clubs: clubs.data, enforcement_enabled: control.data.enabled });
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
    if (input.operation === "set_enforcement") {
      if (typeof input.enabled !== "boolean" || typeof input.expected_enabled !== "boolean")
        return reply({ error: "Expected activation state required" }, 400);
      const changed = await db.rpc("set_legal_activation", {
        p_target: "enforcement", p_document: null, p_enabled: input.enabled,
        p_expected: input.expected_enabled, p_expected_version: null, p_actor: actor.id,
      });
      if (changed.error) return reply({ error: changed.error.message }, 409);
      return reply({ ok: true });
    }
    const documentId = String(input.document_id ?? "");
    const doc = await db.from("legal_documents").select("id,document_key,purpose_key,scope,required_locales,active").eq("id", documentId).maybeSingle();
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
      const groupPurpose = input.group_purpose == null ? null : String(input.group_purpose);
      let expected: Record<string, unknown>;
      if (groupPurpose) {
        if (!Object.hasOwn(sharedClubPurposeLabels, groupPurpose) || doc.data.scope !== "club"
          || !doc.data.document_key.startsWith("activitee_") || doc.data.purpose_key !== groupPurpose
          || !input.expected_drafts || typeof input.expected_drafts !== "object" || Array.isArray(input.expected_drafts))
          return reply({ error: "Invalid shared draft" }, 400);
        expected = input.expected_drafts;
        const selected = expected[documentId] as { source_revision?: number } | undefined;
        if (!selected || selected.source_revision !== Number(input.expected_revision))
          return reply({ error: "Draft changed; reload" }, 409);
      } else {
        const current = await db.from("legal_drafts").select("source_revision,translations").eq("document_id", documentId).single();
        if (current.error) throw current.error;
        if (Number(input.expected_revision) !== current.data.source_revision) return reply({ error: "Draft changed; reload" }, 409);
        expected = { [documentId]: { source_revision: current.data.source_revision, translations: current.data.translations } };
      }
      const saved = await db.rpc("save_legal_draft_text_checked", {
        p_expected: expected, p_group_purpose: groupPurpose, p_locale: locale,
        p_title: String(input.title ?? ""), p_body: String(input.body ?? ""),
        p_action_label: String(input.action_label ?? ""), p_actor: actor.id,
      });
      if (saved.error) return reply({ error: saved.error.message }, 409);
      return reply({ source_revision: saved.data?.[documentId], updated_documents: Object.keys(saved.data ?? {}).length });
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
      const saved = await db.rpc("approve_legal_draft_translation_checked", {
        p_document: documentId, p_locale: locale, p_expected: input.expected_translation, p_actor: actor.id,
      });
      if (saved.error) return reply({ error: saved.error.message }, 409);
      return reply({ ok: true });
    }
    if (input.operation === "summary") {
      const summary = String(input.summary ?? "").trim();
      if (!summary) return reply({ error: "Summary required" }, 400);
      const saved = await db.from("legal_drafts").update({ change_summary: summary, updated_by: actor.id }).eq("document_id", documentId);
      if (saved.error) throw saved.error;
      return reply({ ok: true });
    }
    if (input.operation === "configure_audience") {
      if (!input.expected || typeof input.expected !== "object" || Array.isArray(input.expected))
        return reply({ error: "Expected audience required" }, 400);
      const configured = await db.rpc("configure_legal_audience", {
        p_document: documentId, p_expected: input.expected, p_actor: actor.id,
      });
      if (configured.error) return reply({ error: configured.error.message }, 409);
      return reply({ ok: true });
    }
    if (input.operation === "set_document_active") {
      if (typeof input.enabled !== "boolean" || typeof input.expected_enabled !== "boolean")
        return reply({ error: "Expected activation state required" }, 400);
      const changed = await db.rpc("set_legal_activation", {
        p_target: "document", p_document: documentId, p_enabled: input.enabled,
        p_expected: input.expected_enabled, p_expected_version: input.expected_version ?? null, p_actor: actor.id,
      });
      if (changed.error) return reply({ error: changed.error.message }, 409);
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
