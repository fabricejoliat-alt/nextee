const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li"]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeCampRichTextHtml(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  const withoutDangerousBlocks = raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|svg|math)[^>]*\/?>/gi, "");

  const sanitized = withoutDangerousBlocks
    .replace(/<([a-z0-9]+)(\s[^>]*)?>/gi, (_match, tagName) => {
      const tag = String(tagName ?? "").toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return "";
      return tag === "br" ? "<br>" : `<${tag}>`;
    })
    .replace(/<\/([a-z0-9]+)\s*>/gi, (_match, tagName) => {
      const tag = String(tagName ?? "").toLowerCase();
      if (!ALLOWED_TAGS.has(tag) || tag === "br") return "";
      return `</${tag}>`;
    });

  return sanitized
    .replace(/<(p|li)>\s*<\/\1>/gi, "")
    .replace(/(<br>\s*){3,}/gi, "<br><br>")
    .trim();
}

export function plainTextToCampRichTextHtml(input: string) {
  const raw = String(input ?? "");
  if (!raw.trim()) return "";
  return raw
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function normalizeCampRichTextHtml(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(raw);
  return sanitizeCampRichTextHtml(looksLikeHtml ? raw : plainTextToCampRichTextHtml(raw));
}
