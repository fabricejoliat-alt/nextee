import { coachComponentHarness, flush } from "./coachComponentHarness.ts";
import { checklistChild, checklistDoc } from "./legalChecklistFixtures.ts";

export async function legalPageFixture() {
  const previous = { document: globalThis.document, window: globalThis.window, HTMLButtonElement: globalThis.HTMLButtonElement };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {}, body: { style: { overflow: "" } }, activeElement: null } as unknown as Document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} } as unknown as Window & typeof globalThis;
  globalThis.HTMLButtonElement = class {} as typeof HTMLButtonElement;
  const docs = [checklistDoc("Conditions ActiviTee", null, "terms"), ...["A", "B"].flatMap(club => [
    checklistDoc(`authorization-${club}`, club, "parent_authorization"), checklistDoc(`consent-${club}`, club)])];
  docs.filter(doc => doc.kind === "specific_consent").forEach(doc => { doc.purpose_key = "coaching.ai"; });
  docs.forEach(doc => { doc.version!.snapshot.translations!.fr.title = doc.kind === "terms" ? "Conditions d’utilisation d’ActiviTee"
    : doc.kind === "parent_authorization" ? "Autorisation d’utilisation pour {{child_name}}" : "Utilisation de l’assistance IA"; });
  const children = [checklistChild("one", "A"), checklistChild("two", "A"), checklistChild("one", "B")];
  children.forEach(child => { child.representation_verified = false; child.can_decide = true; });
  children[1].states = children[1].states.filter(state => state.document_id !== "consent-A");
  let beneficiary = ""; let documentId = "";
  const decisions: object[] = [];
  const h = coachComponentHarness("app/legal/my/page.tsx", {
    modules: {
      "./MyLegalPage.module.css": { __esModule: true, default: new Proxy({}, { get: (_object, key) => String(key) }) },
      "@/components/legal/DeleteAccountLink": { __esModule: true, default: "delete-account-link" },
      "@/lib/supabaseClient": { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "fixture-token" } } }) } } },
    },
    fetch: async (input, init) => {
      const path = String(input);
      if (path === "/api/legal/documents") return Response.json({ documents: docs });
      if (path.startsWith("/api/legal/history")) return Response.json({ decisions: [] });
      if (path === "/api/legal/children") return Response.json({ children, parent_confirmation: { email_ready: true, delivery_ready: false, code_required: false } });
      if (path === "/api/legal/status") return Response.json({ enforcement_enabled: true, missing: [], organization_missing: [], organizations: [] });
      if (path === "/api/auth/redirect") return Response.json({ redirectTo: "/player" });
      const body = JSON.parse(String(init?.body));
      if (path === "/api/legal/present") {
        beneficiary = body.beneficiary_id; documentId = body.document_id;
        return Response.json({ presentation: { id: "presentation", expires_at: "2099-01-01", rendered_snapshot: {
          title: "Consentement à l’assistance IA", body: "Document de démonstration pour vérifier le parcours.", action_label: "Accepter", version_number: 1, locale: "fr" } } });
      }
      if (path === "/api/legal/decide") {
        decisions.push({ ...body, beneficiary, documentId });
        const child = children.find(child => child.child_id === beneficiary && child.club_id === "A")!;
        child.states.push({ document_id: documentId, version_id: `v-${documentId}`, decision: body.decision, conflict: false });
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected fixture request ${path}`);
    },
  });
  let tree = h.render();
  for (let i = 0; i < 3; i++) { await flush(); tree = h.render(); }
  return { h, tree, docs, children, decisions, cleanup() {
    h.cleanup(); globalThis.document = previous.document; globalThis.window = previous.window; globalThis.HTMLButtonElement = previous.HTMLButtonElement;
  } };
}
