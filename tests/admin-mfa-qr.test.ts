import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeMfaQrDataUrl } from "../lib/mfaQr.ts";

const require = createRequire(import.meta.url);
const Image = require("next/image").default;
// Synthetic image, with no authentication credential or real QR payload.
const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20" fill="#000" /><text>50%?</text></svg>\n';
const props = { unoptimized: true, width: 200, height: 200, alt: "Test QR" };

test("Supabase SVG renders in Next Image despite newlines and URL-reserved characters", () => {
  const raw = `data:image/svg+xml;utf-8,${svg}`;
  assert.throws(() => renderToStaticMarkup(createElement(Image, { ...props, src: raw })), /cannot end with a space or control character/);

  const normalized = normalizeMfaQrDataUrl(raw);
  assert.equal(decodeURIComponent(normalized.slice(normalized.indexOf(",") + 1)), svg);
  assert.doesNotMatch(normalized, /[\s#<>]/);
  const html = renderToStaticMarkup(createElement(Image, { ...props, src: normalized }));
  assert.ok(html.includes(normalized));
  assert.ok(!html.includes("/_next/image"));
});

test("already encoded and base64 SVGs remain valid without double encoding", () => {
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const base64 = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  for (const src of [encoded, base64]) {
    assert.equal(normalizeMfaQrDataUrl(src), src);
    assert.doesNotThrow(() => renderToStaticMarkup(createElement(Image, { ...props, src })));
  }
});
