import assert from "node:assert/strict";
import test from "node:test";
import { cleanFamilyEmail, defaultFamilyMailConfig, familyAccessStatusLabel, renderFamilyTemplate } from "../lib/familyAccess.ts";

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
