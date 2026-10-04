type ReviewedText = { title?: unknown; body?: unknown; action_label?: unknown; source_revision?: unknown };
/** Compare the text the reviewer actually saw, independently of JSON key order. */
export function legalTranslationReviewMatches(expected: unknown, current: ReviewedText): boolean {
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return false;
  const reviewed = expected as ReviewedText;
  return ["title", "body", "action_label", "source_revision"].every((key) =>
    reviewed[key as keyof ReviewedText] === current[key as keyof ReviewedText]);
}
