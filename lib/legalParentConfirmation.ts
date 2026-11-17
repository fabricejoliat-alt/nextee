/** The server rechecks the verified Parent account and representation before each decision. */
export function requiresParentCode(subjectIsSelf: boolean, document: { kind: string; purpose_key: string } | null, codeRequired: boolean) {
  if (subjectIsSelf) return false;
  if (codeRequired) return true;
  const accountConfirmation = document?.kind === "parent_authorization" && document.purpose_key === "service.parent_authorization";
  const aiConsent = document?.kind === "specific_consent" && ["coaching.ai", "coaching.rewrite"].includes(document.purpose_key);
  return !accountConfirmation && !aiConsent;
}
