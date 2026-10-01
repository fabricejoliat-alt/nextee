import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import postcss from "postcss";

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const learning = readFileSync(
  new URL("../app/coach/CoachLearningCards.module.css", import.meta.url),
  "utf8",
);
const coachHome = readFileSync(new URL("../app/coach/page.tsx", import.meta.url), "utf8");

test("Coach workspace reuses the golf hero image with white page headings", () => {
  assert.match(globals, /\.coach-page-root \.coach-scroll-area\{[\s\S]*?url\("\/hero-golf\.png"\) center \/ cover fixed !important/);
  assert.match(globals, /\.coach-page-root \.coach-shell h1,[\s\S]*?color:#fff !important/);
  assert.match(globals, /\.coach-page-root \.coach-shell \[data-ui="breadcrumb"\][\s\S]*?color:#fff !important/);
  assert.match(globals, /\.coach-page-root \.coach-shell \.marketplace-page>\.glass-section:first-of-type:has\(\.marketplace-header\)[\s\S]*?background:transparent !important/);
  assert.match(globals, /\.marketplace-page>\.glass-section:first-of-type \.section-title\{[\s\S]*?color:#fff !important/);
  assert.match(learning, /\.sectionHeading h2\{[^}]*color:#fff!important/);
  assert.match(learning, /\.sectionHeading p\{[^}]*color:rgba\(255,255,255,\.82\)!important/);
});

test("every Coach breadcrumb has the stable marker, including shared rules and notification views", () => {
  const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    return entry.isDirectory() ? walk(file) : entry.name.endsWith(".tsx") ? [file] : [];
  });
  const files = [
    ...walk(new URL("../app/coach/", import.meta.url)),
    ...walk(new URL("../components/coach/", import.meta.url)),
    ...["rules/CoachRulesWorkspace", "notifications/NotificationsCenter", "notifications/NotificationSettings"].map((path) => new URL(`../components/${path}.tsx`, import.meta.url)),
  ];
  let breadcrumbs = 0;
  for (const file of files) {
    const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "nav") {
        const attrs = node.attributes.getText(source);
        if (/breadcrumb|Ariane/i.test(attrs)) {
          breadcrumbs++;
          const marker = node.attributes.properties.find((attr) => ts.isJsxAttribute(attr) && attr.name.getText(source) === "data-ui");
          assert.ok(marker && ts.isJsxAttribute(marker) && marker.initializer && ts.isStringLiteral(marker.initializer) && marker.initializer.text === "breadcrumb", file.pathname);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.equal(breadcrumbs, 18, "Update this inventory when adding a Coach breadcrumb");
});

test("Coach breadcrumb text and every descendant stay white independently of module hashes and locale", () => {
  const rules: postcss.Rule[] = [];
  postcss.parse(globals).walkRules((rule) => { if (rule.selector.includes('[data-ui="breadcrumb"]')) rules.push(rule); });
  const white = rules.find((rule) => rule.nodes.some((node) => node.type === "decl" && node.prop === "color"));
  assert.ok(white);
  assert.deepEqual(white.selectors, ['.coach-page-root .coach-shell [data-ui="breadcrumb"]', '.coach-page-root .coach-shell [data-ui="breadcrumb"] *']);
  const color = white.nodes.find((node) => node.type === "decl" && node.prop === "color");
  assert.ok(color?.type === "decl" && color.value === "#fff" && color.important);
  for (const rule of rules) {
    assert.ok(rule.selectors.every((selector) => selector.startsWith(".coach-page-root .coach-shell ")), "Do not recolor Manager/Admin breadcrumbs");
    assert.doesNotMatch(rule.selector, /class\*|aria-label/);
  }
  assert.ok(rules.some((rule) => rule.selector.endsWith("a:focus-visible")));
});

test("Coach access skeleton uses the hero background and a white shimmer", () => {
  assert.match(globals, /\.coach-page-root > \.role-guard-page-loading\{[\s\S]*?url\("\/hero-golf\.png"\) center \/ cover fixed/);
  assert.match(globals, /\.coach-page-root > \.role-guard-page-loading > \.card\{[\s\S]*?background:rgba\(255,255,255,\.1\) !important/);
  assert.match(globals, /\.coach-page-root > \.role-guard-page-loading \.role-guard-loading-line\{[\s\S]*?rgba\(255,255,255,\.62\)/);
});

test("Coach card titles stay dark on white surfaces", () => {
  assert.match(globals, /\.coach-page-root \.card-title\{color:#35483b !important/);
  assert.doesNotMatch(globals, /\.coach-page-root \.coach-shell h2\s*\{\s*color:#fff/);
});

test("Coach home previews exactly three upcoming activities", () => {
  assert.match(coachHome, /upcomingEvents \?\? \[\]\)\.slice\(0, 3\)/);
  assert.match(coachHome, /t\("coach.home.upcomingHint"\)/);
  assert.doesNotMatch(coachHome, /Vos cinq prochains rendez-vous\./);
});

test("Coach planning uses the Manager design-system surfaces, fields and action hierarchy", () => {
  for (const path of ["add/page.tsx", "[eventId]/edit/page.tsx"]) {
    const form = readFileSync(new URL(`../app/coach/groups/[id]/planning/${path}`, import.meta.url), "utf8");
    assert.match(form, /components\/admin\/AdminHomeStats\.module\.css/);
    assert.match(form, /components\/admin\/organizations\/OrganizationSettingsAdmin\.module\.css/);
    for (const className of ["quickPanel", "sectionHeading", "topline"]) assert.ok(form.includes(`layoutStyles.${className}`));
    for (const className of ["field", "backButton", "primaryButton", "secondaryButton", "dangerButton"]) assert.ok(form.includes(`actionStyles.${className}`));
    assert.doesNotMatch(form, /className="(?:glass-card|glass-section|cta-green[^\"]*|btn[^\"]*)"|player-dashboard-bg/);
    assert.match(form, /CoachListSkeleton/);
  }
  const formCss = readFileSync(new URL("../components/coach/CoachActivityForm.module.css", import.meta.url), "utf8");
  assert.match(formCss, /safe-area-inset-bottom/);
  assert.match(formCss, /@media\(max-width:700px\)/);
  assert.match(formCss, /\.row>button\{[^}]*flex:0 0 44px;[^}]*width:44px/);
  assert.match(formCss, /\.row>div:first-child\{[^}]*flex:1;min-width:0/);
});

test("Coach-wide controls preserve distinct actions, visible focus and disabled states", () => {
  assert.match(globals, /\.coach-shell\{\s*font-family: var\(--font-inter\)/);
  assert.match(globals, /\.coach-page-root \.coach-shell button:disabled\{[^}]*opacity:\.5/);
  assert.match(globals, /\.coach-page-root \.coach-shell :is\(button,a\):focus-visible\{[^}]*outline:2px solid/);
  assert.match(globals, /\.coach-page-root \.coach-shell :is\(button,a\[class\*="Button"\],a.btn,a.cta-green\)\{[^}]*min-height:44px/);
  assert.match(globals, /\.coach-page-root \.btn-danger,[\s\S]*?background:#fff0ef !important/);
});

test("Coach activity details keep named activities and compact coach actions visible", () => {
  const detail = readFileSync(new URL("../app/coach/groups/[id]/planning/[eventId]/page.tsx", import.meta.url), "utf8");
  const detailCss = readFileSync(new URL("../app/coach/groups/[id]/planning/[eventId]/CoachEventDetail.module.css", import.meta.url), "utf8");
  const calendar = readFileSync(new URL("../app/coach/calendar/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /return coachPlanningTitle\(event.title,/);
  assert.match(detail, /className=\{actionStyles.breadcrumb\}/);
  assert.match(calendar, /className=\{actionStyles.breadcrumb\}/);
  assert.doesNotMatch(detail, /user-mgmt-table/);
  assert.match(detail, /className=\{eventStyles.iconButton\} onClick=\{\(\) => addCoach\(coach.id\)\}/);
  assert.match(detailCss, /\.coachRow\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto;/);
});
