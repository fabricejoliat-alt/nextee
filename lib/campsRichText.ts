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

  const normalizedInlineStyles = withoutDangerousBlocks
    .replace(/<span\b[^>]*style=(['"])([^'"]*)\1[^>]*>([\s\S]*?)<\/span>/gi, (_match, _quote, styleValue, inner) => {
      const style = String(styleValue ?? "").toLowerCase();
      if (style.includes("text-decoration") && style.includes("underline")) {
        return `<u>${inner}</u>`;
      }
      return String(inner ?? "");
    });

  const sanitized = normalizedInlineStyles
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

function applyInlineFormatting(input: string) {
  return escapeHtml(input)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\+\+(.+?)\+\+/g, "<u>$1</u>");
}

export function campEditorTextToHtml(input: string) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  const html = raw
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trimRight());
      const bulletLines = lines.filter((line) => line.trim().startsWith("- "));
      const orderedLines = lines.filter((line) => /^\d+\.\s+/.test(line.trim()));

      if (bulletLines.length === lines.length && bulletLines.length > 0) {
        return `<ul>${bulletLines.map((line) => `<li>${applyInlineFormatting(line.trim().slice(2))}</li>`).join("")}</ul>`;
      }
      if (orderedLines.length === lines.length && orderedLines.length > 0) {
        return `<ol>${orderedLines.map((line) => `<li>${applyInlineFormatting(line.trim().replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
      }
      return `<p>${lines.map((line) => applyInlineFormatting(line)).join("<br>")}</p>`;
    })
    .join("");

  return sanitizeCampRichTextHtml(html);
}

export function campHtmlToEditorText(input: string) {
  const raw = normalizeCampRichTextHtml(input);
  if (!raw) return "";

  return raw
    .replace(/<ul>([\s\S]*?)<\/ul>/gi, (_match, inner) => {
      const items = String(inner)
        .replace(/<\/li>\s*<li>/gi, "\n- ")
        .replace(/<li>/gi, "- ")
        .replace(/<\/li>/gi, "");
      return `${items}\n\n`;
    })
    .replace(/<ol>([\s\S]*?)<\/ol>/gi, (_match, inner) => {
      let index = 0;
      return `${String(inner).replace(/<li>([\s\S]*?)<\/li>/gi, (_itemMatch, itemInner) => {
        index += 1;
        return `${index}. ${itemInner}\n`;
      })}\n`;
    })
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<u>([\s\S]*?)<\/u>/gi, "++$1++")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p>/gi, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
