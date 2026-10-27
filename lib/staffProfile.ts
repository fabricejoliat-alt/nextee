/** Technical Auth addresses are not contact details. */
export function staffContactEmail(email?: string | null) {
  const value = email?.trim() ?? "";
  return value && !value.toLowerCase().endsWith("@noemail.local") ? value : "";
}
export function staffProfileMissingKey(staffFunction?: string | null, email?: string | null) {
  const missingFunction = !staffFunction?.trim();
  const missingEmail = !staffContactEmail(email);
  return missingFunction && missingEmail ? "coaches.functionAndEmailMissing"
    : missingFunction ? "coaches.functionMissing" : missingEmail ? "coaches.emailMissing" : null;
}
