import { legalDb } from "@/lib/server/legalAccess";

export const DEFAULT_CONTACT_EMAIL = "info@activitee.golf";

export async function publicContactEmail() {
  try {
    const result = await legalDb().from("platform_contact_settings").select("contact_email").eq("singleton", true).single();
    return result.data?.contact_email || DEFAULT_CONTACT_EMAIL;
  } catch { return DEFAULT_CONTACT_EMAIL; }
}
