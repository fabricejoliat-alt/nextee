/** Only the service access authorization can use the verified Parent account without an email code. */
export function requiresParentCode(subjectIsSelf: boolean, document: { kind: string; purpose_key: string } | null, codeRequired: boolean) {
  if (subjectIsSelf) return false;
  return document?.kind !== "parent_authorization"
    || document.purpose_key !== "service.parent_authorization"
    || codeRequired;
}
