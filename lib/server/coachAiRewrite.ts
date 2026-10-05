import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type Identity = { first_name?: string | null; last_name?: string | null };

/** Local minimisation, not anonymisation or detection of every person's name. */
export function redactCoachRewriteText(source: string, identity: Identity) {
  const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr-CH");
  const parts = [identity.first_name, identity.last_name].filter((s): s is string => Boolean(s?.trim()));
  const names = [...new Set(parts.flatMap(s => [s.trim(), ...s.split(/[\s'’\-‐‑–]+/u).filter(p => p.length > 1)]).map(fold))]
    .sort((a, b) => b.length - a.length);
  let text = source.normalize("NFC")
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, "[identifiant]")
    .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, "[courriel]")
    .replace(/https?:\/\/[^\s<>]+/gi, "[lien]")
    .replace(/(?<!\d)(?:\+|00)?\d[\d ()\u00a0.-]{7,}\d(?!\d)/g, "[numero]")
    .trim();
  for (const name of names) {
    // Preserve the accents and UTF-16 positions of text outside the matches.
    const starts: number[] = [], ends: number[] = [];
    let folded = "", offset = 0;
    for (const char of text) {
      const value = fold(char);
      for (let i = 0; i < value.length; i++) { starts.push(offset); ends.push(offset + char.length); }
      folded += value; offset += char.length;
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = [...folded.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"))];
    for (const match of matches.reverse()) {
      const start = starts[match.index], end = ends[match.index + match[0].length - 1];
      text = text.slice(0, start) + "[joueur]" + text.slice(end);
    }
  }
  return text;
}

export type RewriteReviewContext = {
  actor: string; event: string; player: string; audience: string; language: string;
  source: string; redacted: string; grant: string;
};

function signature(context: RewriteReviewContext, expires: number, secret: string) {
  if (!secret) throw new Error("AI preview unavailable");
  const digest = createHash("sha256").update(JSON.stringify(context)).digest("hex");
  return createHmac("sha256", secret).update(JSON.stringify(["coach-rewrite-review-v1", expires, digest])).digest("hex");
}

export function createRewriteReview(context: RewriteReviewContext, secret: string, now = Date.now()) {
  const expires = now + 5 * 60_000;
  return { expires, signature: signature(context, expires, secret) };
}

export function validRewriteReview(value: unknown, context: RewriteReviewContext, secret: string, now = Date.now()) {
  const review = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (typeof review.expires !== "number" || !Number.isSafeInteger(review.expires)
    || review.expires <= now || review.expires > now + 5 * 60_000
    || typeof review.signature !== "string" || !/^[a-f0-9]{64}$/.test(review.signature) || !secret) return false;
  return timingSafeEqual(Buffer.from(review.signature, "hex"), Buffer.from(signature(context, review.expires, secret), "hex"));
}

/** Operator attestations do not configure or prove the provider's actual retention. */
export function minorRewriteProvider(requiresZdr: boolean) {
  const project = process.env.OPENAI_COACH_PROJECT_ID?.trim() ?? "";
  const key = process.env.OPENAI_COACH_API_KEY?.trim() ?? "";
  if (process.env.COACH_AI_MINOR_REWRITE_ENABLED !== "true"
    || (requiresZdr && process.env.OPENAI_COACH_ZDR_CONFIRMED !== "true")
    || !/^proj_[A-Za-z0-9_-]+$/.test(project) || !key) return null;
  return { project, key };
}
