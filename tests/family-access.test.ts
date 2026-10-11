import assert from "node:assert/strict";
import test from "node:test";
import { currentFamilyAppLinks, familyMailAppUrl, cleanFamilyEmail, defaultFamilyMailConfig, familyAccessStatusLabel, renderFamilyTemplate } from "../lib/familyAccess.ts";

test("ignore les adresses techniques des comptes sans e-mail", () => {
  assert.equal(cleanFamilyEmail("member.123@noemail.local"), null);
  assert.equal(cleanFamilyEmail("parent@example.org"), "parent@example.org");
});

test("remplace les variables et les libellés de lien des modèles", () => {
  assert.equal(
    renderFamilyTemplate("Bonjour {{parent_name}}, {{reset_url:Définir le mot de passe}}", {
      parent_name: "Sophie Martin",
      reset_url: "https://example.org/reset",
    }),
    "Bonjour Sophie Martin, Définir le mot de passe: https://example.org/reset"
  );
});

test("fournit les cinq modèles opérationnels", () => {
  const config = defaultFamilyMailConfig();
  assert.ok(config.parent_subject);
  assert.ok(config.junior_direct_subject);
  assert.ok(config.junior_parent_subject);
  assert.ok(config.consent_subject);
  assert.ok(config.periodic_report_subject);
  assert.equal(familyAccessStatusLabel("expired"), "Expiré");
});


test("les liens d'application utilisent activitee.app et conservent les chemins", () => {
  assert.equal(familyMailAppUrl(), "https://activitee.app");
  assert.equal(familyMailAppUrl("http://localhost:3000", "https://www.activitee.golf/"), "https://activitee.app");
  assert.equal(familyMailAppUrl("https://test.example.org/path"), "https://test.example.org");
  assert.equal(currentFamilyAppLinks("Contact info@activitee.golf — https://www.activitee.golf/parent?child=123"), "Contact info@activitee.golf — https://activitee.app/parent?child=123");
  assert.equal(currentFamilyAppLinks("https://activitee.golf.example.org/"), "https://activitee.golf.example.org/");
});

test("un modèle personnalisé ancien est corrigé aussi lors du rendu", () => {
  assert.equal(renderFamilyTemplate("Bonjour {{parent_name}}, connexion https://activitee.golf/ — info@activitee.golf", { parent_name: "Sophie" }), "Bonjour Sophie, connexion https://activitee.app/ — info@activitee.golf");
});
