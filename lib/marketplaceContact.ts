export function marketplaceContactEmail(value: unknown) {
  const email = String(value ?? "").trim();
  if (email.length > 254 || email.toLowerCase().endsWith("@noemail.local")) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
