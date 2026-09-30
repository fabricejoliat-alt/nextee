import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/player/validations/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(
  new URL("../app/player/validations/PlayerValidations.module.css", import.meta.url),
  "utf8",
);

test("Player validations keeps page and sector headings white", () => {
  assert.match(page, /player-dashboard-bg \$\{styles\.page\}/);
  assert.match(styles, /\.page :global\(\.section-title\)\{color:#fff!important\}/);
  assert.match(styles, /\.page :global\(\.section-subtitle\)\{color:rgba\(255,255,255,\.88\)!important\}/);
  assert.match(styles, /\.page \.sectorHeading h2\{[^}]*color:#fff!important/);
  assert.match(styles, /\.page \.sectorHeading p\{[^}]*color:rgba\(255,255,255,\.8\)!important/);
  assert.match(styles, /\.cardBody h3\{[^}]*color:#35483b!important/);
});
