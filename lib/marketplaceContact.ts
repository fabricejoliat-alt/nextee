export function marketplaceContactEmail(value: unknown) {
  const email = String(value ?? "").trim();
  if (email.length > 254 || email.toLowerCase().endsWith("@noemail.local")) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/** Contact messages contain plain text only. Listings and photos are manually
 * reviewed; this additional pre-send filter covers common abusive contact text.
 * Reporting and blocking remain available when a message escapes this filter. */
export function marketplaceContactTextAllowed(subject: string, message: string) {
  const text = `${subject} ${message}`.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return !/(https?:\/\/|www\.|<[^>]+>|\b(?:porn(?:o|ography|ographie)?|nudes?|naked|fuck|fucking|bitch|connard|connasse|salope|encule|schlampe|hurensohn|fotze|stronzo|puttana)\b|\b(?:je vais te tuer|i will kill you|ich bringe dich um|ti ammazzo)\b)/i.test(text);
}
