import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import postcss from "postcss";

const source = readFileSync(new URL("../components/notifications/NotificationSettings.tsx", import.meta.url), "utf8");
const css = postcss.parse(readFileSync(new URL("../components/notifications/NotificationSettings.module.css", import.meta.url), "utf8"));
type Element = { type: string; props: Record<string, unknown> };
type ToggleProps = { checked: boolean; disabled: boolean; label: string; onToggle: (checked: boolean) => void };

// Exercise the actual stateless renderer without mounting preferences or making IO.
const ast = ts.createSourceFile("NotificationSettings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const toggle = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "Toggle");
assert.ok(toggle);
const compiled = ts.transpileModule(`${toggle.getText(ast)}\nexport { Toggle };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const toggleExports: { Toggle?: (props: ToggleProps) => Element } = {};
const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
new Function("require", "exports", "styles", compiled)(
  (name: string) => { assert.equal(name, "react/jsx-runtime"); return { jsx, jsxs: jsx }; },
  toggleExports,
  { toggle: "toggle", toggleChecked: "toggleChecked", toggleTrack: "toggleTrack", toggleThumb: "toggleThumb" },
);

function declarations(selector: string) {
  const result: Record<string, string> = {};
  css.walkRules((rule) => {
    if (rule.parent?.type === "root" && rule.selector === selector) rule.walkDecls((decl) => { result[decl.prop] = decl.value; });
  });
  return result;
}

test("notification switches preserve their native semantics, label and state in both positions", () => {
  for (const checked of [false, true]) {
    const changes: boolean[] = [];
    const button = toggleExports.Toggle!({ checked, disabled: false, label: "Notifications dans ActiviTee", onToggle: (next) => changes.push(next) });
    assert.equal(button.type, "button");
    assert.equal(button.props.type, "button");
    assert.equal(button.props.role, "switch");
    assert.equal(button.props["aria-label"], "Notifications dans ActiviTee");
    assert.equal(button.props["aria-checked"], checked);
    assert.equal(button.props.disabled, false);
    const track = button.props.children as Element;
    assert.equal(track.type, "span");
    assert.equal(track.props.className, "toggleTrack");
    assert.equal(track.props["aria-hidden"], "true");
    assert.equal((track.props.children as Element).props.className, "toggleThumb");
    (button.props.onClick as () => void)();
    assert.deepEqual(changes, [!checked]);
    assert.equal(toggleExports.Toggle!({ checked, disabled: true, label: "Notifications push", onToggle: () => {} }).props.disabled, true);
  }
});

test("Coach minimum button dimensions cannot turn the Manager notification switch into a circle", () => {
  const button = declarations(".toggle");
  assert.equal(button.width, "44px");
  assert.equal(button.height, "44px");
  assert.equal(button.background, "transparent");
  assert.equal(button["place-items"], "center");
  const track = declarations(".toggleTrack");
  assert.equal(track.width, "42px");
  assert.equal(track.height, "24px");
  assert.equal(track["box-sizing"], "border-box");
  assert.equal(declarations(".toggleThumb").width, "18px");
  assert.equal(declarations(".toggleThumb").height, "18px");
  assert.equal(declarations(".toggleChecked .toggleTrack").background, "var(--primary)");
  assert.equal(declarations(".toggleChecked .toggleThumb").transform, "translateX(18px)");
  assert.equal(declarations(".toggle:focus-visible").outline, "2px solid #899d7d");
  assert.ok(css.nodes.some((node) => node.type === "atrule" && node.params === "(prefers-reduced-motion: reduce)"));
});
