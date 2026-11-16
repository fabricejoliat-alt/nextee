// lib/supabaseClient.ts
import { organizationFetch } from "@/lib/organizationFetch";
import { createBrowserClient } from "@supabase/ssr";
import { capturePasswordRecoveryUrl, clearPasswordRecoverySessionCookies, hasPasswordRecoveryCredentials } from "@/lib/passwordRecovery";

export const passwordRecoveryUrl = capturePasswordRecoveryUrl(typeof window === "undefined" ? undefined : window);
// Remove only this browser's application session before the SDK initializes.
// Recovery must not depend on refreshing or revoking an old Safari session.
export const passwordRecoveryCookies = passwordRecoveryUrl && hasPasswordRecoveryCredentials(passwordRecoveryUrl)
  ? clearPasswordRecoverySessionCookies(document, process.env.NEXT_PUBLIC_SUPABASE_URL!) : "";

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: { fetch: organizationFetch },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    cookieOptions: {
      path: "/",
      sameSite: "lax",
    },
  }
);
